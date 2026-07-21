/**
 * src/utils/uspto/bulkXmlParser.js
 *
 * Streaming (SAX) parser for USPTO Bulk Trademark XML files
 * (Annual/Daily Applications — product IDs TRTYFAP / TRTDXFAP).
 *
 * WHY STREAMING: the Annual file is ~377MB+. An in-memory parser
 * (fast-xml-parser) would build a full JS object tree in memory, which
 * typically expands 5-10x the file's on-disk size — fragile even at this
 * size, and won't scale if future files grow. saxes fires events per XML
 * node as it reads, so memory stays flat regardless of file size.
 *
 * IMPORTANT: this is the KEBAB-CASE bulk-file schema
 * (<case-file>, <attorney-name>, <registration-date>, ...) — completely
 * different from the TSDR API's WIPO ST.96 PascalCase/namespaced schema
 * (<ns2:RecordAttorney>, <PersonFullName>, ...). Do NOT reuse this parser
 * for TSDR responses, and do not reuse the TSDR parser for this file.
 *
 * Usage:
 *   const { parseBulkFile } = require('./bulkXmlParser');
 *   await parseBulkFile(filePath, (record) => {
 *     // called once per <case-file>, synchronously, in document order
 *   });
 */

const fs = require('fs');
const { SaxesParser } = require('saxes');

// Fields we actually care about inside <case-file-header>.
// Everything else in the header is ignored (there are ~60 boolean flags
// in the real schema we don't need for lead-gen).
const HEADER_FIELDS = new Set([
  'filing-date',
  'registration-date',
  'status-code',
  'status-date',
  'mark-identification',
  'abandonment-date',
  'cancellation-date',
  'attorney-name',
  'attorney-docket-number',
  'renewal-date',
  'section-8-filed-in',
  'renewal-filed-in',
  'filing-basis-current-66a-in',
]);

/**
 * Compute the next maintenance deadline for a case-file, using only
 * explicit signals from the bulk record (registration date + filed-flags).
 *
 * NOTE: we deliberately do NOT try to guess "is this mark dead" from the
 * numeric status-code — earlier testing against the real TSDR API showed
 * status codes are not reliably mapped to meaning (a code that looked like
 * "abandoned" turned out to mean "Registered" in one verified real case).
 * The one bulk-file signal we DO trust is explicit: presence of
 * <abandonment-date> or <cancellation-date> means the record is confirmed
 * dead, because those are direct facts, not a coded lookup.
 */
function computeDeadline(header) {
  const isDead = Boolean(header['abandonment-date'] || header['cancellation-date']);
  if (isDead) {
    return { deadline_date: null, deadline_type: 'unknown', dead: true };
  }

  // If USPTO already computed a renewal-date for us, trust it directly.
  if (header['renewal-date']) {
    const d = parseBulkDate(header['renewal-date']);
    if (d) return { deadline_date: d, deadline_type: 'section_8_9', dead: false };
  }

  const regDate = parseBulkDate(header['registration-date']);
  if (!regDate) {
    // Pending application — no registration yet, so no §8/§9 deadline exists.
    return { deadline_date: null, deadline_type: 'unknown', dead: false };
  }

  // Madrid/international basis — different renewal mechanism, flagged
  // separately and treated as lower priority (per the agreed brief).
  if (header['filing-basis-current-66a-in'] === 'T') {
    const d = addYears(regDate, 10);
    return { deadline_date: d, deadline_type: 'section_71', dead: false };
  }

  const section8Filed = header['section-8-filed-in'] === 'T';
  const renewalFiled = header['renewal-filed-in'] === 'T';

  if (!section8Filed) {
    // Hard deadline = registration + 6 years (the end of the 5-6yr window).
    return { deadline_date: addYears(regDate, 6), deadline_type: 'section_8', dead: false };
  }

  if (!renewalFiled) {
    // Section 8 already done — next relevant deadline is the 9-10yr (or
    // next 10-year multiple) combined renewal.
    const tenYearMark = nextTenYearMultiple(regDate);
    return { deadline_date: tenYearMark, deadline_type: 'section_8_9', dead: false };
  }

  // Both filed at least once — still due again every 10 years going forward.
  const tenYearMark = nextTenYearMultiple(regDate);
  return { deadline_date: tenYearMark, deadline_type: 'section_8_9', dead: false };
}

/** Bulk file dates are YYYYMMDD strings (or already YYYY-MM-DD). Returns a JS Date or null. */
function parseBulkDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let y, m, d;
  if (/^\d{8}$/.test(s)) {
    y = s.slice(0, 4); m = s.slice(4, 6); d = s.slice(6, 8);
  } else if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    [y, m, d] = s.slice(0, 10).split('-');
  } else {
    return null;
  }
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return isNaN(dt.getTime()) ? null : dt;
}

function addYears(date, years) {
  const d = new Date(date.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

/** Next registration_date + 10, +20, +30... that is still in the future relative to "now". */
function nextTenYearMultiple(regDate) {
  const now = new Date();
  let candidate = addYears(regDate, 10);
  while (candidate.getTime() < now.getTime()) {
    candidate = addYears(candidate, 10);
  }
  return candidate;
}

function toSqlDate(d) {
  if (!d) return null;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Stream-parse a bulk trademark XML file.
 * @param {string} filePath
 * @param {(record: object) => void} onRecord - called once per <case-file>
 * @returns {Promise<{ total: number, skippedDead: number, emitted: number }>}
 */
function parseBulkFile(filePath, onRecord) {
  return new Promise((resolve, reject) => {
    const parser = new SaxesParser();

    let path = [];              // stack of open tag names
    let current = null;         // the case-file record currently being built
    let headerBuf = null;       // header field buffer while inside case-file-header
    let inOwner = false;
    let ownerBuf = null;
    let textBuf = '';

    let total = 0, skippedDead = 0, emitted = 0;

    parser.on('error', reject);

    parser.on('opentag', (node) => {
      path.push(node.name);
      textBuf = '';

      if (node.name === 'case-file') {
        current = {
          serial_number: null,
          registration_number: null,
          mark_text: null,
          owner_name: null,
          owner_address: null,
          header: {},
        };
        headerBuf = null;
        inOwner = false;
        ownerBuf = null;
      } else if (node.name === 'case-file-header' && current) {
        headerBuf = current.header;
      } else if (node.name === 'case-file-owner' && current) {
        inOwner = true;
        ownerBuf = {};
      }
    });

    parser.on('text', (t) => {
      textBuf += t;
    });

    parser.on('closetag', (node) => {
      const name = node.name;
      const value = textBuf.trim();
      textBuf = '';

      if (current) {
        if (name === 'serial-number' && path[path.length - 2] === 'case-file') {
          current.serial_number = value;
        } else if (name === 'registration-number' && path[path.length - 2] === 'case-file') {
          current.registration_number = value !== '0000000' ? value : null;
        } else if (name === 'mark-identification') {
          current.mark_text = value;
        } else if (headerBuf && HEADER_FIELDS.has(name) && path[path.length - 2] === 'case-file-header') {
          headerBuf[name] = value;
        } else if (inOwner) {
          if (name === 'party-name') ownerBuf.name = value;
          if (name === 'address-1') ownerBuf.address1 = value;
          if (name === 'city') ownerBuf.city = value;
          if (name === 'country') ownerBuf.country = value;
        }
      }

      if (name === 'case-file-owner' && inOwner) {
        // Only keep the first owner (entry-number 1 is typically current/original).
        if (current && !current.owner_name && ownerBuf.name) {
          current.owner_name = ownerBuf.name;
          current.owner_address = [ownerBuf.address1, ownerBuf.city, ownerBuf.country]
            .filter(Boolean).join(', ');
        }
        inOwner = false;
        ownerBuf = null;
      }

      if (name === 'case-file-header') {
        headerBuf = null;
      }

      if (name === 'case-file' && current) {
        total++;
        const { deadline_date, deadline_type, dead } = computeDeadline(current.header);

        if (dead) {
          skippedDead++;
        } else {
          const record = {
            serial_number: current.serial_number,
            registration_number: current.registration_number,
            mark_text: current.mark_text,
            owner_name: current.owner_name,
            owner_address: current.owner_address,
            status_code: current.header['status-code'] || null,
            filing_date: toSqlDate(parseBulkDate(current.header['filing-date'])),
            registration_date: toSqlDate(parseBulkDate(current.header['registration-date'])),
            computed_deadline_date: toSqlDate(deadline_date),
            deadline_type,
            attorney_name: current.header['attorney-name'] || null,
          };
          onRecord(record);
          emitted++;
        }
        current = null;
      }

      path.pop();
    });

    parser.on('end', () => {
      resolve({ total, skippedDead, emitted });
    });

    const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => {
      try {
        parser.write(chunk);
      } catch (err) {
        reject(err);
      }
    });
    stream.on('end', () => parser.close());
    stream.on('error', reject);
  });
}

module.exports = { parseBulkFile, computeDeadline, parseBulkDate };