/**
 * src/services/uspto/bulkAnnualSeed.js
 *
 * Phase 1 seed script: streams a bulk Annual Applications XML file and
 * upserts every non-dead case-file into trademark_leads.
 *
 * Run manually:
 *   node src/services/uspto/bulkAnnualSeed.js "path\to\file.xml"
 *
 * Design note: file loading is isolated behind parseBulkFile(filePath, ...)
 * so Phase 2's downloadLatestBulkFile() can later just produce a path and
 * feed it into this same function — no rework needed here.
 *
 * REVISED DESIGN (after a real production crash): the previous version
 * chained batch DB writes onto a running promise WHILE the XML was still
 * streaming. Under Node's rules, a rejection in that kind of chain can
 * become an "uncaught exception" instead of a normal catchable error —
 * which is exactly what happened (a column-too-narrow MySQL error crashed
 * the whole process instead of failing one batch cleanly).
 *
 * Fix: parseBulkFile still streams the raw XML (memory stays flat
 * regardless of file size — that concern is unchanged), but we now
 * collect the small PARSED records into a plain array first, then do a
 * normal sequential for-loop with real `await` per batch afterward. This
 * is easy to reason about, and a failing batch is caught, logged, and
 * skipped — the rest of the file still gets processed instead of the
 * entire run crashing.
 */

require('dotenv').config(); // self-contained: works when spawned as a child process
const path = require('path');
const { parseBulkFile } = require('../../utils/uspto/bulkXmlParser');
const trademarkLeadModel = require('../../models/trademarkLead.model');

const BATCH_SIZE = 500;

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}

async function seedFromFile(filePath) {
  console.log(`[uspto-seed] starting: ${filePath}`);
  const startedAt = Date.now();

  // Step 1: stream-parse the XML, collecting the small flat records.
  // Memory stays flat with respect to the RAW XML (the expensive part) —
  // this array holds only the compact parsed objects, a very different,
  // much smaller footprint (proven fine up to 200k+ records earlier).
  const records = [];
  const stats = await parseBulkFile(filePath, (record) => {
    if (!record.serial_number) return; // defensive: skip malformed rows
    records.push(record);
  });

  console.log(`[uspto-seed] parsed ${records.length} usable records, upserting in batches of ${BATCH_SIZE}...`);

  // Step 2: sequential batch upsert with real await — no promise-chaining
  // subtlety, errors are caught exactly where they happen.
  const batches = chunk(records, BATCH_SIZE);
  let totalUpserted = 0;
  let failedBatches = 0;

  for (let i = 0; i < batches.length; i++) {
    try {
      await trademarkLeadModel.upsertBatch(batches[i], 'annual_seed');
      totalUpserted += batches[i].length;
    } catch (err) {
      failedBatches++;
      console.error(
        `[uspto-seed] BATCH ${i + 1}/${batches.length} FAILED (${batches[i].length} rows skipped): ${err.message}`
      );
      // Deliberately continue to the next batch rather than aborting the
      // whole file — one bad row shouldn't cost the other thousands of
      // good rows already parsed from this file.
    }

    if ((i + 1) % 20 === 0 || i === batches.length - 1) {
      console.log(`[uspto-seed] progress: ${totalUpserted} rows upserted so far (${i + 1}/${batches.length} batches)...`);
    }
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('[uspto-seed] done.');
  console.log(`  case-files seen:      ${stats.total}`);
  console.log(`  of which dead:        ${stats.deadCount}`);
  console.log(`  of which pending:     ${stats.pendingCount}`);
  console.log(`  emitted (all kept):   ${stats.emitted}`);
  console.log(`  upserted into MySQL:  ${totalUpserted}`);
  console.log(`  failed batches:       ${failedBatches}${failedBatches ? ' (see errors above — check column widths / bad data)' : ''}`);
  console.log(`  time:                 ${seconds}s`);

  return { ...stats, totalUpserted, failedBatches };
}

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node bulkAnnualSeed.js <path-to-annual-applications.xml>');
    process.exit(1);
  }
  seedFromFile(path.resolve(filePath))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[uspto-seed] FAILED:', err);
      process.exit(1);
    });
}

module.exports = { seedFromFile };