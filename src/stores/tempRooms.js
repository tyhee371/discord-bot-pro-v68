const { db } = require('../db');

function roomKey(guildId, channelId) {
  return `room:${guildId}:${channelId}`;
}

function ownerKey(guildId, userId) {
  return `roomOwner:${guildId}:${userId}`;
}

async function getRoom(guildId, channelId) {
  return (await db.get(roomKey(guildId, channelId))) ?? null;
}

async function setRoom(guildId, channelId, data) {
  const prev = await getRoom(guildId, channelId);
  if (prev?.ownerId && prev.ownerId !== data?.ownerId) {
    await db.set(ownerKey(guildId, prev.ownerId), null);
  }

  await db.set(roomKey(guildId, channelId), data);

  if (data?.ownerId) {
    await db.set(ownerKey(guildId, data.ownerId), channelId);
  }
}

async function deleteRoom(guildId, channelId) {
  const r = await getRoom(guildId, channelId);
  if (r?.ownerId) await db.set(ownerKey(guildId, r.ownerId), null);
  await db.set(roomKey(guildId, channelId), null);
}

async function getRoomByOwner(guildId, ownerId) {
  return (await db.get(ownerKey(guildId, ownerId))) ?? null;
}

function defaultRoomData({ guildId, channelId, ownerId, controlMessageId, textChannelId }) {
  return {
    guildId,
    channelId,
    textChannelId: textChannelId ?? null,
    ownerId,
    controlMessageId: controlMessageId ?? null,
    isLocked: false,
    isHidden: false,
    rtcRegion: null,
    userLimit: 0,
    bitrate: null,
    permitted: [],
    banned: [],
    createdAt: Date.now(),
  };
}

module.exports = {
  getRoom,
  setRoom,
  deleteRoom,
  getRoomByOwner,
  defaultRoomData,
};
