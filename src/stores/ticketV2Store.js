const { db } = require('../db');
const { AsyncLock } = require('../helpers/asyncLock');

const _serialLock = new AsyncLock();

function serialKey(guildId) {
  return `ticketSerial:${guildId}`;
}

/**
 * Atomically increment and return the next ticket serial for a guild.
 * Serialised with AsyncLock so two concurrent ticket opens never get
 * the same number.
 */
async function nextSerial(guildId) {
  const key = serialKey(guildId);
  return _serialLock.run(key, async () => {
    const current = (await db.get(key)) ?? 0;
    const next = Number(current) + 1;
    await db.set(key, next);
    return String(next).padStart(4, '0');
  });
}

function typeCategoryKey(guildId, typeValue) {
  return `ticketCat:${guildId}:${typeValue}`;
}

async function getCategoryIdForType(guildId, typeValue) {
  return (await db.get(typeCategoryKey(guildId, typeValue))) ?? null;
}

async function setCategoryIdForType(guildId, typeValue, categoryId) {
  await db.set(typeCategoryKey(guildId, typeValue), categoryId);
}

function tempCategoryKey(guildId, categoryId) {
  return `ticketTempCat:${guildId}:${categoryId}`;
}

async function markTempCategory(guildId, categoryId) {
  await db.set(tempCategoryKey(guildId, categoryId), true);
}

async function isTempCategory(guildId, categoryId) {
  return (await db.get(tempCategoryKey(guildId, categoryId))) === true;
}

async function clearTempCategory(guildId, categoryId) {
  await db.set(tempCategoryKey(guildId, categoryId), null);
}

module.exports = {
  nextSerial,
  getCategoryIdForType,
  setCategoryIdForType,
  markTempCategory,
  isTempCategory,
  clearTempCategory,
};
