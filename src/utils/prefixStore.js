/**
 * Prefix store
 *
 * The bot persists guild settings (including `prefix`) via utils/settings.js.
 * Some parts of the codebase reference a `prefixStore` helper that was missing,
 * causing MODULE_NOT_FOUND crashes during command loading and slash deploy.
 *
 * This module provides a small cached wrapper around settings.
 */

const { getGuildSettings, setGuildSettings } = require('./settings');
const { logger } = require('./logger');

// Simple in-memory cache to reduce DB reads.
// key: guildId, value: { prefix, expiresAt }
const cache = new Map();

// Cache for 5 minutes.
const TTL_MS = 5 * 60 * 1000;

function normalizePrefix(prefix) {
  if (typeof prefix !== 'string') return '!';
  const p = prefix.trim();
  if (!p) return '!';
  // Keep prefix short/sane.
  if (p.length > 5) return p.slice(0, 5);
  return p;
}

async function getPrefix(guildId) {
  if (!guildId) return '!';

  const now = Date.now();
  const hit = cache.get(guildId);
  if (hit && hit.expiresAt > now) return hit.prefix;

  try {
    const s = await getGuildSettings(guildId);
    const prefix = normalizePrefix(s?.prefix);
    cache.set(guildId, { prefix, expiresAt: now + TTL_MS });
    return prefix;
  } catch (err) {
    logger.warn({ err, guildId }, 'getPrefix failed; falling back to default prefix');
    return '!';
  }
}

async function setPrefix(guildId, prefix) {
  if (!guildId) return '!';
  const p = normalizePrefix(prefix);
  await setGuildSettings(guildId, { prefix: p });
  cache.set(guildId, { prefix: p, expiresAt: Date.now() + TTL_MS });
  return p;
}

function invalidatePrefix(guildId) {
  if (!guildId) return;
  cache.delete(guildId);
}

module.exports = {
  getPrefix,
  setPrefix,
  invalidatePrefix,
  _cache: cache, // for debugging/tests
};
