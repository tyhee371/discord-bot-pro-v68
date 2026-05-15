const { db } = require('../db');
const { logger } = require('../helpers/logger');
const { AsyncLock } = require('../helpers/asyncLock');
const { metrics } = require('../helpers/metrics');

// Keep in sync with migrations below. Version 5 adds memberPersistence fields.
const CURRENT_SCHEMA_VERSION = 5;

// ── Settings cache ────────────────────────────────────────────────────────────
// Caches guild settings in-process for CACHE_TTL_MS to avoid a db read on
// every message/reaction/voice event. The cache is invalidated on every write
// so callers always see fresh data after setGuildSettings/putGuildSettings.
const CACHE_TTL_MS = 30_000; // 30 seconds

const MAX_CACHE_SIZE = 5000; // LRU cap — evict oldest entry when exceeded

/** @type {Map<string, { value: object, expiresAt: number }>} */
const _cache = new Map();
const _settingsLock = new AsyncLock();

function _cacheGet(guildId) {
  const entry = _cache.get(guildId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(guildId);
    return null;
  }
  return entry.value;
}

function _cacheSet(guildId, value) {
  // LRU: delete-then-re-insert moves the key to the end of insertion order
  _cache.delete(guildId);
  _cache.set(guildId, { value, expiresAt: Date.now() + CACHE_TTL_MS });

  // Evict oldest entries when over the cap
  if (_cache.size > MAX_CACHE_SIZE) {
    const oldest = _cache.keys().next().value; // Map iteration is insertion-order
    _cache.delete(oldest);
  }
}

function _cacheInvalidate(guildId) {
  _cache.delete(guildId);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deepMerge(base, patch) {
  if (typeof base !== 'object' || base === null) return patch;
  if (typeof patch !== 'object' || patch === null) return patch;

  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out;
}

function defaults() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    prefix: '!',
    modLogs: { enabled: false, channelId: null },
    moderation: {
      warnAutoTimeout: { enabled: true, threshold: 15, durationMs: 5 * 60 * 1000 },
      prison: { enabled: false, roleId: null, jailChannelId: null, threshold: 15 },
    },
    tickets: {
      adminRoleId: null,
      modRoleId: null,
      claimTimeoutSeconds: 60,
      transcriptChannelId: null,
      builders: {},
    },
    verify: {
      enabled: false,
      channelId: null,
      roleId: null,
      messageId: null,
      title: 'Verification',
      description: 'Click the button below to verify and gain access to the server.',
    },
    logs: {
      enabled: false,
      channelId: null,
      ignoreBots: true,
      events: {
        member: true,      // member join/leave log
        channel: true,
        voice: true,
        messageEdit: true,
        messageDelete: true,
        attachmentRemove: true,
        role: true,
      },
    },
    memberPersistence: {
      restoreRoles: false,
      restoreNickname: false,
    },
  };
}

function migrateSettings(input) {
  let s = typeof input === 'object' && input ? JSON.parse(JSON.stringify(input)) : {};
  let changed = false;

  const ver = Number.isFinite(s.schemaVersion) ? s.schemaVersion : 0;
  if (ver !== (s.schemaVersion ?? 0)) changed = true;
  if (!Number.isFinite(s.schemaVersion)) s.schemaVersion = 0;

  if (s.schemaVersion < 1) {
    if (!s.prefix) s.prefix = '!';
    s.schemaVersion = 1;
    changed = true;
  }

  if (s.schemaVersion < 2) {
    if (!s.verify) s.verify = {};
    if (typeof s.verify.enabled !== 'boolean') s.verify.enabled = false;
    if (!s.verify.title) s.verify.title = 'Verification';
    if (!s.verify.description) s.verify.description = 'Click the button below to verify and gain access to the server.';
    if (!('channelId' in s.verify)) s.verify.channelId = null;
    if (!('roleId' in s.verify)) s.verify.roleId = null;
    if (!('messageId' in s.verify)) s.verify.messageId = null;
    s.schemaVersion = 2;
    changed = true;
  }

  if (s.schemaVersion < 3) {
    if (!s.modLogs) s.modLogs = {};
    if (typeof s.modLogs.enabled !== 'boolean') s.modLogs.enabled = false;
    if (!('channelId' in s.modLogs)) s.modLogs.channelId = null;
    if (!s.moderation) s.moderation = {};
    if (!s.moderation.warnAutoTimeout) s.moderation.warnAutoTimeout = {};
    if (typeof s.moderation.warnAutoTimeout.enabled !== 'boolean') s.moderation.warnAutoTimeout.enabled = true;
    if (!Number.isFinite(s.moderation.warnAutoTimeout.threshold)) s.moderation.warnAutoTimeout.threshold = 15;
    if (!Number.isFinite(s.moderation.warnAutoTimeout.durationMs)) s.moderation.warnAutoTimeout.durationMs = 5 * 60 * 1000;
    s.schemaVersion = 3;
    changed = true;
  }

  if (s.schemaVersion < 4) {
    s.moderation = s.moderation || {};
    if (!s.moderation.prison) {
      s.moderation.prison = {
        enabled: false,
        roleId: null,
        jailChannelId: null,
        threshold: 15,
        durationMs: 10 * 1000,
      };
    }
    s.schemaVersion = 4;
    changed = true;
  }

  if (s.schemaVersion < 5) {
    // v5: member persistence feature (restore roles + nickname on rejoin)
    if (!s.memberPersistence) {
      s.memberPersistence = { restoreRoles: false, restoreNickname: false };
    }
    s.schemaVersion = 5;
    changed = true;
  }

  const merged = deepMerge(defaults(), s);
  if (JSON.stringify(merged) !== JSON.stringify(s)) {
    s = merged;
    changed = true;
  }

  return { settings: s, changed };
}

// ── Public API ────────────────────────────────────────────────────────────────

async function getGuildSettings(guildId) {
  const cached = _cacheGet(guildId);
  if (cached) {
    metrics.increment('settings.cache.hit');
    return cached;
  }

  metrics.increment('settings.cache.miss');

  // Serialise concurrent reads for the same guild so we don't fire N db
  // reads simultaneously then redundantly write N migrations.
  return _settingsLock.run(`settings:${guildId}`, async () => {
    // Re-check cache inside the lock — a concurrent caller may have just populated it.
    const cached2 = _cacheGet(guildId);
    if (cached2) return cached2;

    const key = `settings:${guildId}`;
    const raw = (await db.get(key)) ?? {};
    const { settings, changed } = migrateSettings(raw);
    if (changed) {
      await db.set(key, settings);
      logger.info({ guildId, from: raw?.schemaVersion ?? 0, to: settings.schemaVersion }, 'Settings migrated');
    }
    _cacheSet(guildId, settings);
    return settings;
  });
}

/**
 * Validate user-configurable string values before storing.
 * Prevents malicious guild admins from storing arbitrarily large strings
 * that waste memory and hit Discord's 2000-char message limit.
 */
function sanitizePatch(patch, maxLen = 2000) {
  if (!patch || typeof patch !== 'object') return patch;
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === 'string') {
      out[k] = v.slice(0, maxLen);
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizePatch(v, maxLen);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function setGuildSettings(guildId, patch) {
  return _settingsLock.run(`settings:${guildId}`, async () => {
    const key = `settings:${guildId}`;
    const raw = (await db.get(key)) ?? {};
    const { settings: current } = migrateSettings(raw);
    const next = deepMerge(current, patch);
    next.schemaVersion = CURRENT_SCHEMA_VERSION;
    await db.set(key, next);
    _cacheSet(guildId, next);   // update cache immediately
    metrics.increment('settings.writes');
    return next;
  });
}

async function putGuildSettings(guildId, next) {
  const key = `settings:${guildId}`;
  const raw = next ?? {};
  const { settings } = migrateSettings(raw);
  settings.schemaVersion = CURRENT_SCHEMA_VERSION;
  await db.set(key, settings);
  _cacheInvalidate(guildId);
  metrics.increment('settings.writes');
  return settings;
}

async function readSettings(guildId) {
  return getGuildSettings(guildId);
}

async function updateSettings(guildId, patch) {
  return setGuildSettings(guildId, patch);
}

async function writeSettings(guildId, patch) {
  return setGuildSettings(guildId, patch);
}

function getPath(obj, dotPath, defaultValue = null) {
  try {
    const keys = dotPath.split('.');
    let cur = obj;
    for (const k of keys) {
      if (cur == null || typeof cur !== 'object') return defaultValue;
      cur = cur[k];
    }
    return cur !== undefined ? cur : defaultValue;
  } catch {
    return defaultValue;
  }
}

/** Expose cache stats for /metrics and /dev diagnostics. */
function getCacheStats() {
  return {
    size: _cache.size,
    ttlMs: CACHE_TTL_MS,
  };
}

module.exports = {
  getPath,
  writeSettings,
  getGuildSettings,
  setGuildSettings,
  readSettings,
  updateSettings,
  putGuildSettings,
  migrateSettings,
  getCacheStats,
  CURRENT_SCHEMA_VERSION,
};
