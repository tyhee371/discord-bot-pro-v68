const { db } = require('../db');

function key(guildId) {
  return `prisonTimers:${guildId}`;
}

async function getAll(guildId) {
  return (await db.get(key(guildId))) ?? {};
}

async function getTimer(guildId, userId) {
  const all = await getAll(guildId);
  return all[userId] ?? null;
}

async function setTimer(guildId, userId, data) {
  const all = await getAll(guildId);
  all[userId] = data;
  await db.set(key(guildId), all);
  return all[userId];
}

async function clearTimer(guildId, userId) {
  const all = await getAll(guildId);
  if (!all[userId]) return false;
  delete all[userId];
  await db.set(key(guildId), all);
  return true;
}

async function replaceAll(guildId, next) {
  await db.set(key(guildId), next ?? {});
}

module.exports = {
  getAll,
  getTimer,
  setTimer,
  clearTimer,
  replaceAll,
};
