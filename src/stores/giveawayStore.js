/**
 * Giveaway persistent store — uses the same Keyv db as the rest of the bot.
 * Keys: giveaway:<messageId>
 *
 * Phase 2: addToIndex / removeFromIndex are now serialised with AsyncLock
 * to prevent lost-update races when two reactions arrive simultaneously.
 */
const { db } = require('../db');
const { AsyncLock } = require('../helpers/asyncLock');

const _indexLock = new AsyncLock();

const KEY = (id) => `giveaway:${id}`;
const INDEX_KEY = (guildId) => `giveaway_index:${guildId}`;

async function getGiveaway(messageId) {
  try {
    const raw = await db.get(KEY(messageId));
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

async function saveGiveaway(giveaway) {
  if (!giveaway?.id) throw new Error('Giveaway missing id');
  await db.set(KEY(giveaway.id), JSON.stringify(giveaway));
  return giveaway;
}

async function deleteGiveaway(messageId) {
  await db.delete(KEY(messageId));
}

/**
 * Add a giveaway message ID to the guild index.
 * Serialised per-guild to prevent concurrent read-modify-write races.
 */
async function addToIndex(guildId, messageId) {
  return _indexLock.run(INDEX_KEY(guildId), async () => {
    try {
      const raw = await db.get(INDEX_KEY(guildId));
      const ids = raw ? JSON.parse(raw) : [];
      if (!ids.includes(messageId)) ids.push(messageId);
      await db.set(INDEX_KEY(guildId), JSON.stringify(ids));
    } catch {}
  });
}

/**
 * Remove a giveaway message ID from the guild index.
 * Serialised per-guild to prevent concurrent read-modify-write races.
 */
async function removeFromIndex(guildId, messageId) {
  return _indexLock.run(INDEX_KEY(guildId), async () => {
    try {
      const raw = await db.get(INDEX_KEY(guildId));
      if (!raw) return;
      const ids = JSON.parse(raw).filter((id) => id !== messageId);
      await db.set(INDEX_KEY(guildId), JSON.stringify(ids));
    } catch {}
  });
}

async function getGuildGiveawayIds(guildId) {
  try {
    const raw = await db.get(INDEX_KEY(guildId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

module.exports = {
  getGiveaway,
  saveGiveaway,
  deleteGiveaway,
  addToIndex,
  removeFromIndex,
  getGuildGiveawayIds,
};
