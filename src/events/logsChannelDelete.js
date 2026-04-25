const { Events, EmbedBuilder, ChannelType } = require('discord.js');
const { getLogConfig, sendLogEmbed, safeField } = require('../utils/logService');

function isVoiceChannel(ch) {
  return ch?.type === ChannelType.GuildVoice || ch?.type === ChannelType.GuildStageVoice;
}

function parentName(guild, ch) {
  return ch.parent?.name || (ch.parentId ? (guild.channels.cache.get(ch.parentId)?.name ?? 'unknown') : 'None');
}

module.exports = {
  name: Events.ChannelDelete,
  async execute(client, channel) {
    try {
      const guild = channel.guild;
      if (!guild) return;

      const cfg = await getLogConfig(guild.id);
      if (!cfg.enabled) return;

      const voice = isVoiceChannel(channel);
      if (voice && !cfg.events.voice) return;
      if (!voice && !cfg.events.channel) return;

      const title = voice ? 'Voice channel deleted' : 'Channel deleted';
      const color = 0xe74c3c;

      const emb = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .addFields(
          { name: 'Name', value: safeField(channel?.name ?? 'unknown'), inline: false },
          { name: 'Category', value: safeField(parentName(guild, channel)), inline: true },
          { name: 'Type', value: safeField(voice ? 'Voice' : 'Text'), inline: true },
        )
        .setFooter({ text: `Channel ID: ${channel.id}` })
        .setTimestamp();

      await sendLogEmbed(guild, emb);
    } catch {}
  },
};
