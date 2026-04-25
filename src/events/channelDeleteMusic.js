
const { Events } = require('discord.js');
const { getGuildSettings } = require('../utils/settings');
const { leave } = require('../services/musicService');

module.exports = {
  name: Events.ChannelDelete,
  async execute(client, channel) {
    try {
      if (!channel?.guild) return;
      const settings = await getGuildSettings(channel.guild.id);
      const voiceChannelId = settings?.music?.voiceChannelId ?? null;
      if (!voiceChannelId) return;

      if (channel.id === voiceChannelId) {
        await leave(channel.guild.id, 'Voice channel deleted');
      }
    } catch (e) {
      console.error('[MUSIC] channelDelete error:', e);
    }
  },
};
