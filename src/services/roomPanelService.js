const { buildRoomEmbed, buildRoomButtons } = require('../utils/roomPanel');
const { setRoom } = require('../services/tempRoomService');

async function refreshRoomPanel(guild, voiceChannel, room) {
  const embed = buildRoomEmbed({ channel: voiceChannel, room });
  const rows = buildRoomButtons();

  // Try voice chat first
  try {
    if (room.controlMessageId) {
      const msg = await voiceChannel.messages.fetch(room.controlMessageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed], components: rows });
        return;
      }
    }
  } catch {
    // ignore
  }

  // Fallback to paired text if exists
  if (room.textChannelId && room.controlMessageId) {
    const txt = await guild.channels.fetch(room.textChannelId).catch(() => null);
    if (txt) {
      const msg = await txt.messages.fetch(room.controlMessageId).catch(() => null);
      if (msg) await msg.edit({ embeds: [embed], components: rows }).catch(() => {});
    }
  }
}

module.exports = { refreshRoomPanel };
