/**
 * In-memory scheduler for giveaway end timers.
 * On bot restart, timers are restored from the DB in giveaway.js execute().
 */
const timers = new Map(); // messageId -> Timeout

function schedulEnd(messageId, delayMs, callback) {
  clearEnd(messageId);
  const safe = Math.max(0, delayMs);
  const t = setTimeout(callback, safe);
  timers.set(messageId, t);
}

function clearEnd(messageId) {
  const t = timers.get(messageId);
  if (t) { clearTimeout(t); timers.delete(messageId); }
}

function hasTimer(messageId) {
  return timers.has(messageId);
}

module.exports = { schedulEnd, clearEnd, hasTimer };
