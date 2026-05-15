const { getGuildSettings, setGuildSettings } = require('../stores/settings');

const DEFAULT_CFG = {
  enabled: false,
  threshold: 3, // failures
  windowSeconds: 600, // 10 min rolling window
  disableMinutes: 30, // temporary disable duration
};

const state = new Map(); // guildId -> Map(key -> { hits: number[], disabledUntil: number })

function keyOf(kind, name) {
  return `${kind}:${name}`;
}

async function getSafeModeConfig(guildId) {
  const s = await getGuildSettings(guildId);
  return { ...DEFAULT_CFG, ...(s.safeMode ?? {}) };
}

async function setSafeModeConfig(guildId, patch) {
  const s = await getGuildSettings(guildId);
  const cfg = { ...(s.safeMode ?? {}), ...patch };
  await setGuildSettings(guildId, { safeMode: cfg });
  return { ...DEFAULT_CFG, ...cfg };
}

function getGuildMap(guildId) {
  if (!state.has(guildId)) state.set(guildId, new Map());
  return state.get(guildId);
}

function isTemporarilyDisabled(guildId, kind, name) {
  const g = state.get(guildId);
  if (!g) return { disabled: false };
  const rec = g.get(keyOf(kind, name));
  if (!rec?.disabledUntil) return { disabled: false };
  if (Date.now() >= rec.disabledUntil) {
    rec.disabledUntil = 0;
    return { disabled: false };
  }
  return { disabled: true, disabledUntil: rec.disabledUntil };
}

function recordFailureInMemory(guildId, kind, name, cfg) {
  const g = getGuildMap(guildId);
  const k = keyOf(kind, name);
  const rec = g.get(k) ?? { hits: [], disabledUntil: 0 };
  const now = Date.now();

  // prune window
  const windowMs = (cfg.windowSeconds ?? DEFAULT_CFG.windowSeconds) * 1000;
  rec.hits = (rec.hits || []).filter((t) => now - t <= windowMs);
  rec.hits.push(now);

  if (rec.disabledUntil && now < rec.disabledUntil) {
    g.set(k, rec);
    return { disabledNow: false, disabledUntil: rec.disabledUntil, hits: rec.hits.length };
  }

  const threshold = cfg.threshold ?? DEFAULT_CFG.threshold;
  if (rec.hits.length >= threshold) {
    const disableMs = (cfg.disableMinutes ?? DEFAULT_CFG.disableMinutes) * 60 * 1000;
    rec.disabledUntil = now + disableMs;
    g.set(k, rec);
    return { disabledNow: true, disabledUntil: rec.disabledUntil, hits: rec.hits.length };
  }

  g.set(k, rec);
  // Lazy eviction: if no hits remain in the window, clean up the guild entry
  if (rec.hits.length === 0 && !rec.disabledUntil) evictStaleGuild(guildId);
  return { disabledNow: false, disabledUntil: 0, hits: rec.hits.length };
}

async function recordFailure(guildId, kind, name) {
  const cfg = await getSafeModeConfig(guildId);
  if (!cfg.enabled) return { enabled: false, disabledNow: false };
  const out = recordFailureInMemory(guildId, kind, name, cfg);
  return { enabled: true, ...out, cfg };
}

function resetDisabled(guildId) {
  state.delete(guildId);
}

/**
 * Evict a guild's safeMode state if it has no active disablements and all
 * hit windows have expired. Prevents the state Map from growing unboundedly
 * as guilds use commands over the lifetime of the process.
 */
function evictStaleGuild(guildId) {
  const g = state.get(guildId);
  if (!g) return;
  const now = Date.now();
  const windowMs = DEFAULT_CFG.windowSeconds * 1000;
  let hasActive = false;
  for (const rec of g.values()) {
    if (rec?.disabledUntil && rec.disabledUntil > now) { hasActive = true; break; }
    if (rec?.hits?.some((t) => now - t <= windowMs)) { hasActive = true; break; }
  }
  if (!hasActive) state.delete(guildId);
}

function listDisabled(guildId) {
  const g = state.get(guildId);
  if (!g) return [];
  const now = Date.now();
  const out = [];
  for (const [k, rec] of g.entries()) {
    if (rec?.disabledUntil && rec.disabledUntil > now) {
      out.push({ key: k, disabledUntil: rec.disabledUntil });
    }
  }
  return out.sort((a, b) => a.disabledUntil - b.disabledUntil);
}

module.exports = {
  getSafeModeConfig,
  setSafeModeConfig,
  isTemporarilyDisabled,
  recordFailure,
  resetDisabled,
  listDisabled,
  evictStaleGuild,
};
