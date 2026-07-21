/**
 * src/services/uspto/bulkProcessDownloaded.js
 *
 * INTERLEAVED process-only. Scans a folder of downloaded zip parts and, for
 * each one not yet processed: extracts it, seeds it into trademark_leads,
 * deletes the extracted XML, and (on success) deletes the source zip — so disk
 * usage stays FLAT (only one ~2-3GB XML on disk at any moment). Progress is
 * logged so re-runs skip completed parts.
 *
 * WHY yauzl (not adm-zip): the extracted XMLs are 2-3GB, which means adm-zip
 * (which loads the whole file into a ~2GB-capped Node Buffer) throws
 * "length out of range" on most parts. yauzl streams each entry straight to
 * disk, so size doesn't matter. We reuse the exact same extractXml() the
 * extract-only script uses.
 *
 * Corrupt/truncated zips (e.g. a bad download) fail cleanly: they are recorded
 * as failed and KEPT (never deleted) so you can re-download them.
 *
 * Run (PowerShell):
 *   $env:USPTO_DOWNLOAD_DIR="E:\uspto-data\bulk-parts"
 *   node src/services/uspto/bulkProcessDownloaded.js
 *
 * Env:
 *   USPTO_DOWNLOAD_DIR   folder of .zip parts       (default E:\uspto-data\bulk-parts)
 *   USPTO_KEEP_ZIP=true  keep the .zip after seeding (default: delete it on success)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { extractXml } = require('./bulkExtractOnly');

// Seed each part in its OWN child process (not in-process). WHY: seedFromFile
// buffers a whole file's parsed records in memory; running 60+ parts in one
// long-lived process let that heap accumulate until Node aborted with
// "JavaScript heap out of memory" (~4GB) partway through. A fresh child per
// part gets a clean heap that is fully reclaimed the instant it exits, so
// memory stays flat no matter how many parts we process. --max-old-space-size
// gives a single large part generous headroom.
const SEED_SCRIPT = path.join(__dirname, 'bulkAnnualSeed.js');
const CHILD_MAX_OLD_SPACE_MB = process.env.USPTO_CHILD_HEAP_MB || '6144';

function seedInChild(xmlPath) {
  const res = spawnSync(
    process.execPath,
    [`--max-old-space-size=${CHILD_MAX_OLD_SPACE_MB}`, SEED_SCRIPT, xmlPath],
    { stdio: 'inherit' } // child logs (incl. per-batch progress) flow to our output
  );
  if (res.error) throw res.error;
  return res.status; // 0 = success; non-zero = the seed threw / crashed
}

const DOWNLOAD_DIR = process.env.USPTO_DOWNLOAD_DIR || 'E:\\uspto-data\\bulk-parts';
// Temp extract folder on the SAME drive as the zips (keeps everything off C:).
const EXTRACT_DIR = path.join(DOWNLOAD_DIR, '_extract-tmp');
const PROCESSED_LOG_FILE = path.resolve(__dirname, '../../../data/uspto/processed-parts.json');
const DELETE_ZIP = process.env.USPTO_KEEP_ZIP !== 'true';

function loadLog() {
  if (fs.existsSync(PROCESSED_LOG_FILE)) {
    return JSON.parse(fs.readFileSync(PROCESSED_LOG_FILE, 'utf8'));
  }
  return { completed: [], failed: [] };
}

function saveLog(log) {
  fs.mkdirSync(path.dirname(PROCESSED_LOG_FILE), { recursive: true });
  fs.writeFileSync(PROCESSED_LOG_FILE, JSON.stringify(log, null, 2));
}

function cleanExtractDir() {
  fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
  fs.mkdirSync(EXTRACT_DIR, { recursive: true });
}

async function run() {
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    console.error(`[process-downloaded] folder not found: ${DOWNLOAD_DIR}`);
    process.exit(1);
  }

  const zipFiles = fs.readdirSync(DOWNLOAD_DIR)
    .filter((f) => f.toLowerCase().endsWith('.zip'))
    .sort();

  console.log(`[process-downloaded] folder: ${DOWNLOAD_DIR}`);
  console.log(`[process-downloaded] found ${zipFiles.length} zip file(s) — delete-zip-on-success: ${DELETE_ZIP}\n`);

  const log = loadLog();
  let done = 0;

  for (const fileName of zipFiles) {
    if (log.completed.includes(fileName)) {
      console.log(`[process-downloaded] SKIP (already processed): ${fileName}`);
      continue;
    }

    const zipPath = path.join(DOWNLOAD_DIR, fileName);
    try {
      cleanExtractDir();

      console.log(`[process-downloaded] === ${fileName} === extracting...`);
      const xmlPath = await extractXml(zipPath, EXTRACT_DIR);

      console.log(`[process-downloaded] seeding ${fileName} (child process)...`);
      const status = seedInChild(xmlPath);

      // Free the big XML immediately, regardless of outcome.
      fs.rmSync(xmlPath, { force: true });

      if (status !== 0) {
        // Seed child crashed (e.g. OOM on a pathological part) — keep the zip
        // and record it so a re-run retries rather than silently losing data.
        console.warn(
          `[process-downloaded] SEED FAILED (exit ${status}): ${fileName} — zip KEPT, will retry on next run.\n`
        );
        if (!log.failed.includes(fileName)) log.failed.push(fileName);
        saveLog(log);
        continue;
      }

      log.completed.push(fileName);
      log.failed = log.failed.filter((f) => f !== fileName);
      saveLog(log);
      done++;

      if (DELETE_ZIP) {
        fs.rmSync(zipPath, { force: true });
        console.log(`[process-downloaded] DONE + deleted zip: ${fileName}\n`);
      } else {
        console.log(`[process-downloaded] DONE: ${fileName}\n`);
      }
    } catch (err) {
      // Corrupt/truncated zip or extract/seed error — keep the zip, record it.
      console.error(`[process-downloaded] FAILED: ${fileName} — ${err.message} (zip kept — re-download it)\n`);
      if (!log.failed.includes(fileName)) log.failed.push(fileName);
      saveLog(log);
    }
  }

  // Best-effort cleanup of the temp dir.
  try { fs.rmSync(EXTRACT_DIR, { recursive: true, force: true }); } catch (_) {}

  console.log('[process-downloaded] run complete.');
  console.log(`  newly completed this run: ${done}`);
  console.log(`  total completed:          ${log.completed.length}`);
  console.log(`  failed/kept:              ${log.failed.length}`);
  if (log.failed.length) console.log(`  re-download these: ${log.failed.join(', ')}`);
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch((err) => {
    console.error('[process-downloaded] FATAL:', err);
    process.exit(1);
  });
}

module.exports = { run };
