/**
 * memberPersistence.js
 * --------------------
 * Stores and retrieves a member's roles and nickname when they leave a guild,
 * so both can be restored when they rejoin.
 *
 * Storage domain: Keyv (SQLite) — operational state, consistent with the rest
 * of the bot's per-guild data (warns, rooms, settings, etc.).
 *
 * Key format:  memberPersist:<guildId>:<userId>
 * Value shape: { roleIds: string[], nickname: string|null, savedAt: number }
 */

'use strict';

const { db } = require('../db');
const { AsyncLock } = require('../helpers/asyncLock');

const _lock = new AsyncLock();

/**
 * Build the Keyv key for a guild+user pair.
 * @param {string} guildId
 * @param {string} userId
 * @returns {string}
 */
function persistKey(guildId, userId) {
  return `memberPersist:${guildId}:${userId}`;
}

/**
 * Save a member's roles and nickname on leave.
 *
 * @param {string}        guildId   - Snowflake string
 * @param {string}        userId    - Snowflake string
 * @param {string[]}      roleIds   - Array of role snowflake strings (excl. @everyone)
 * @param {string|null}   nickname  - Current server nickname, or null
 * @returns {Promise<void>}
 */
async function saveMemberData(guildId, userId, roleIds, nickname) {
  const key = persistKey(guildId, userId);
  return _lock.run(key, async () => {
    await db.set(key, {
      roleIds,
      nickname: nickname ?? null,
      savedAt: Date.now(),
    });
  });
}

/**
 * Retrieve a member's previously saved data.
 *
 * @param {string} guildId
 * @param {string} userId
 * @returns {Promise<{ roleIds: string[], nickname: string|null, savedAt: number }|null>}
 */
async function getMemberData(guildId, userId) {
  return (await db.get(persistKey(guildId, userId))) ?? null;
}

/**
 * Delete saved data for a member (e.g. after successful restore, or on ban).
 *
 * @param {string} guildId
 * @param {string} userId
 * @returns {Promise<void>}
 */
async function clearMemberData(guildId, userId) {
  const key = persistKey(guildId, userId);
  return _lock.run(key, async () => {
    await db.set(key, null);
  });
}

module.exports = { saveMemberData, getMemberData, clearMemberData };
