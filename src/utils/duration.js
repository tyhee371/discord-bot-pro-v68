// Parse duration strings like:
// - "30s", "5m", "2h", "1d"
// - "00:00:10" (hh:mm:ss) or "10:00" (mm:ss) or "1:02:03" (h:mm:ss)
// - "1d2h30m" (mixed units)
const UNIT_MS = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

function parseClock(input) {
  // Accept: mm:ss, hh:mm:ss, dd:hh:mm:ss
  const parts = input.split(':').map((p) => p.trim());
  if (parts.some((p) => p === '' || !/^\d+$/.test(p))) return null;
  if (parts.length < 2 || parts.length > 4) return null;

  const nums = parts.map((p) => Number(p));
  // Enforce mm/ss are within 0-59 for clarity (Discord timeout accepts ms anyway)
  const last = nums[nums.length - 1];
  const secondLast = nums[nums.length - 2];
  if (last > 59 || secondLast > 59) return null;

  let days = 0, hours = 0, minutes = 0, seconds = 0;
  if (nums.length === 2) {
    [minutes, seconds] = nums;
  } else if (nums.length === 3) {
    [hours, minutes, seconds] = nums;
  } else if (nums.length === 4) {
    [days, hours, minutes, seconds] = nums;
  }
  return (
    (days * UNIT_MS.d) +
    (hours * UNIT_MS.h) +
    (minutes * UNIT_MS.m) +
    (seconds * UNIT_MS.s)
  );
}

function parseDuration(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  if (!s) return null;

  // Clock format
  if (s.includes(':')) {
    const clockMs = parseClock(s);
    if (Number.isFinite(clockMs) && clockMs > 0) return clockMs;
    return null;
  }

  // Simple unit format: 30s / 5m / 2h / 1d
  const single = s.match(/^([0-9]+)\s*(ms|s|m|h|d)$/);
  if (single) {
    const n = Number(single[1]);
    const u = single[2];
    return n * UNIT_MS[u];
  }

  // Mixed units: 1d2h30m10s
  const re = /([0-9]+)\s*(ms|s|m|h|d)/g;
  let m;
  let total = 0;
  let matched = false;
  while ((m = re.exec(s))) {
    matched = true;
    total += Number(m[1]) * UNIT_MS[m[2]];
  }
  if (matched && total > 0) return total;

  return null;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const parts = [];
  let r = ms;

  const d = Math.floor(r / UNIT_MS.d); r -= d * UNIT_MS.d;
  const h = Math.floor(r / UNIT_MS.h); r -= h * UNIT_MS.h;
  const m = Math.floor(r / UNIT_MS.m); r -= m * UNIT_MS.m;
  const s = Math.floor(r / UNIT_MS.s);

  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

module.exports = { parseDuration, formatDuration };
