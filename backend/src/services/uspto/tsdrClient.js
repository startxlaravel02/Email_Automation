/**
 * src/services/uspto/tsdrClient.js
 *
 * Calls USPTO's TSDR API for a single serial number and extracts exactly
 * the fields our pipeline needs: attorney name, live/dead status text,
 * and the correspondent's email address.
 *
 * IMPORTANT: this is the WIPO ST.96 schema (namespaced, PascalCase) —
 * completely different from the bulk-file kebab-case DTD schema parsed by
 * bulkXmlParser.js. Do not reuse parsers between the two.
 *
 * Split deliberately into:
 *   - parseTsdrXml(xmlString)  -> pure function, no network, fully unit-testable
 *   - fetchTsdrRecord(serial)  -> the actual HTTP call
 * so the extraction logic can be verified against real captured responses
 * without needing network access every time.
 */

const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

const TSDR_BASE_URL = 'https://tsdrapi.uspto.gov/ts/cd/casestatus';

// TSDR responses are small (one case-file, not a bulk file), so an
// in-memory parser is fine here — unlike the bulk file, no streaming needed.
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true, // strips ns1:/ns2:/ns3: so we can address tags by local name only
  parseTagValue: false, // keep ALL text as strings — otherwise "6969974" becomes
                        // a JS number, and any serial/registration number with a
                        // leading zero would silently lose it (confirmed bug during testing)
});

/**
 * Recursively find the first node matching a tag name anywhere under `obj`.
 * Namespace-agnostic (removeNSPrefix already stripped ns1:/ns2: from parsing).
 */
function findFirst(obj, tagName) {
  if (obj == null || typeof obj !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, tagName)) return obj[tagName];
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val === 'object') {
      const found = findFirst(Array.isArray(val) ? val[0] : val, tagName);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** Extract a plain string from a parsed node that might be `{"#text": "..."}` or a plain string. */
function textOf(node) {
  if (node == null) return null;
  if (typeof node === 'string') return node.trim();
  if (typeof node === 'number') return String(node); // defensive; parseTagValue:false should prevent this
  if (typeof node === 'object' && '#text' in node) return String(node['#text']).trim();
  return null;
}

/**
 * Pure parser: takes a raw TSDR info.xml string, returns the fields we care about.
 * @param {string} xmlString
 * @returns {{
 *   serialNumber: string|null,
 *   registrationNumber: string|null,
 *   registrationDate: string|null,
 *   statusCode: string|null,
 *   statusText: string|null,
 *   isDead: boolean,
 *   attorneyName: string|null,
 *   ownerEmail: string|null,
 * }}
 */
function parseTsdrXml(xmlString) {
  const doc = xmlParser.parse(xmlString);

  const trademark = findFirst(doc, 'Trademark');
  if (!trademark) {
    throw new Error('TSDR response did not contain a Trademark node — unexpected format');
  }

  const serialNumber = textOf(findFirst(trademark, 'ApplicationNumberText'));
  const registrationNumber = textOf(findFirst(trademark, 'RegistrationNumber'));
  const registrationDate = textOf(findFirst(trademark, 'RegistrationDate'));
  const statusCode = textOf(findFirst(trademark, 'MarkCurrentStatusCode'));

  // Trust the descriptive text over the numeric code — confirmed via real
  // testing that the numeric code table is not reliable on its own.
  const statusText = textOf(findFirst(trademark, 'MarkCurrentStatusExternalDescriptionText'));
  const isDead = Boolean(statusText && /abandon|cancel/i.test(statusText));

  // Attorney: RecordAttorney -> Contact -> Name -> PersonName -> PersonFullName.
  // Absent entirely (or empty) means no attorney of record.
  const recordAttorney = findFirst(trademark, 'RecordAttorney');
  let attorneyName = null;
  if (recordAttorney) {
    const personFullName = findFirst(recordAttorney, 'PersonFullName');
    const name = textOf(personFullName);
    attorneyName = name || null;
  }

  // Email: NationalCorrespondent -> Contact -> EmailAddressBag -> EmailAddressText[]
  // Prefer the "Main" purpose category, fall back to the first "Alternate".
  const correspondent = findFirst(trademark, 'NationalCorrespondent');
  let ownerEmail = null;
  if (correspondent) {
    const emailBag = findFirst(correspondent, 'EmailAddressBag');
    if (emailBag) {
      const emails = findFirst(emailBag, 'EmailAddressText');
      const list = Array.isArray(emails) ? emails : (emails != null ? [emails] : []);
      const mainEntry = list.find(
        (e) => e && typeof e === 'object' && e['@_emailAddressPurposeCategory'] === 'Main'
      );
      const chosen = mainEntry || list[0];
      ownerEmail = textOf(chosen);
    }
  }

  return {
    serialNumber,
    registrationNumber,
    registrationDate,
    statusCode,
    statusText,
    isDead,
    attorneyName,
    ownerEmail,
  };
}

/**
 * Fetch + parse a single serial number from the live TSDR API.
 * @param {string} serialNumber
 * @param {string} apiKey - process.env.USPTO_API_KEY
 */
async function fetchTsdrRecord(serialNumber, apiKey) {
  const url = `${TSDR_BASE_URL}/sn${serialNumber}/info.xml`;
  const response = await axios.get(url, {
    headers: { 'USPTO-API-KEY': apiKey },
    timeout: 15000,
    responseType: 'text',
  });
  return parseTsdrXml(response.data);
}

module.exports = { parseTsdrXml, fetchTsdrRecord };