require('dotenv').config();
/**
 * src/services/uspto/bulkExtractOnly.js
 *
 * EXTRACT-ONLY (no MySQL). Unzips every downloaded USPTO part into an output
 * folder, then DELETES each source .zip once its XML is safely extracted (to
 * reclaim disk). Corrupt zips are kept and reported so you can re-download them.
 *
 * Uses `yauzl` (streaming) — it reads the zip's directory and streams each entry
 * straight to disk, so it handles the multi-GB parts that adm-zip could not
 * (adm-zip loads the whole file into a ~2GB-capped Node Buffer and throws).
 *
 * Run (PowerShell):
 *   $env:USPTO_DOWNLOAD_DIR="E:\uspto-data\bulk-parts"
 *   $env:USPTO_EXTRACT_DIR="E:\uspto-data\extracted-data"
 *   node src/services/uspto/bulkExtractOnly.js
 *
 * Env:
 *   USPTO_DOWNLOAD_DIR  where the .zip parts are        (default E:\uspto-data\bulk-parts)
 *   USPTO_EXTRACT_DIR   where to write the .xml files    (default E:\uspto-data\extracted-data)
 *   USPTO_KEEP_ZIP=true keep the .zip after extracting   (default: delete it)
 */
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');

const SRC_DIR = process.env.USPTO_DOWNLOAD_DIR || 'E:\\uspto-data\\bulk-parts';
const OUT_DIR = process.env.USPTO_EXTRACT_DIR || 'E:\\uspto-data\\extracted-data';
const DELETE_ZIP = process.env.USPTO_KEEP_ZIP !== 'true';

const GB = 1024 * 1024 * 1024;

// Stream the first .xml entry out of a zip to `outDir`. Resolves the written path.
function extractXml(zipPath, outDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      let written = null;
      zip.on('error', reject);
      zip.on('entry', (entry) => {
        const isDir = /\/$/.test(entry.fileName);
        if (isDir || !/\.xml$/i.test(entry.fileName)) return zip.readEntry(); // skip non-xml
        const outPath = path.join(outDir, path.basename(entry.fileName));
        zip.openReadStream(entry, (e, rs) => {
          if (e) return reject(e);
          const ws = fs.createWriteStream(outPath);
          rs.on('error', reject);
          ws.on('error', reject);
          ws.on('finish', () => { written = outPath; zip.readEntry(); });
          rs.pipe(ws);
        });
      });
      zip.on('end', () => (written ? resolve(written) : reject(new Error('no .xml entry inside zip'))));
      zip.readEntry();
    });
  });
}

async function run() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`[extract] source folder not found: ${SRC_DIR}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const zips = fs.readdirSync(SRC_DIR).filter((f) => /\.zip$/i.test(f)).sort();
  console.log(`[extract] source: ${SRC_DIR}`);
  console.log(`[extract] output: ${OUT_DIR}`);
  console.log(`[extract] ${zips.length} zip(s) — delete-after-extract: ${DELETE_ZIP}\n`);

  let extracted = 0, skipped = 0;
  const failed = [];

  for (const name of zips) {
    const zipPath = path.join(SRC_DIR, name);
    const expectedXml = path.join(OUT_DIR, name.replace(/\.zip$/i, '.xml'));

    if (fs.existsSync(expectedXml)) {
      console.log(`[extract] SKIP (already extracted): ${name}`);
      skipped++;
      if (DELETE_ZIP) fs.rmSync(zipPath, { force: true });
      continue;
    }

    try {
      console.log(`[extract] extracting ${name}...`);
      const outPath = await extractXml(zipPath, OUT_DIR);
      const sizeGB = (fs.statSync(outPath).size / GB).toFixed(2);
      console.log(`[extract] OK: ${name} -> ${path.basename(outPath)} (${sizeGB} GB)`);
      extracted++;
      if (DELETE_ZIP) {
        fs.rmSync(zipPath, { force: true });
        console.log(`[extract]   deleted ${name}`);
      }
    } catch (err) {
      console.error(`[extract] FAILED: ${name} — ${err.message} (zip kept — re-download it)`);
      failed.push(name);
      // remove any partial .xml so a re-run retries cleanly
      try { if (fs.existsSync(expectedXml)) fs.rmSync(expectedXml, { force: true }); } catch (_) {}
    }
  }

  console.log(`\n[extract] done. extracted: ${extracted}, skipped: ${skipped}, failed: ${failed.length}`);
  if (failed.length) console.log(`  re-download these: ${failed.join(', ')}`);
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch((err) => {
    console.error('[extract] FATAL:', err);
    process.exit(1);
  });
}

module.exports = { run, extractXml };
