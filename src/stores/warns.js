const { db } = require('../db');
const { AsyncLock } = require('../helpers/asyncLock');

const _lock = new AsyncLock();

function warnKey(guildId, userId) {
  return `warns:${guildId}:${userId}`;
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function addWarn(guildId, userId, moderatorId, reason) {
  const key = warnKey(guildId, userId);
  return _lock.run(key, async () => {
    const warns = (await db.get(key)) ?? [];
    const w = { id: makeId(), moderatorId, reason, createdAt: Date.now() };
    warns.push(w);
    await db.set(key, warns);
    return w;
  });
}

async function listWarns(guildId, userId) {
  return (await db.get(warnKey(guildId, userId))) ?? [];
}

async function countWarns(guildId, userId) {
  const list = await listWarns(guildId, userId);
  return list.length;
}

async function removeWarn(guildId, userId, warnId) {
  const key = warnKey(guildId, userId);
  return _lock.run(key, async () => {
    const warns = (await db.get(key)) ?? [];
    const next = warns.filter((w) => w.id !== warnId);
    await db.set(key, next);
    return warns.length !== next.length;
  });
}

/**
 * Clear all warns for a user.
 * Returns the number of warns that were cleared.
 */
async function clearWarns(guildId, userId) {
  const key = warnKey(guildId, userId);
  return _lock.run(key, async () => {
    const existing = (await db.get(key)) ?? [];
    const count = existing.length;
    await db.set(key, []);
    return count;
  });
}

module.exports = { addWarn, listWarns, countWarns, removeWarn, clearWarns };
