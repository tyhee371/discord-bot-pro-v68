
const { Events, ChannelType } = require('discord.js');
const { isTempCategory, clearTempCategory } = require('../utils/ticketV2Store');

module.exports = {
  name: Events.ChannelDelete,
  async execute(client, channel) {
    try {
      const guild = channel.guild;
      if (!guild) return;

      const parentId = channel.parentId;
      if (!parentId) return;

      const parent = guild.channels.cache.get(parentId) ?? (await guild.channels.fetch(parentId).catch(() => null));
      if (!parent || parent.type !== ChannelType.GuildCategory) return;

      const temp = await isTempCategory(guild.id, parentId);
      if (!temp) return;

      // If category has no children left, delete it
      const children = guild.channels.cache.filter(ch => ch.parentId === parentId);
      if (children.size === 0) {
        await parent.delete('Temp ticket category cleanup').catch(() => {});
        await clearTempCategory(guild.id, parentId).catch(() => {});
      }
    } catch (e) {
      console.error('[TICKET] channelDelete cleanup error:', e);
    }
  },
};
