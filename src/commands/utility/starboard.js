const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const { replyOrEdit } = require('../../utils/reply');
const { getGuildSettings, setGuildSettings } = require('../../utils/settings');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('starboard')
    .setDescription('Starboard (⭐) reposts popular messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName('setup')
        .setDescription('Enable starboard.')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Starboard channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)
        )
        .addIntegerOption((o) =>
          o.setName('threshold').setDescription('Stars required (default 3)').setMinValue(1).setMaxValue(50).setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s.setName('off').setDescription('Disable starboard.')
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show starboard status.')),

  async execute(interaction) {
    if (!interaction.guild) return replyOrEdit(interaction, { content: '❌ Server only.' });

    const sub = interaction.options.getSubcommand();
    const settings = await getGuildSettings(interaction.guildId);
    const sb = settings.starboard ?? {};

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel', true);
      const threshold = interaction.options.getInteger('threshold') ?? 3;

      await setGuildSettings(interaction.guildId, { starboard: { enabled: true, channelId: channel.id, threshold } });
      return replyOrEdit(interaction, { content: `✅ Starboard enabled in ${channel} (threshold: **${threshold}** ⭐).` });
    }

    if (sub === 'off') {
      await setGuildSettings(interaction.guildId, { starboard: { enabled: false } });
      return replyOrEdit(interaction, { content: '✅ Starboard disabled.' });
    }

    if (sub === 'status') {
      const enabled = sb.enabled ? '✅ Yes' : '❌ No';
      const ch = sb.channelId ? `<#${sb.channelId}>` : 'Not set';
      const th = sb.threshold ?? 3;

      const emb = new EmbedBuilder().setTitle('⭐ Starboard').addFields(
        { name: 'Enabled', value: enabled, inline: true },
        { name: 'Channel', value: String(ch), inline: true },
        { name: 'Threshold', value: String(th), inline: true },
      ).setTimestamp();

      return replyOrEdit(interaction, { embeds: [emb] });
    }
  },
};
