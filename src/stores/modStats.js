/**
 * modStats.js — moderation analytics aggregator.
 *
 * Builds per-guild and per-user moderation statistics from the case store.
 * Used by `/modcase stats` and the future analytics dashboard.
 */

const { getCase, listCasesForUser } = require('../stores/modCases');
const { db } = require('../db');
const { AsyncLock } = require('../helpers/asyncLock');

const _lock = new AsyncLock();

const INDEX_KEY = (guildId) => `modcaseAllIndex:${guildId}`;

/**
 * Register a case ID in the all-cases index for this guild.
 * Called automatically by createCase / createCaseWithId wrappers.
 */
async function indexCase(guildId, caseId) {
  return _lock.run(INDEX_KEY(guildId), async () => {
    try {
      const raw = await db.get(INDEX_KEY(guildId));
      const ids = raw ? JSON.parse(raw) : [];
      if (!ids.includes(caseId)) ids.push(caseId);
      await db.set(INDEX_KEY(guildId), JSON.stringify(ids));
    } catch {}
  });
}

/**
 * Get all case IDs for a guild (up to `limit`).
 */
async function getAllCaseIds(guildId, limit = 1000) {
  try {
    const raw = await db.get(INDEX_KEY(guildId));
    const ids = raw ? JSON.parse(raw) : [];
    return ids.slice(-Math.max(1, Math.min(limit, 5000)));
  } catch {
    return [];
  }
}

/**
 * Build guild-wide moderation statistics.
 *
 * @param {string} guildId
 * @param {{ days?: number }} [opts]  days=30 to limit to last N days
 * @returns {Promise<GuildModStats>}
 */
async function getGuildModStats(guildId, { days = 30 } = {}) {
  const cutoff = Date.now() - days * 86_400_000;
  const ids = await getAllCaseIds(guildId);

  const counts = {};       // type -> count
  const byMod = {};        // moderatorId -> count
  const byTarget = {};     // targetId -> count
  let total = 0;

  for (const id of ids) {
    const c = await getCase(guildId, id);
    if (!c) continue;
    if (c.createdAt < cutoff) continue;

    total++;
    const type = String(c.type ?? 'unknown').toLowerCase();
    counts[type] = (counts[type] ?? 0) + 1;
    if (c.moderatorId) byMod[c.moderatorId] = (byMod[c.moderatorId] ?? 0) + 1;
    if (c.targetId) byTarget[c.targetId] = (byTarget[c.targetId] ?? 0) + 1;
  }

  const topMods = Object.entries(byMod)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([id, count]) => ({ id, count }));

  const topTargets = Object.entries(byTarget)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([id, count]) => ({ id, count }));

  return { guildId, days, total, counts, topMods, topTargets };
}

/**
 * Build per-user moderation history summary.
 *
 * @param {string} guildId
 * @param {string} userId
 * @returns {Promise<UserModStats>}
 */
async function getUserModStats(guildId, userId) {
  const cases = await listCasesForUser(guildId, userId, 50);
  const counts = {};
  let appealCount = 0;
  let latestCase = null;

  for (const c of cases) {
    const type = String(c.type ?? 'unknown').toLowerCase();
    counts[type] = (counts[type] ?? 0) + 1;
    appealCount += Array.isArray(c.appeals) ? c.appeals.length : 0;
    if (!latestCase || c.createdAt > latestCase.createdAt) latestCase = c;
  }

  return { userId, guildId, totalCases: cases.length, counts, appealCount, latestCase };
}

module.exports = { indexCase, getAllCaseIds, getGuildModStats, getUserModStats };
