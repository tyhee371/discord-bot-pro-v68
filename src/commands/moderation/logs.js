const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/settings');
const { resolveLogChannel } = require('../../utils/logService');
const { safeReply, safeDefer } = require('../../utils/safeReply');

async function replyOrEdit(interaction, payload) {
  // interactionCreate may auto-defer; editReply must NOT include ephemeral/flags changes
  const clean = { ...payload };
  delete clean.ephemeral;
  delete clean.flags;

  try {
    if (interaction.deferred || interaction.replied) return await interaction.editReply(clean);
    // for non-deferred, enforce ephemeral via flags
    return await safeReply(interaction, { ...clean, ephemeral: true });
  } catch {
    // if something still went wrong, try to edit the deferred reply so Discord stops "thinking"
    if (interaction.deferred) {
      return interaction.editReply({ content: clean.content ?? '✅ Done.', embeds: clean.embeds, components: clean.components }).catch(() => {});
    }
    return interaction.followUp?.({ ...clean, ephemeral: true }).catch(() => {});
  }
}


module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Configure server log channel (Arcane-style).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('Enable logs and choose the channel to send logs to.')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Log channel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addBooleanOption((o) => o.setName('enabled').setDescription('Enable logs (default: true)').setRequired(false)),
    )
    .addSubcommand((s) =>
      s
        .setName('toggle')
        .setDescription('Enable/disable logs.')
        .addBooleanOption((o) => o.setName('enabled').setDescription('On/Off').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show current log configuration.'))
    .addSubcommand((s) =>
      s
        .setName('audit-toggle')
        .setDescription('Enable/disable sending Audit Log events to the log channel.')
        .addBooleanOption((o) => o.setName('enabled').setDescription('On/Off').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('test').setDescription('Send a test log embed to the configured log channel.')),
  async execute(interaction) {
    if (!interaction.guild) return replyOrEdit(interaction, { content: '❌ This can only be used in a server.', ephemeral: true });

    const sub = interaction.options.getSubcommand();
    const settings = await getGuildSettings(interaction.guildId);
    const cfg = settings.logs ?? { events: {} };

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel', true);
      const enabled = interaction.options.getBoolean('enabled') ?? true;

      const resolved = await resolveLogChannel(interaction.guild, channel.id);
      if (!resolved) {
        return replyOrEdit(interaction, { content: '❌ That channel is not a valid text channel for logs.', ephemeral: true });
      }

      await setGuildSettings(interaction.guildId, {
        logs: {
          ...cfg,
          enabled,
          channelId: channel.id,
        },
      });

      return replyOrEdit(interaction, {
        content: `✅ Logs are now **${enabled ? 'enabled' : 'disabled'}**.\nLog channel: ${channel}`,
        ephemeral: true,
      });
    }

    if (sub === 'toggle') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await setGuildSettings(interaction.guildId, { logs: { ...cfg, enabled } });
      return replyOrEdit(interaction, { content: `✅ Logs are now **${enabled ? 'enabled' : 'disabled'}**.`, ephemeral: true });
    }

    if (sub === 'status') {
      const chId = cfg.channelId ?? null;
      const ch = chId ? `<#${chId}>` : 'Not set';
      const emb = new EmbedBuilder()
        .setTitle('🧾 Log Settings')
        .addFields(
          { name: 'Enabled', value: cfg.enabled ? '✅ Yes' : '❌ No', inline: true },
          { name: 'Channel', value: String(ch), inline: true },
          { name: 'Ignore bots', value: cfg.ignoreBots === false ? '❌ No' : '✅ Yes', inline: true },
          {
            name: 'Events',
            value:
              `Channel: **${cfg.events?.channel !== false ? 'On' : 'Off'}**\n` +
              `Channel update: **${cfg.events?.channelUpdate !== false ? 'On' : 'Off'}**\n` +
              `Voice: **${cfg.events?.voice !== false ? 'On' : 'Off'}**\n` +
              `Message edit: **${cfg.events?.messageEdit !== false ? 'On' : 'Off'}**\n` +
              `Message delete: **${cfg.events?.messageDelete !== false ? 'On' : 'Off'}**\n` +
              `Bulk delete: **${cfg.events?.bulkDelete !== false ? 'On' : 'Off'}**\n` +
              `Attachment remove: **${cfg.events?.attachmentRemove !== false ? 'On' : 'Off'}**\n` +
              `Role: **${cfg.events?.role !== false ? 'On' : 'Off'}**\n` +
              `Audit: **${cfg.events?.audit !== false ? 'On' : 'Off'}**`,
            inline: false,
          },
        )
        .setTimestamp();

      return replyOrEdit(interaction, { embeds: [emb], ephemeral: true });
    }

    if (sub === 'audit-toggle') {
      const enabled = interaction.options.getBoolean('enabled', true);
      const events = { ...(cfg.events ?? {}), audit: enabled };
      await setGuildSettings(interaction.guildId, { logs: { ...cfg, events } });
      return replyOrEdit(interaction, { content: `✅ Audit logs are now **${enabled ? 'enabled' : 'disabled'}**.`, ephemeral: true });
    }

    if (sub === 'test') {
      if (!cfg.enabled || !cfg.channelId) {
        return replyOrEdit(interaction, { content: '⚠️ Logs are not enabled or channel not set. Use `/logs setup` first.', ephemeral: true });
      }

      const ch = await resolveLogChannel(interaction.guild, cfg.channelId);
      if (!ch) {
        return replyOrEdit(interaction, { content: '⚠️ Log channel not found or not valid. Use `/logs setup` again.', ephemeral: true });
      }

      const emb = new EmbedBuilder()
        .setTitle('✅ Log system test')
        .setDescription(`This is a test log message.\nChannel: ${ch}`)
        .setFooter({ text: `Guild: ${interaction.guild.id}` })
        .setTimestamp();

      await ch.send({ embeds: [emb] });
      return replyOrEdit(interaction, { content: `✅ Sent a test log message to ${ch}.`, ephemeral: true });
    }
  },
};