/**
 * Prefix store
 *
 * Thin wrapper around settings.js — the authoritative source of the guild
 * prefix.  Previously this module maintained its own 5-minute in-memory
 * cache, which could serve a stale prefix for up to 5 minutes after a guild
 * changed it (even though settings.js had already invalidated its own 30 s
 * cache and persisted the new value).
 *
 * Phase 3 fix: delegate entirely to getGuildSettings / setGuildSettings and
 * let settings.js own the caching.  A single cache layer is always consistent;
 * two independent caches with different TTLs are not.
 */

const { getGuildSettings, setGuildSettings } = require('../stores/settings');
const { logger } = require('../helpers/logger');

function normalizePrefix(prefix) {
  if (typeof prefix !== 'string') return '!';
  const p = prefix.trim();
  if (!p) return '!';
  if (p.length > 5) return p.slice(0, 5);
  return p;
}

async function getPrefix(guildId) {
  if (!guildId) return '!';
  try {
    const s = await getGuildSettings(guildId);
    return normalizePrefix(s?.prefix);
  } catch (err) {
    logger.warn({ err, guildId }, 'getPrefix failed; falling back to default prefix');
    return '!';
  }
}

async function setPrefix(guildId, prefix) {
  if (!guildId) return '!';
  const p = normalizePrefix(prefix);
  await setGuildSettings(guildId, { prefix: p });
  return p;
}

/**
 * No-op: kept for call-site compatibility.
 * settings.js invalidates its own cache on every write already.
 */
function invalidatePrefix(_guildId) {}

module.exports = {
  getPrefix,
  setPrefix,
  invalidatePrefix,
};
