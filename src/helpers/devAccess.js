const { safeReply } = require('./safeReply');
const { logger } = require('./logger');

function parseIdList(val) {
  if (!val) return [];
  return String(val)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function getDevConfig() {
  return {
    // Extra allowlist for invited testers (not necessarily in the Developer Portal Team)
    userIds: parseIdList(process.env.BOT_DEV_USER_IDS || process.env.DEV_USER_IDS),

    // Optional: restrict dev tools to certain guilds only
    guildIds: parseIdList(process.env.BOT_DEV_GUILD_IDS || process.env.DEV_GUILD_IDS),

    // Cache refresh interval (minutes)
    cacheMinutes: Number(process.env.BOT_DEV_CACHE_MINUTES || 360),
  };
}

// Developer Portal Team membership cache (populated via /oauth2/applications/@me)
const devTeamCache = {
  userIds: new Set(),
  lastFetch: 0,
  refreshTimer: null,
  inflight: null,
  lastError: null,
};

function isDevGuild(guildId) {
  const cfg = getDevConfig();
  if (!cfg.guildIds.length) return true;
  return cfg.guildIds.includes(String(guildId));
}

function isAllowlistedUserId(userId) {
  const cfg = getDevConfig();
  return cfg.userIds.includes(String(userId));
}

function isDevUserId(userId) {
  // Dev Portal Team members OR explicitly allowlisted testers
  return devTeamCache.userIds.has(String(userId)) || isAllowlistedUserId(userId);
}

/**
 * Fetch Developer Portal application info and extract Team member IDs.
 * Uses Bot token (no user OAuth needed).
 */
async function fetchDevPortalTeamUserIds() {
  const token = process.env.DISCORD_TOKEN || process.env.BOT_TOKEN;
  if (!token) {
    throw new Error('Missing DISCORD_TOKEN for Developer Portal team lookup');
  }

  const controller = new AbortController();
  const timeoutMs = 10_000;
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch('https://discord.com/api/v10/oauth2/applications/@me', {
      method: 'GET',
      headers: {
        Authorization: `Bot ${token}`,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Developer Portal team lookup failed: HTTP ${res.status} ${res.statusText} ${text}`.trim());
    }

    const data = await res.json();

    // If the app is in a Team, Discord returns data.team with members.
    const team = data?.team;
    const members = Array.isArray(team?.members) ? team.members : [];

    const ids = members
      .map((m) => m?.user?.id)
      .filter(Boolean)
      .map(String);

    return ids;
  } finally {
    clearTimeout(t);
  }
}

async function refreshDevTeamCache() {
  if (devTeamCache.inflight) return devTeamCache.inflight;

  devTeamCache.inflight = (async () => {
    try {
      const ids = await fetchDevPortalTeamUserIds();
      devTeamCache.userIds = new Set(ids);
      devTeamCache.lastFetch = Date.now();
      devTeamCache.lastError = null;
      logger.info({ count: ids.length }, '[DEV] Developer Portal team members loaded');
    } catch (err) {
      devTeamCache.lastError = err;
      // If this fails, we still allow BOT_DEV_USER_IDS allowlist as fallback.
      logger.warn({ err }, '[DEV] Failed to load Developer Portal team members. Falling back to BOT_DEV_USER_IDS allowlist only.');
    } finally {
      devTeamCache.inflight = null;
    }
  })();

  return devTeamCache.inflight;
}

/**
 * Initialize periodic refresh of Developer Portal Team membership.
 * Call this once after the bot is ready.
 */
async function initDevAccess() {
  const cfg = getDevConfig();

  // Initial fetch (non-fatal)
  await refreshDevTeamCache();

  // Refresh periodically
  const minutes = Number.isFinite(cfg.cacheMinutes) && cfg.cacheMinutes > 0 ? cfg.cacheMinutes : 360;
  if (devTeamCache.refreshTimer) clearInterval(devTeamCache.refreshTimer);
  devTeamCache.refreshTimer = setInterval(() => {
    refreshDevTeamCache().catch(() => {});
  }, minutes * 60_000);
}

/**
 * True if this interaction is from an allowed dev/tester.
 * - Developer Portal Team members are always allowed (global)
 * - BOT_DEV_USER_IDS allowlist is also allowed (for invited testers)
 */
function isDevInteraction(interaction) {
  const uid = interaction?.user?.id;
  if (!uid) return false;
  if (interaction?.guildId && !isDevGuild(interaction.guildId)) return false;
  return isDevUserId(uid);
}

async function requireDev(interaction) {
  // Strict: if no team members were loaded and no allowlist exists, block.
  // (This avoids accidentally exposing /dev if the bot token is missing.)
  const cfg = getDevConfig();
  const hasAnyGate = devTeamCache.userIds.size > 0 || cfg.userIds.length > 0;
  if (!hasAnyGate) {
    await safeReply(interaction, {
      ephemeral: true,
      content:
        '🚫 Developer tools are **disabled**. Add the bot to a **Developer Portal Team** or set `BOT_DEV_USER_IDS` in `.env`.',
    });
    return false;
  }

  if (isDevInteraction(interaction)) return true;
  await safeReply(interaction, {
    ephemeral: true,
    content: '🚫 This is a **developer-only** command.',
  });
  return false;
}

module.exports = {
  getDevConfig,
  initDevAccess,
  refreshDevTeamCache,
  isDevUserId,
  isDevInteraction,
  requireDev,
};
