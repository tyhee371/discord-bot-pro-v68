/**
 * Giveaway persistent store — uses the same Keyv db as the rest of the bot.
 * Keys: giveaway:<messageId>
 * Each giveaway is independent of guild settings so it survives settings resets.
 */
const { db } = require('../db');

const KEY = (id) => `giveaway:${id}`;

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
 * List all active (not ended) giveaways across all guilds.
 * Keyv doesn't support listing — we store an index separately.
 */
async function addToIndex(guildId, messageId) {
  try {
    const raw = await db.get(`giveaway_index:${guildId}`);
    const ids = raw ? JSON.parse(raw) : [];
    if (!ids.includes(messageId)) ids.push(messageId);
    await db.set(`giveaway_index:${guildId}`, JSON.stringify(ids));
  } catch {}
}

async function removeFromIndex(guildId, messageId) {
  try {
    const raw = await db.get(`giveaway_index:${guildId}`);
    if (!raw) return;
    const ids = JSON.parse(raw).filter(id => id !== messageId);
    await db.set(`giveaway_index:${guildId}`, JSON.stringify(ids));
  } catch {}
}

async function getGuildGiveawayIds(guildId) {
  try {
    const raw = await db.get(`giveaway_index:${guildId}`);
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
