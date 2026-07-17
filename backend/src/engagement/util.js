// Pure math/format helpers shared by the engine and signal extractors. No I/O.

const clampNum = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round3 = (x) => Math.round(x * 1000) / 1000;

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
}

// True if inter-event gaps (seconds) are near-constant → machine cadence.
function isMachineRegular(gapsSec, varianceSec) {
  if (gapsSec.length < 2) return false;
  return stddev(gapsSec) < varianceSec;
}

function humanizeDuration(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 172800) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

// Tightness of a set of times-of-day (minutes 0..1439), robust to the midnight wrap.
function circularSpreadMinutes(mins) {
  if (mins.length < 2) return 0;
  const shifted = mins.map((x) => (x + 720) % 1440);
  return Math.min(stddev(mins), stddev(shifted));
}

// Known datacenter / mail-provider ranges — used to flag a *direct* open that
// suspiciously comes from a datacenter (a residential recipient never does).
const DATACENTER_PREFIXES = [
  "66.249.", "64.233.", "72.14.", "74.125.", "209.85.", "216.58.",
  "142.250.", "142.251.", "172.217.", "172.253.",
  "40.92.", "40.107.", "52.100.", "104.47.",
];
function isDatacenter(ip) {
  if (!ip) return false;
  const s = String(ip).toLowerCase().replace(/^::ffff:/, "");
  return DATACENTER_PREFIXES.some((p) => s.startsWith(p));
}

module.exports = {
  clampNum, round3, stddev, isMachineRegular, humanizeDuration,
  circularSpreadMinutes, isDatacenter,
};
