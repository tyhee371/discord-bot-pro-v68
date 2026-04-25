const { Events } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../utils/settings');

module.exports = {
  name: Events.MessageCreate,
  async execute(client, message) {
    try {
      if (!message.guild || message.author?.bot) return;

      const settings = await getGuildSettings(message.guild.id);
      const sticky = settings.sticky ?? {};
      const cfg = sticky[message.channel.id];
      if (!cfg?.message) return;

      // ignore if the message itself is the sticky message we posted
      if (cfg.lastMessageId && message.id === cfg.lastMessageId) return;

      // delete previous sticky message if exists
      if (cfg.lastMessageId) {
        const prev = await message.channel.messages.fetch(cfg.lastMessageId).catch(() => null);
        if (prev) await prev.delete().catch(() => {});
      }

      const sent = await message.channel.send({ content: cfg.message }).catch(() => null);
      if (!sent) return;

      sticky[message.channel.id] = { ...cfg, lastMessageId: sent.id };
      await setGuildSettings(message.guild.id, { sticky });
    } catch {
      // ignore
    }
  },
};
