/**
 * moderationService.js — Real moderation business logic
 *
 * Previously this file was a re-export barrel (audit: "it's dead weight").
 * Now it is the single source of truth for moderation operations that require
 * coordinating multiple subsystems: warns, mod cases, auto-timeout, mod logs.
 *
 * Phase 3 upgrade: extracted from moderationHandler.js so both the prefix
 * and slash command paths share identical logic.
 */

const { addWarn, listWarns, removeWarn, clearWarns, countWarns } = require('../stores/warns');
const { getTimer, setTimer, clearTimer } = require('./prisonService');
const { createCase } = require('../stores/modCases');
const { getGuildSettings } = require('../stores/settings');
const { logger } = require('../helpers/logger');
const { db } = require('../db');

// ── Helpers ─────────────────────────────────────────────────────────────────

function appliedLevelKey(guildId, userId) {
  return `warnLevelApplied:${guildId}:${userId}`;
}

function pickWarnLevel(levels, count) {
  if (!Array.isArray(levels) || levels.length === 0) return null;
  const sorted = [...levels]
    .filter((l) => Number.isFinite(l.threshold))
    .sort((a, b) => b.threshold - a.threshold);
  return sorted.find((l) => count >= l.threshold) ?? null;
}

function clampTimeoutMs(ms) {
  const MAX = 28 * 24 * 60 * 60 * 1000; // Discord max: 28 days
  const MIN = 5 * 1000;
  return Math.max(MIN, Math.min(MAX, Number.isFinite(ms) ? ms : 5 * 60 * 1000));
}

// ── Core: addWarnWithEffects ─────────────────────────────────────────────────

/**
 * Warn a user and apply all configured side-effects in one coordinated call:
 *   1. Store the warn
 *   2. Create a mod case
 *   3. Check warn-level and threshold rules → apply auto-timeout if triggered
 *
 * Returns { warn, warnCase, count, autoTimeout }
 *
 * @param {object} opts
 * @param {import('discord.js').Guild} opts.guild
 * @param {import('discord.js').User} opts.target
 * @param {import('discord.js').User} opts.moderator
 * @param {string} opts.reason
 * @param {boolean} [opts.createModCase=true]
 * @param {boolean} [opts.dmTarget=false]
 */
async function addWarnWithEffects({ guild, target, moderator, reason, createModCase = true, dmTarget = false }) {
  if (!guild || !target || !moderator || !reason) {
    throw new Error('addWarnWithEffects: guild, target, moderator, and reason are required');
  }

  const guildId = guild.id;
  const userId = target.id;
  const modId = moderator.id;

  // 1. Store the warn
  const warn = await addWarn(guildId, userId, modId, reason);
  const count = await countWarns(guildId, userId);

  // 2. Create mod case
  let warnCase = null;
  if (createModCase) {
    warnCase = await createCase(guildId, {
      type: 'warn',
      moderatorId: modId,
      targetId: userId,
      reason,
      extra: { warnId: warn.id, totalWarns: count },
    }).catch((e) => {
      logger.warn({ err: e, guildId, userId }, '[MODERATION] warn case creation failed (non-fatal)');
      return null;
    });
  }

  // 3. Auto-timeout logic
  const autoTimeout = await applyAutoTimeout({ guild, target, moderator, reason, count, guildId, userId }).catch((e) => {
    logger.warn({ err: e, guildId, userId }, '[MODERATION] auto-timeout failed (non-fatal)');
    return null;
  });

  return { warn, warnCase, count, autoTimeout };
}

/**
 * Internal: apply warn-level and threshold auto-timeout rules.
 * Returns { applied: boolean, durationMs, reason } or null.
 */
async function applyAutoTimeout({ guild, target, moderator, reason, count, guildId, userId }) {
  const s = await getGuildSettings(guildId);
  const levels = s.moderation?.warnLevels ?? [];
  const wa = s.moderation?.warnAutoTimeout ?? { enabled: true, threshold: 15, durationMs: 5 * 60 * 1000 };

  const chosen = pickWarnLevel(levels, count);

  if (chosen) {
    const lastApplied = Number((await db.get(appliedLevelKey(guildId, userId))) ?? 0);
    if (chosen.threshold > lastApplied) {
      const durationMs = clampTimeoutMs(chosen.durationMs);
      const autoReason = `Auto-timeout: reached warn level ${chosen.threshold} (${count} warns). Latest: ${reason}`;
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return { applied: false, reason: 'User not in server' };

      const ok = await member.timeout(durationMs, autoReason).then(() => true).catch(() => false);
      if (ok) {
        await db.set(appliedLevelKey(guildId, userId), chosen.threshold);
        await createCase(guildId, {
          type: 'timeout',
          moderatorId: moderator.id,
          targetId: userId,
          reason: autoReason,
          durationMs,
          extra: { source: 'warnLevel', warnCount: count, threshold: chosen.threshold },
        }).catch(() => {});
        return { applied: true, durationMs, source: 'warnLevel', threshold: chosen.threshold };
      }
      return { applied: false, reason: 'Missing permissions or hierarchy' };
    }
    return { applied: false, reason: 'Level already applied' };
  }

  if (wa.enabled && Number.isFinite(wa.threshold) && count >= wa.threshold) {
    const durationMs = clampTimeoutMs(wa.durationMs);
    const autoReason = `Auto-timeout: reached ${count}/${wa.threshold} warnings. Latest: ${reason}`;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return { applied: false, reason: 'User not in server' };

    const ok = await member.timeout(durationMs, autoReason).then(() => true).catch(() => false);
    if (ok) {
      await createCase(guildId, {
        type: 'timeout',
        moderatorId: moderator.id,
        targetId: userId,
        reason: autoReason,
        durationMs,
        extra: { source: 'warnThreshold', warnCount: count, threshold: wa.threshold },
      }).catch(() => {});
      return { applied: true, durationMs, source: 'warnThreshold', threshold: wa.threshold };
    }
    return { applied: false, reason: 'Missing permissions or hierarchy' };
  }

  return null; // no threshold triggered
}

// ── Re-exports for backward compatibility ────────────────────────────────────
// Callers that imported individual functions from the old barrel still work.

module.exports = {
  // New coordinated API
  addWarnWithEffects,

  // Store pass-throughs (for callers that need raw access)
  addWarn,
  listWarns,
  removeWarn,
  clearWarns,
  countWarns,
  getTimer,
  setTimer,
  clearTimer,
};
