const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/settings');

function buildVerifyMessage(settings) {
  const v = settings.verify ?? {};
  const embed = new EmbedBuilder()
    .setTitle(v.title || 'Verification')
    .setDescription(v.description || 'Click the button below to verify and gain access to the server.')
    .setColor(0x5865f2);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify')
      .setStyle(ButtonStyle.Success)
      .setLabel('Verify')
      .setEmoji('✅'),
  );

  return { embeds: [embed], components: [row] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verification gate (send a verify button to a channel).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('Set the verification channel + role and post the verify message.')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Verification channel')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .addRoleOption((o) =>
          o
            .setName('role')
            .setDescription('Role to give when users verify')
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('title')
            .setDescription('Embed title (optional)')
            .setRequired(false),
        )
        .addStringOption((o) =>
          o
            .setName('description')
            .setDescription('Embed description (optional)')
            .setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s.setName('resend').setDescription('Re-send the verify message to the configured channel.'),
    )
    .addSubcommand((s) =>
      s.setName('status').setDescription('Show current verification config.'),
    )
    .addSubcommand((s) =>
      s.setName('disable').setDescription('Disable verification (does not delete old messages).'),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    if (!guild) return;

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel', true);
      const role = interaction.options.getRole('role', true);
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');

      // role hierarchy check (bot role must be above target role)
      const me = await guild.members.fetchMe().catch(() => null);
      if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.editReply({
          content: '❌ I need the **Manage Roles** permission to assign the verification role.',
        });
      }
      if (me.roles.highest.comparePositionTo(role) <= 0) {
        return interaction.editReply({
          content: `❌ My highest role must be **above** ${role} in the role list.`,
        });
      }

      const settings = await getGuildSettings(guild.id);
      const patch = {
        verify: {
          enabled: true,
          channelId: channel.id,
          roleId: role.id,
          title: title ?? settings.verify?.title ?? 'Verification',
          description: description ?? settings.verify?.description ?? 'Click the button below to verify and gain access to the server.',
        },
      };
      const next = await setGuildSettings(guild.id, patch);

      const msg = await channel.send(buildVerifyMessage(next)).catch(() => null);
      if (!msg) {
        return interaction.editReply({ content: '❌ I could not send the verify message in that channel. Check my permissions.' });
      }

      await setGuildSettings(guild.id, { verify: { messageId: msg.id } });

      return interaction.editReply({
        content: `✅ Verification enabled in ${channel}.\nRole: ${role}\nMessage: ${msg.url}`,
      });
    }

    if (sub === 'resend') {
      const settings = await getGuildSettings(guild.id);
      const v = settings.verify ?? {};
      if (!v.enabled || !v.channelId || !v.roleId) {
        return interaction.editReply({ content: '⚠️ Verification is not configured. Use `/verify setup` first.' });
      }

      const channel = guild.channels.cache.get(v.channelId) ?? (await guild.channels.fetch(v.channelId).catch(() => null));
      if (!channel?.isTextBased?.()) return interaction.editReply({ content: '❌ Verification channel not found.' });

      const msg = await channel.send(buildVerifyMessage(settings)).catch(() => null);
      if (!msg) return interaction.editReply({ content: '❌ Could not send verify message. Check permissions.' });

      await setGuildSettings(guild.id, { verify: { messageId: msg.id } });
      return interaction.editReply({ content: `✅ Re-sent verification message: ${msg.url}` });
    }

    if (sub === 'status') {
      const settings = await getGuildSettings(guild.id);
      const v = settings.verify ?? {};
      const ch = v.channelId ? `<#${v.channelId}>` : 'Not set';
      const role = v.roleId ? `<@&${v.roleId}>` : 'Not set';
      return interaction.editReply({
        content: `**Verification**\nEnabled: **${v.enabled ? 'Yes' : 'No'}**\nChannel: ${ch}\nRole: ${role}\nMessage ID: ${v.messageId ?? 'Not set'}`,
      });
    }

    if (sub === 'disable') {
      await setGuildSettings(guild.id, { verify: { enabled: false } });
      return interaction.editReply({ content: '✅ Verification disabled.' });
    }
  },
};
