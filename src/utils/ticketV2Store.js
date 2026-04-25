
const { db } = require('../db');

function serialKey(guildId) {
  return `ticketSerial:${guildId}`;
}

async function nextSerial(guildId) {
  const current = (await db.get(serialKey(guildId))) ?? 0;
  const next = Number(current) + 1;
  await db.set(serialKey(guildId), next);
  return String(next).padStart(4, '0');
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
