const { db } = require('../db');

function warnKey(guildId, userId) {
  return `warns:${guildId}:${userId}`;
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function addWarn(guildId, userId, moderatorId, reason) {
  const key = warnKey(guildId, userId);
  const warns = (await db.get(key)) ?? [];
  const w = { id: makeId(), moderatorId, reason, createdAt: Date.now() };
  warns.push(w);
  await db.set(key, warns);
  return w;
}

async function listWarns(guildId, userId) {
  return (await db.get(warnKey(guildId, userId))) ?? [];
}

async function removeWarn(guildId, userId, warnId) {
  const key = warnKey(guildId, userId);
  const warns = (await db.get(key)) ?? [];
  const next = warns.filter(w => w.id !== warnId);
  await db.set(key, next);
  return warns.length !== next.length;
}

async function clearWarns(guildId, userId) {
  await db.set(warnKey(guildId, userId), []);
}

module.exports = { addWarn, listWarns, removeWarn, clearWarns };
