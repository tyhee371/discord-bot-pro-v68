const { db } = require('../db');
const { logger } = require('./logger');

// Keep in sync with migrations below. Version 4 includes prison (warn role) fields.
const CURRENT_SCHEMA_VERSION = 4;

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
    // Moderation log channel (required for mod commands)
    modLogs: {
      enabled: false,
      channelId: null,
    },
    // Moderation behavior
    moderation: {
      warnAutoTimeout: {
        enabled: true,
        threshold: 15,
        durationMs: 5 * 60 * 1000,
      },
      prison: {
        enabled: false,
        roleId: null,
        jailChannelId: null,
        threshold: 15,
      },
    },
    tickets: {
      adminRoleId: null,
      modRoleId: null,
      // Delay between claim attempts (also grace period before auto-delete after final attempt)
      claimTimeoutSeconds: 60,
      // Optional transcript log channel
      transcriptChannelId: null,
      // Ticket panel builders (id -> builder config)
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
        channel: true,
        voice: true,
        messageEdit: true,
        messageDelete: true,
        attachmentRemove: true,
        role: true,
      },
    },
  };
}

function migrateSettings(input) {
  // Clone to avoid mutating input, and migrate in-place.
  let s = typeof input === 'object' && input ? JSON.parse(JSON.stringify(input)) : {};
  let changed = false;

  const ver = Number.isFinite(s.schemaVersion) ? s.schemaVersion : 0;
  if (ver !== (s.schemaVersion ?? 0)) changed = true;
  if (!Number.isFinite(s.schemaVersion)) s.schemaVersion = 0;

  // Apply sequential migrations based on current version.
  // v0 -> v1: ensure prefix exists
  if (s.schemaVersion < 1) {
    if (!s.prefix) s.prefix = '!';
    s.schemaVersion = 1;
    changed = true;
  }

  // v1 -> v2: add verify defaults
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

  // v2 -> v3: add moderation defaults (modLogs + warn auto-timeout)
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

  // v3 -> v4: add prison (jail) automation config
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

  // Ensure defaults exist (non-destructive)
  const merged = deepMerge(defaults(), s);
  if (JSON.stringify(merged) !== JSON.stringify(s)) {
    s = merged;
    changed = true;
  }

  return { settings: s, changed };
}

async function getGuildSettings(guildId) {
  const key = `settings:${guildId}`;
  const raw = (await db.get(key)) ?? {};
  const { settings, changed } = migrateSettings(raw);
  if (changed) {
    await db.set(key, settings);
    logger.info({ guildId, from: raw?.schemaVersion ?? 0, to: settings.schemaVersion }, 'Settings migrated');
  }
  return settings;
}

async function setGuildSettings(guildId, patch) {
  const current = await getGuildSettings(guildId);
  const next = deepMerge(current, patch);
  next.schemaVersion = CURRENT_SCHEMA_VERSION;
  await db.set(`settings:${guildId}`, next);
  return next;
}

// Backward-compatible aliases used by some UI components.
async function readSettings(guildId) {
  return getGuildSettings(guildId);
}

async function updateSettings(guildId, patch) {
  return setGuildSettings(guildId, patch);
}

/**
 * Replace the entire settings document for a guild.
 *
 * Use this when you need to DELETE keys, because deepMerge() cannot remove fields.
 */
async function putGuildSettings(guildId, next) {
  const key = `settings:${guildId}`;
  const raw = next ?? {};
  const { settings } = migrateSettings(raw);
  settings.schemaVersion = CURRENT_SCHEMA_VERSION;
  await db.set(key, settings);
  return settings;
}

// Utility: safely read a nested path from an object
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

// Alias: writeSettings -> setGuildSettings (backward compatibility)
async function writeSettings(guildId, patch) {
  return setGuildSettings(guildId, patch);
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
  CURRENT_SCHEMA_VERSION,
};
