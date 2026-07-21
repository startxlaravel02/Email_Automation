require('dotenv').config();
/**
 * src/services/uspto/bulkDownloadOnly.js
 *
 * PHASE A: download-only. Grabs each numbered zip part into a target
 * folder (e.g. D:\uspto-data) and stops there — no extraction, no MySQL.
 * Run bulkProcessDownloaded.js afterward as a separate step.
 *
 * Run (Windows, D: drive folder):
 *   set USPTO_DOWNLOAD_DIR=D:\uspto-data
 *   node src/services/uspto/bulkDownloadOnly.js
 *
 * Or pass it inline (PowerShell):
 *   $env:USPTO_DOWNLOAD_DIR="D:\uspto-data"; node src/services/uspto/bulkDownloadOnly.js
 *
 * Optional:
 *   USPTO_BULK_START=1        first part number (default 1)
 *   USPTO_BULK_END=91         last part number (default 91)
 *   USPTO_BULK_DELAY_MS=3000  delay between downloads (default 3000ms)
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const BASE_URL = 'https://data.uspto.gov/ui/datasets/products/files/TRTYRAP';
const SNAPSHOT = '18840407-20251231';

const DOWNLOAD_DIR = process.env.USPTO_DOWNLOAD_DIR || path.resolve(__dirname, '../../../data/uspto/bulk-parts');
const START = parseInt(process.env.USPTO_BULK_START || '1', 10);
const END = parseInt(process.env.USPTO_BULK_END || '91', 10);
const DELAY_MS = parseInt(process.env.USPTO_BULK_DELAY_MS || '3000', 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function partFileName(n) {
  return `apc${SNAPSHOT}-${String(n).padStart(2, '0')}.zip`;
}

async function downloadFile(url, destPath) {
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 180000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function run() {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  console.log(`[download-only] target folder: ${DOWNLOAD_DIR}`);
  console.log(`[download-only] parts ${START}-${END}, delay ${DELAY_MS}ms\n`);

  const succeeded = [];
  const failed = [];

  for (let n = START; n <= END; n++) {
    const fileName = partFileName(n);
    const destPath = path.join(DOWNLOAD_DIR, fileName);

    if (fs.existsSync(destPath)) {
      console.log(`[download-only] SKIP (already on disk): ${fileName}`);
      succeeded.push(fileName);
      continue;
    }

    const url = `${BASE_URL}/${fileName}`;
    try {
      console.log(`[download-only] downloading ${fileName}...`);
      const start = Date.now();
      await downloadFile(url, destPath);
      const seconds = ((Date.now() - start) / 1000).toFixed(1);
      const sizeMB = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
      console.log(`[download-only] OK: ${fileName} (${sizeMB}MB in ${seconds}s)`);
      succeeded.push(fileName);
    } catch (err) {
      const status = err.response ? err.response.status : 'network error';
      console.error(`[download-only] FAILED: ${fileName} (${status}) — ${err.message}`);
      console.error(`[download-only]   If this is a CAPTCHA block: open this URL in your`);
      console.error(`[download-only]   browser, solve it, save the file into:`);
      console.error(`[download-only]   ${destPath}`);
      console.error(`[download-only]   then re-run this script — it skips files already on disk.\n`);
      // Clean up any partial/corrupt file from a failed stream.
      if (fs.existsSync(destPath)) fs.rmSync(destPath, { force: true });
      failed.push(fileName);
    }

    if (n < END) await sleep(DELAY_MS);
  }

  console.log('\n[download-only] run complete.');
  console.log(`  succeeded: ${succeeded.length}/${END - START + 1}`);
  console.log(`  failed: ${failed.length}`);
  if (failed.length) console.log('  failed parts:', failed.join(', '));
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch((err) => {
    console.error('[download-only] FATAL:', err);
    process.exit(1);
  });
}

module.exports = { run, partFileName };