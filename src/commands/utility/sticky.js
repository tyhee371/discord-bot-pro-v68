const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { replyOrEdit } = require('../../utils/reply');
const { getGuildSettings, setGuildSettings } = require('../../utils/settings');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Sticky message (reposts when chat moves).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName('set')
        .setDescription('Set a sticky message for a channel.')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)
        )
        .addStringOption((o) => o.setName('message').setDescription('Sticky text').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('off')
        .setDescription('Disable sticky message for a channel.')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)
        )
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show sticky status.')),

  async execute(interaction) {
    if (!interaction.guild) return replyOrEdit(interaction, { content: '❌ Server only.' });

    const sub = interaction.options.getSubcommand();
    const settings = await getGuildSettings(interaction.guildId);
    const sticky = settings.sticky ?? {};

    if (sub === 'set') {
      const ch = interaction.options.getChannel('channel', true);
      const msg = interaction.options.getString('message', true);

      sticky[ch.id] = { message: msg, lastMessageId: null };
      await setGuildSettings(interaction.guildId, { sticky });

      return replyOrEdit(interaction, { content: `✅ Sticky message set for ${ch}.` });
    }

    if (sub === 'off') {
      const ch = interaction.options.getChannel('channel', true);
      delete sticky[ch.id];
      await setGuildSettings(interaction.guildId, { sticky });
      return replyOrEdit(interaction, { content: `✅ Sticky disabled for ${ch}.` });
    }

    if (sub === 'status') {
      const keys = Object.keys(sticky);
      if (!keys.length) return replyOrEdit(interaction, { content: 'No sticky messages configured.' });

      const lines = keys.map((id) => `<#${id}>: ${String(sticky[id]?.message ?? '').slice(0, 60)}${String(sticky[id]?.message ?? '').length > 60 ? '…' : ''}`);
      return replyOrEdit(interaction, { content: lines.join('\n') });
    }
  },
};
