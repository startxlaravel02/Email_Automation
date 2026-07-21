require('dotenv').config();
/**
 * src/services/uspto/bulkSeedExtracted.js
 *
 * Seed already-EXTRACTED XML files (produced by bulkExtractOnly.js) into
 * trademark_leads, then DELETE each .xml once it is fully seeded — so disk
 * is reclaimed as we go (the extract step filled the drive; this drains it).
 *
 * This is the "insert the ones already extracted" step. It does NOT touch
 * zips — those are already gone. For the remaining zips, use the interleaved
 * bulkProcessDownloaded.js (extract -> seed -> delete) instead.
 *
 * Idempotent + resume-safe: a fully-seeded file is deleted, so a re-run only
 * sees what's left. A file whose seed had failed batches is KEPT (so it can be
 * retried) — with the parser's field truncation that should no longer happen.
 *
 * Run (PowerShell):
 *   $env:USPTO_EXTRACT_DIR="E:\uspto-data\extracted-data"
 *   node src/services/uspto/bulkSeedExtracted.js
 *
 * Env:
 *   USPTO_EXTRACT_DIR    folder of .xml files to seed   (default E:\uspto-data\extracted-data)
 *   USPTO_KEEP_XML=true  keep the .xml after seeding     (default: delete it to free disk)
 */
const fs = require('fs');
const path = require('path');
const { seedFromFile } = require('./bulkAnnualSeed');

const SRC_DIR = process.env.USPTO_EXTRACT_DIR || 'E:\\uspto-data\\extracted-data';
const DELETE_XML = process.env.USPTO_KEEP_XML !== 'true';

async function run() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`[seed-extracted] folder not found: ${SRC_DIR}`);
    process.exit(1);
  }

  const xmls = fs.readdirSync(SRC_DIR).filter((f) => /\.xml$/i.test(f)).sort();
  console.log(`[seed-extracted] folder: ${SRC_DIR}`);
  console.log(`[seed-extracted] ${xmls.length} XML file(s) to seed — delete-after-seed: ${DELETE_XML}\n`);

  let seeded = 0;
  const problems = [];

  for (const name of xmls) {
    const xmlPath = path.join(SRC_DIR, name);
    try {
      console.log(`[seed-extracted] === ${name} ===`);
      const result = await seedFromFile(xmlPath);

      if (result.failedBatches > 0) {
        console.warn(
          `[seed-extracted] PARTIAL: ${name} had ${result.failedBatches} failed batch(es) — ` +
          `XML KEPT for retry.\n`
        );
        problems.push(name);
        continue;
      }

      seeded++;
      if (DELETE_XML) {
        fs.rmSync(xmlPath, { force: true });
        console.log(`[seed-extracted] seeded + deleted ${name}\n`);
      } else {
        console.log(`[seed-extracted] seeded ${name} (kept)\n`);
      }
    } catch (err) {
      console.error(`[seed-extracted] FAILED: ${name} — ${err.message} (XML kept)\n`);
      problems.push(name);
    }
  }

  console.log('[seed-extracted] run complete.');
  console.log(`  seeded (+deleted): ${seeded}`);
  console.log(`  problems (kept):   ${problems.length}`);
  if (problems.length) console.log(`  kept for retry: ${problems.join(', ')}`);
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch((err) => {
    console.error('[seed-extracted] FATAL:', err);
    process.exit(1);
  });
}

module.exports = { run };
