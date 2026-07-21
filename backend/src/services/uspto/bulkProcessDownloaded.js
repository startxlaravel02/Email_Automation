/**
 * src/services/uspto/bulkProcessDownloaded.js
 *
 * PHASE B: process-only. Scans a folder of already-downloaded zip parts
 * (from bulkDownloadOnly.js, e.g. D:\uspto-data) and, for each one not
 * yet processed: extracts it, seeds it into trademark_leads, deletes the
 * extracted XML (keeps the original zip untouched, in case you want to
 * re-process later), and records progress so re-runs skip completed ones.
 *
 * Run:
 *   set USPTO_DOWNLOAD_DIR=D:\uspto-data
 *   node src/services/uspto/bulkProcessDownloaded.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { seedFromFile } = require('./bulkAnnualSeed');

const DOWNLOAD_DIR = process.env.USPTO_DOWNLOAD_DIR || path.resolve(__dirname, '../../../data/uspto/bulk-parts');
// Extract temp folder now lives INSIDE the download folder itself (same drive
// as the zips), instead of a fixed path under the project folder. This matters
// a lot on low-C:-space setups — a single extracted XML can be 1GB+ even from
// a ~250MB zip, since XML text compresses 4-6x.
const EXTRACT_DIR = path.join(DOWNLOAD_DIR, '_extract-tmp');
const PROCESSED_LOG_FILE = path.resolve(__dirname, '../../../data/uspto/processed-parts.json');

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

function extractZip(zipPath, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(outDir, true);
  const entries = fs.readdirSync(outDir).filter((f) => f.toLowerCase().endsWith('.xml'));
  if (!entries.length) throw new Error(`No .xml found inside ${zipPath}`);
  return path.join(outDir, entries[0]);
}

async function run() {
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    console.error(`[process-downloaded] folder not found: ${DOWNLOAD_DIR}`);
    process.exit(1);
  }

  const zipFiles = fs.readdirSync(DOWNLOAD_DIR)
    .filter((f) => f.toLowerCase().endsWith('.zip'))
    .sort(); // process in a predictable order

  console.log(`[process-downloaded] folder: ${DOWNLOAD_DIR}`);
  console.log(`[process-downloaded] found ${zipFiles.length} zip file(s)\n`);

  const log = loadLog();

  for (const fileName of zipFiles) {
    if (log.completed.includes(fileName)) {
      console.log(`[process-downloaded] SKIP (already processed): ${fileName}`);
      continue;
    }

    const zipPath = path.join(DOWNLOAD_DIR, fileName);
    try {
      console.log(`[process-downloaded] extracting ${fileName}...`);
      const xmlPath = extractZip(zipPath, EXTRACT_DIR);

      console.log(`[process-downloaded] seeding from ${fileName}...`);
      const result = await seedFromFile(xmlPath);

      fs.rmSync(EXTRACT_DIR, { recursive: true, force: true }); // free disk, keep the .zip itself as an archive

      if (result.failedBatches > 0) {
        // seedFromFile no longer crashes on a bad batch — it skips that
        // batch and keeps going. That's good for progress, but it means
        // this zip is only PARTIALLY seeded. Don't mark it completed, so
        // a future re-run (after fixing whatever caused the failure, e.g.
        // a column width) will retry it. Already-seeded rows are safe —
        // re-processing just re-upserts them via ON DUPLICATE KEY UPDATE.
        console.warn(
          `[process-downloaded] PARTIAL: ${fileName} had ${result.failedBatches} failed batch(es) — ` +
          `NOT marked complete, will retry on next run.\n`
        );
        if (!log.failed.includes(fileName)) log.failed.push(fileName);
        saveLog(log);
        continue;
      }

      log.completed.push(fileName);
      log.failed = log.failed.filter((f) => f !== fileName);
      saveLog(log);
      console.log(`[process-downloaded] DONE: ${fileName}\n`);
    } catch (err) {
      console.error(`[process-downloaded] FAILED: ${fileName} — ${err.message}\n`);
      if (!log.failed.includes(fileName)) log.failed.push(fileName);
      saveLog(log);
      fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
      // Continue with the next zip rather than aborting the whole run.
    }
  }

  console.log('\n[process-downloaded] run complete.');
  console.log(`  completed: ${log.completed.length}`);
  console.log(`  failed: ${log.failed.length}`);
  if (log.failed.length) console.log('  failed:', log.failed.join(', '));
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch((err) => {
    console.error('[process-downloaded] FATAL:', err);
    process.exit(1);
  });
}

module.exports = { run };