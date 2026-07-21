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
  'registration-expiration-date',
  'status-code',
  'status-date',
  'mark-identification',
  'abandonment-date',
  'cancellation-date',
  'attorney-name',
  'attorney-docket-number',
  'renewal-date',
  'international-renewal-date',
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
  // Reliable dead signals: these are direct facts, not a coded lookup.
  const abandonment_date = parseBulkDate(header['abandonment-date']);
  const cancellation_date = parseBulkDate(header['cancellation-date']);
  const dead = Boolean(abandonment_date || cancellation_date);

  const regExp = parseBulkDate(header['registration-expiration-date']);
  const renewal = parseBulkDate(header['renewal-date']);
  const intlRenewal = parseBulkDate(header['international-renewal-date']);
  const regDate = parseBulkDate(header['registration-date']);
  const is66a = header['filing-basis-current-66a-in'] === 'T';
  const lastRenewal = renewal || intlRenewal;

  // Derive the NEXT upcoming deadline (always a FUTURE date). Real-data facts
  // learned from the actual file drove this logic:
  //   - <registration-expiration-date> is authoritative but almost always
  //     EMPTY in this applications product — used first only when present.
  //   - <renewal-date> IS populated, but it is the date the mark was LAST
  //     renewed (a past fact), NOT the next due date. The next renewal is ~10
  //     years later, so we roll it forward to the next future 10-yr mark.
  //   - the section-8-filed / renewal-filed flags are unreliable (frequently
  //     blank on live marks), so we do NOT depend on them — we derive purely
  //     from dates and always roll to the future.
  // This is a COARSE pre-filter only; TSDR verification refines the exact
  // deadline per serial before anything is emailed.
  let deadline_date = null;
  let deadline_type = 'unknown';

  if (regExp) {
    deadline_date = regExp;
    deadline_type = is66a ? 'section_71' : 'section_8_9';
  } else if (lastRenewal) {
    deadline_date = nextTenYearMultiple(lastRenewal);
    deadline_type = is66a ? 'section_71' : 'section_8_9';
  } else if (regDate) {
    const section8End = addYears(regDate, 6); // end of the §8 5-6yr window
    if (section8End.getTime() >= Date.now()) {
      deadline_date = section8End;            // first §8 not yet due
      deadline_type = is66a ? 'section_71' : 'section_8';
    } else {
      deadline_date = nextTenYearMultiple(regDate); // past first §8 → next 10-yr renewal
      deadline_type = is66a ? 'section_71' : 'section_8_9';
    }
  }
  // else: pending application (no registration) — deadline stays null.

  return {
    deadline_date,
    deadline_type,
    dead,
    abandonment_date,
    cancellation_date,
    registration_expiration_date: regExp,
    renewal_date: renewal || intlRenewal,
  };
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
 * Clip a value to a column's max length so a single over-long field (USPTO data
 * has some junk/concatenated values) can never fail a whole batch insert. This
 * loses no LEADS — the row is kept, only the string is trimmed. TEXT columns
 * (mark_text, owner_address) are unbounded and aren't capped.
 */
function cap(v, n) {
  if (v == null) return null;
  const s = String(v);
  return s.length > n ? s.slice(0, n) : s;
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

    // We now emit EVERY case-file (approach change: keep all data, filter later).
    // dead/pending are counted for reporting only — nothing is skipped.
    let total = 0, deadCount = 0, pendingCount = 0, emitted = 0;

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
        const dl = computeDeadline(current.header);
        if (dl.dead) deadCount++;
        else if (!dl.deadline_date) pendingCount++;

        const record = {
          serial_number: cap(current.serial_number, 20),
          registration_number: cap(current.registration_number, 20),
          mark_text: current.mark_text,                       // TEXT — unbounded
          owner_name: cap(current.owner_name, 500),
          owner_address: current.owner_address,               // TEXT — unbounded
          status_code: cap(current.header['status-code'], 10),
          filing_date: toSqlDate(parseBulkDate(current.header['filing-date'])),
          registration_date: toSqlDate(parseBulkDate(current.header['registration-date'])),
          registration_expiration_date: toSqlDate(dl.registration_expiration_date),
          abandonment_date: toSqlDate(dl.abandonment_date),
          cancellation_date: toSqlDate(dl.cancellation_date),
          renewal_date: toSqlDate(dl.renewal_date),
          computed_deadline_date: toSqlDate(dl.deadline_date),
          deadline_type: dl.deadline_type,
          is_dead: dl.dead ? 1 : 0,
          attorney_name: cap(current.header['attorney-name'], 255),
        };
        onRecord(record);
        emitted++;
        current = null;
      }

      path.pop();
    });

    parser.on('end', () => {
      resolve({ total, deadCount, pendingCount, emitted });
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