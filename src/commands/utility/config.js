/**
 * /config — configuration validation and inspection for administrators.
 *
 * Subcommands:
 *   validate   — run the full config health check and report errors/warnings
 *   show       — display the current settings summary
 */

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');

const { getGuildSettings } = require('../../utils/settings');
const { validateConfig, formatValidationResults } = require('../../utils/configValidator');
const { safeReply } = require('../../utils/safeReply');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('View and validate server configuration.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName('validate').setDescription('Run a full configuration health check.'),
    )
    .addSubcommand((s) =>
      s.setName('show').setDescription('Show a summary of current bot settings.'),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const settings = await getGuildSettings(interaction.guildId);

    // ── validate ────────────────────────────────────────────────────────────
    if (sub === 'validate') {
      await interaction.editReply({ content: '🔍 Running configuration checks…' });

      const results = await validateConfig(guild, settings);
      const { fields, summary } = formatValidationResults(results);

      const embed = new EmbedBuilder()
        .setTitle('⚙️ Configuration Health Check')
        .setDescription(summary)
        .setFooter({ text: `${guild.name} • ${results.length} checks run` })
        .setTimestamp();

      // Discord caps embed fields at 25
      embed.addFields(fields.slice(0, 25));

      return interaction.editReply({ content: '', embeds: [embed] });
    }

    // ── show ────────────────────────────────────────────────────────────────
    if (sub === 'show') {
      const prefix = settings.prefix ?? '!';
      const modLogs = settings.modLogs ?? {};
      const logs = settings.logs ?? {};
      const verify = settings.verify ?? {};
      const tickets = settings.tickets ?? {};
      const starboard = settings.starboard ?? {};
      const sb = settings.starboard ?? {};

      const tf = (v) => (v ? '✅ Enabled' : '❌ Disabled');
      const ch = (id) => (id ? `<#${id}>` : 'Not set');
      const role = (id) => (id ? `<@&${id}>` : 'Not set');

      const embed = new EmbedBuilder()
        .setTitle(`⚙️ ${guild.name} — Bot Configuration`)
        .setThumbnail(guild.iconURL({ size: 64 }))
        .setTimestamp()
        .addFields(
          { name: '📝 Prefix', value: `\`${prefix}\``, inline: true },
          { name: '\u200b', value: '\u200b', inline: true },
          { name: '\u200b', value: '\u200b', inline: true },
          {
            name: '🛡️ Mod Logs',
            value: `${tf(modLogs.enabled)}\nChannel: ${ch(modLogs.channelId)}`,
            inline: true,
          },
          {
            name: '📋 Server Logs',
            value: `${tf(logs.enabled)}\nChannel: ${ch(logs.channelId)}`,
            inline: true,
          },
          {
            name: '✅ Verification',
            value: `${tf(verify.enabled)}\nChannel: ${ch(verify.channelId)}\nRole: ${role(verify.roleId)}`,
            inline: true,
          },
          {
            name: '🎫 Tickets',
            value: [
              `Panels: **${Object.keys(tickets.builders ?? {}).length}**`,
              `Admin role: ${role(tickets.adminRoleId)}`,
              `Mod role: ${role(tickets.modRoleId)}`,
              `Transcript ch: ${ch(tickets.transcriptChannelId)}`,
              `Progress ch: ${ch(tickets.progressChannelId)}`,
              `Claim timeout: **${tickets.claimTimeoutSeconds ?? 60}s**`,
            ].join('\n'),
            inline: true,
          },
          {
            name: '⭐ Starboard',
            value: `${tf(sb.enabled)}\nChannel: ${ch(sb.channelId)}\nThreshold: **${sb.threshold ?? 3}** ⭐`,
            inline: true,
          },
          {
            name: '⚖️ Auto-Warn Timeout',
            value: [
              tf(settings.moderation?.warnAutoTimeout?.enabled),
              `Threshold: **${settings.moderation?.warnAutoTimeout?.threshold ?? 15}** warns`,
            ].join('\n'),
            inline: true,
          },
          {
            name: '🏠 Temp Rooms',
            value: settings.tempRooms?.masterChannelId
              ? `Master: ${ch(settings.tempRooms.masterChannelId)}`
              : '❌ Not configured',
            inline: true,
          },
        )
        .setFooter({ text: `Schema v${settings.schemaVersion ?? '?'} • Run /config validate for a full health check` });

      return interaction.editReply({ content: '', embeds: [embed] });
    }

    return safeReply(interaction, { content: 'Unknown subcommand.', flags: MessageFlags.Ephemeral });
  },
};
