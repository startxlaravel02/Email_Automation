// Turns a plain-text email body into a TRACKED HTML email:
//   - rewrites every http(s) link through /track/click/{token}/{linkId}, using
//     DESCRIPTIVE anchor text (not the raw URL) to avoid phishing "link mismatch" warnings
//   - appends an unsubscribe + physical-address footer (CAN-SPAM)
//   - injects the invisible 1x1 open pixel
// Pure function (no DB / no network) so it's easy to unit-test.
//
// TODO (GDPR/ePrivacy): if we ever target EU recipients, disclose tracking /
// gate the pixel on consent. Not required for current (non-EU) use.

const BASE = (process.env.PUBLIC_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
const COMPANY_NAME = process.env.COMPANY_NAME || "StartX Digital";
const COMPANY_ADDRESS = process.env.COMPANY_ADDRESS || "[address not set]";

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// A human, NON-URL label for a tracked link. Using descriptive text (not the raw
// URL) as the anchor text avoids the "link text says X but goes to Y" mismatch that
// Thunderbird/Outlook flag as phishing — which makes recipients bypass the tracking
// redirect. Derived from the URL's last path segment; bare domains fall back to the
// company name. (The full destination is still stored server-side in tracked_links.)
function linkLabel(url) {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (seg) {
      const words = decodeURIComponent(seg).replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
      if (words) return words;
    }
  } catch (_) {
    /* not a parseable URL — fall through to the generic label */
  }
  return `${COMPANY_NAME} website`;
}

function buildTrackedHtml(rawText, token) {
  const text = String(rawText || "");
  const links = [];
  const placeholders = [];
  let idx = 0;

  // 1) Pull URLs OUT first (before escaping) so query-string "&" etc. survive.
  const withPlaceholders = text.replace(/https?:\/\/[^\s<>"']+/g, (match) => {
    let url = match;
    let trailing = "";
    const t = url.match(/[.,;:!?)\]]+$/); // don't eat trailing punctuation
    if (t) {
      trailing = t[0];
      url = url.slice(0, url.length - trailing.length);
    }
    idx += 1;
    const linkId = "l" + idx;
    const ph = `\u0000L${idx}\u0000`;
    links.push({ linkId, url });
    placeholders.push({ ph, linkId, url });
    return ph + trailing;
  });

  // 2) Escape the rest, turn newlines into <br>.
  let bodyHtml = escapeHtml(withPlaceholders).replace(/\r?\n/g, "<br>\n");

  // 3) Swap placeholders for tracked anchors. Anchor text is a DESCRIPTIVE label,
  //    not the raw URL, so clients don't flag a text-vs-destination "link mismatch".
  for (const p of placeholders) {
    const href = `${BASE}/track/click/${token}/${p.linkId}`;
    bodyHtml = bodyHtml.replace(p.ph, `<a href="${href}">${escapeHtml(linkLabel(p.url))}</a>`);
  }

  const footer =
    `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">` +
    `<p style="font-size:12px;color:#888;line-height:1.5">` +
    `${escapeHtml(COMPANY_NAME)} &middot; ${escapeHtml(COMPANY_ADDRESS)}<br>` +
    `<a href="${BASE}/track/unsubscribe/${token}" style="color:#888">Unsubscribe</a>` +
    `</p>`;

  // 4) Invisible open pixel — always last.
  const pixel = `<img src="${BASE}/track/open/${token}.gif" width="1" height="1" alt="" style="display:none">`;

  const html =
    `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5">` +
    `<div>${bodyHtml}</div>${footer}${pixel}` +
    `</body></html>`;

  // Plain-text fallback (kept readable; not click-tracked — HTML part carries tracking).
  const textVersion =
    `${text}\n\n—\n${COMPANY_NAME}\n${COMPANY_ADDRESS}\n` +
    `Unsubscribe: ${BASE}/track/unsubscribe/${token}`;

  return { html, text: textVersion, links };
}

module.exports = { buildTrackedHtml, escapeHtml };
