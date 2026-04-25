const { db } = require('../db');

function ticketKey(guildId, channelId) {
  return `ticket:${guildId}:${channelId}`;
}

async function getTicket(guildId, channelId) {
  return (await db.get(ticketKey(guildId, channelId))) ?? null;
}

async function setTicket(guildId, channelId, data) {
  await db.set(ticketKey(guildId, channelId), data);
}

async function deleteTicket(guildId, channelId) {
  await db.set(ticketKey(guildId, channelId), null);
}

module.exports = { getTicket, setTicket, deleteTicket };
