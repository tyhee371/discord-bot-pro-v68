const { db } = require('../db');

function openTicketKey(guildId, userId) {
  return `ticketOpen:${guildId}:${userId}`;
}

async function getOpenTicketChannelId(guildId, userId) {
  return (await db.get(openTicketKey(guildId, userId))) ?? null;
}

async function setOpenTicketChannelId(guildId, userId, channelId) {
  await db.set(openTicketKey(guildId, userId), channelId);
}

async function clearOpenTicketChannelId(guildId, userId) {
  await db.set(openTicketKey(guildId, userId), null);
}

function safeChannelName(username) {
  return `ticket-${username}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90);
}

module.exports = {
  getOpenTicketChannelId,
  setOpenTicketChannelId,
  clearOpenTicketChannelId,
  safeChannelName,
};
