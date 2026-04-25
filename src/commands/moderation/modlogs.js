const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/settings');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { resolveModLogChannel } = require('../../utils/modLogService');
const { safeReply } = require('../../utils/safeReply');

function normalizeLevels(levels) {
  const out = (Array.isArray(levels) ? levels : [])
    .map((l) => ({ threshold: Number(l.threshold), durationMs: Number(l.durationMs), roleId: l.roleId ? String(l.roleId) : null }))
    .filter((l) => Number.isFinite(l.threshold) && l.threshold > 0 && Number.isFinite(l.durationMs) && l.durationMs > 0)
    .sort((a, b) => a.threshold - b.threshold);

  // Keep unique thresholds (last one wins)
  const m = new Map();
  for (const l of out) m.set(l.threshold, { durationMs: l.durationMs, roleId: l.roleId ?? null });
  return [...m.entries()]
    .map(([threshold, v]) => ({ threshold, durationMs: v.durationMs, roleId: v.roleId }))
    .sort((a, b) => a.threshold - b.threshold);
}

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('modlogs')
    .setDescription('Configure moderation log channel and moderation automation.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('Set the moderation log channel (required for moderation commands).')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Mod log channel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addBooleanOption((o) => o.setName('enabled').setDescription('Enable mod logs (default: true)').setRequired(false)),
    )
    .addSubcommand((s) =>
      s
        .setName('status')
        .setDescription('Show current moderation log settings, appeals, and warn automations.'),
    )
    .addSubcommand((s) =>
      s
        .setName('appeals')
        .setDescription('Configure where appeals are sent (used for DM appeal button).')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Appeals review channel')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false),
        )
        .addBooleanOption((o) => o.setName('enabled').setDescription('Enable appeals (default false)').setRequired(false)),
    )
    // Legacy single-threshold auto-timeout
    .addSubcommand((s) =>
      s
        .setName('warn-timeout')
        .setDescription('Legacy: auto-timeout when a user reaches N warnings.')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Enable/disable auto-timeout').setRequired(false))
        .addIntegerOption((o) =>
          o.setName('threshold').setDescription('Warn count to trigger timeout (default 15)').setMinValue(1).setMaxValue(100).setRequired(false),
        )
        .addStringOption((o) =>
          o
            .setName('duration')
            .setDescription('Timeout duration (e.g. 30s, 5m, 2h, 1d). Default: 5m')
            .setRequired(false),
        ),
    )
    // Warn levels
    .addSubcommand((s) =>
      s
        .setName('warn-level-add')
        .setDescription('Add/replace a warn level (e.g. 5 warns -> 00:10:00 jail role).')
        .addIntegerOption((o) => o.setName('threshold').setDescription('Warn count (e.g. 5)').setMinValue(1).setMaxValue(100).setRequired(true))
        .addStringOption((o) => o.setName('duration').setDescription('Role duration (e.g. 00:00:10, 30m, 2h)').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role to apply (optional; defaults to prison role if set)').setRequired(false)),
    )
    .addSubcommand((s) =>
      s
        .setName('warn-level-list')
        .setDescription('List warn levels.'),
    )
    .addSubcommand((s) =>
      s
        .setName('warn-level-clear')
        .setDescription('Clear all warn levels.'),
    )
    .addSubcommand((s) =>
      s
        .setName('prison-setup')
        .setDescription('Configure prison (jail) role assignment when warns reach a threshold.')
        .addRoleOption((o) => o.setName('role').setDescription('Prison role to assign').setRequired(true))
        .addChannelOption((o) => o.setName('jail_channel').setDescription('Text channel where prisoners can send messages').setRequired(true))
        .addIntegerOption((o) => o.setName('threshold').setDescription('Warn count to trigger prison role').setRequired(true).setMinValue(1))
        .addBooleanOption((o) => o.setName('enabled').setDescription('Enable prison automation (default true)').setRequired(false)),
    )
    .addSubcommand((s) =>
      s
        .setName('prison-status')
        .setDescription('Show prison (jail) configuration.'),
    )
,
  async execute(interaction) {
    if (!interaction.guild) {
      return safeReply(interaction, { ephemeral: true, content: '❌ This can only be used in a server.' });
    }

    const sub = interaction.options.getSubcommand();
    const settings = await getGuildSettings(interaction.guildId);

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel', true);
      const enabled = interaction.options.getBoolean('enabled') ?? true;

      const resolved = await resolveModLogChannel(interaction.guild, channel.id);
      if (!resolved) {
        return safeReply(interaction, { ephemeral: true, content: '❌ That channel is not a valid text channel for mod logs.' });
      }

      await setGuildSettings(interaction.guildId, {
        modLogs: {
          enabled,
          channelId: channel.id,
          appeals: settings.modLogs?.appeals ?? { enabled: false, channelId: null },
        },
      });

      return safeReply(interaction, {
        ephemeral: true,
        content: `✅ Mod logs are now **${enabled ? 'enabled' : 'disabled'}** in ${channel}.\nModeration commands will require this to be enabled.`,
      });
    }

    if (sub === 'appeals') {
      const enabled = interaction.options.getBoolean('enabled');
      const channel = interaction.options.getChannel('channel');

      let chId = settings.modLogs?.appeals?.channelId ?? null;
      if (channel) {
        const resolved = await resolveModLogChannel(interaction.guild, channel.id);
        if (!resolved) return safeReply(interaction, { ephemeral: true, content: '❌ That channel is not a valid text channel for appeals.' });
        chId = channel.id;
      }

      const nextEnabled = typeof enabled === 'boolean' ? enabled : (settings.modLogs?.appeals?.enabled ?? false);

      await setGuildSettings(interaction.guildId, {
        modLogs: {
          enabled: settings.modLogs?.enabled ?? true,
          channelId: settings.modLogs?.channelId ?? null,
          appeals: {
            enabled: nextEnabled,
            channelId: chId,
          },
        },
      });

      return safeReply(interaction, {
        ephemeral: true,
        content: `✅ Appeals are now **${nextEnabled ? 'enabled' : 'disabled'}**. Channel: ${chId ? `<#${chId}>` : 'Not set'}`,
      });
    }

    if (sub === 'status') {
      const cfg = settings.modLogs ?? {};
      const wa = settings.moderation?.warnAutoTimeout ?? {};
      const levels = normalizeLevels(settings.moderation?.warnLevels ?? []);

      const chText = cfg.channelId ? `<#${cfg.channelId}>` : 'Not set';
      const appealText = cfg.appeals?.enabled ? `✅ ON (${cfg.appeals.channelId ? `<#${cfg.appeals.channelId}>` : 'No channel'})` : '❌ OFF';

      const warnDur = formatDuration(wa.durationMs ?? 5 * 60 * 1000);
      const levelsText = levels.length
        ? levels.map((l) => `• **${l.threshold}** → **${formatDuration(l.durationMs)}**`).join('\n')
        : 'No warn levels configured.';

      return safeReply(interaction, {
        ephemeral: true,
        content:
          `**Mod Logs:** ${cfg.enabled ? '✅ ON' : '❌ OFF'}\n` +
          `Channel: ${chText}\n` +
          `Appeals: ${appealText}\n\n` +
          `**Warn Levels (recommended):**\n${levelsText}\n\n` +
          `**Legacy Warn Auto-Timeout:** ${wa.enabled ? '✅ ON' : '❌ OFF'}\n` +
          `Threshold: **${wa.threshold ?? 15} warns**\n` +
          `Timeout: **${warnDur}**`,
      });
    }

    if (sub === 'warn-timeout') {
      const enabled = interaction.options.getBoolean('enabled');
      const threshold = interaction.options.getInteger('threshold');
      const durationRaw = interaction.options.getString('duration');

      let durationMs;
      if (durationRaw != null) {
        durationMs = parseDuration(durationRaw);
        if (!durationMs) {
          return safeReply(interaction, { ephemeral: true, content: '❌ Invalid duration. Use formats like `30s`, `5m`, `2h`, `1d`.' });
        }
      }

      const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
      if (durationMs && durationMs > MAX_TIMEOUT_MS) {
        return safeReply(interaction, { ephemeral: true, content: '❌ Duration is too long. Max is 28 days.' });
      }

      const next = {
        moderation: {
          warnAutoTimeout: {
            enabled: typeof enabled === 'boolean' ? enabled : (settings.moderation?.warnAutoTimeout?.enabled ?? true),
            threshold: Number.isFinite(threshold) ? threshold : (settings.moderation?.warnAutoTimeout?.threshold ?? 15),
            durationMs: Number.isFinite(durationMs) ? durationMs : (settings.moderation?.warnAutoTimeout?.durationMs ?? 5 * 60 * 1000),
          },
          warnLevels: settings.moderation?.warnLevels ?? [],
        },
      };

      const updated = await setGuildSettings(interaction.guildId, next);
      const wa = updated.moderation.warnAutoTimeout;

      return safeReply(interaction, {
        ephemeral: true,
        content:
          `✅ Updated legacy warn auto-timeout:\n` +
          `• Enabled: **${wa.enabled ? 'Yes' : 'No'}**\n` +
          `• Threshold: **${wa.threshold} warns**\n` +
          `• Timeout: **${formatDuration(wa.durationMs)}**`,
      });
    }

    if (sub === 'warn-level-add') {
      const threshold = interaction.options.getInteger('threshold', true);
      const durationRaw = interaction.options.getString('duration', true);
      const role = interaction.options.getRole('role');

      const durationMs = parseDuration(durationRaw);
      if (!durationMs) return safeReply(interaction, { ephemeral: true, content: '❌ Invalid duration. Use `30s`, `5m`, `2h`, `1d`.' });

      const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
      if (durationMs > MAX_TIMEOUT_MS) return safeReply(interaction, { ephemeral: true, content: '❌ Duration is too long. Max is 28 days.' });

      const curLevels = normalizeLevels(settings.moderation?.warnLevels ?? []);
      curLevels.push({ threshold, durationMs, roleId: role?.id ?? null });
      const merged = normalizeLevels(curLevels);

      const updated = await setGuildSettings(interaction.guildId, { moderation: { ...(settings.moderation ?? {}), warnLevels: merged } });

      return safeReply(interaction, {
        ephemeral: true,
        content:
          `✅ Saved warn level **${threshold}** → **${formatDuration(durationMs)}**${role ? ` (role: <@&${role.id}>)` : ''}.\n` +
          `Current levels:\n` +
          merged
            .map((l) =>
              `• **${l.threshold}** → **${formatDuration(l.durationMs)}**` +
              (l.roleId ? ` (role: <@&${l.roleId}>)` : ' (role: uses /modlogs prison role)')
            )
            .join('\n'),
      });
    }

    if (sub === 'warn-level-list') {
      const levels = normalizeLevels(settings.moderation?.warnLevels ?? []);
      if (!levels.length) return safeReply(interaction, { ephemeral: true, content: 'No warn levels configured.' });
      return safeReply(interaction, {
        ephemeral: true,
        content:
          `Warn levels:\n` +
          levels
            .map((l) =>
              `• **${l.threshold}** → **${formatDuration(l.durationMs)}**` +
              (l.roleId ? ` (role: <@&${l.roleId}>)` : ' (role: uses /modlogs prison role)')
            )
            .join('\n'),
      });
    }

    if (sub === 'warn-level-clear') {
      await setGuildSettings(interaction.guildId, { moderation: { ...(settings.moderation ?? {}), warnLevels: [] } });
      return safeReply(interaction, { ephemeral: true, content: '✅ Cleared all warn levels.' });
    }

    
    if (sub === 'prison-setup') {
      const role = interaction.options.getRole('role', true);
      const jailChannel = interaction.options.getChannel('jail_channel', true);
      const threshold = interaction.options.getInteger('threshold', true);
      const enabled = interaction.options.getBoolean('enabled');
      const isEnabled = enabled !== null ? enabled : true;

      settings.moderation = settings.moderation || {};
      settings.moderation.prison = {
        roleId: role.id,
        jailChannelId: jailChannel.id,
        threshold,
        enabled: isEnabled,
      };

      await setGuildSettings(interaction.guildId, settings);

      // Apply permission overwrites: deny talking everywhere, deny connecting to voice; allow talking in jail channel.
      let touched = 0;
      let failed = 0;
      const denyText = {
        SendMessages: false,
        AddReactions: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
        SendMessagesInThreads: false,
        UseApplicationCommands: false,
      };
      const denyVoice = {
        Connect: false,
        Speak: false,
        Stream: false,
        UseVAD: false,
      };

      const channels = interaction.guild.channels.cache;
      for (const [, ch] of channels) {
        try {
          if (ch.id === jailChannel.id) {
            await ch.permissionOverwrites.edit(role, {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true,
              AddReactions: true,
            });
            touched += 1;
            continue;
          }

          // Text-based channels
          if (ch.isTextBased && ch.isTextBased()) {
            await ch.permissionOverwrites.edit(role, { ...denyText });
            touched += 1;
            continue;
          }

          // Voice channels / stages
          if (ch.isVoiceBased && ch.isVoiceBased()) {
            await ch.permissionOverwrites.edit(role, { ...denyVoice });
            touched += 1;
          }
        } catch (e) {
          failed += 1;
        }
      }

      return safeReply(interaction, {
        ephemeral: true,
        content:
          `✅ Prison configured.\n` +
          `• Role: <@&${role.id}>\n` +
          `• Jail channel: <#${jailChannel.id}>\n` +
          `• Threshold: **${threshold}** warn(s)\n` +
          `• Enabled: **${isEnabled ? 'Yes' : 'No'}**\n` +
          `• Channel overwrites applied: **${touched}** (failed: **${failed}**)`,
      });
    }

    if (sub === 'prison-status') {
      const prison = settings?.moderation?.prison;
      if (!prison?.roleId) {
        return safeReply(interaction, { ephemeral: true, content: 'Prison is not configured yet. Use `/modlogs prison-setup`.' });
      }
      return safeReply(interaction, {
        ephemeral: true,
        content:
          `🔒 Prison config:\n` +
          `• Role: <@&${prison.roleId}>\n` +
          `• Jail channel: <#${prison.jailChannelId || 'unknown'}>\n` +
          `• Threshold: **${prison.threshold || '??'}**\n` +
          `• Enabled: **${prison.enabled ? 'Yes' : 'No'}**`,
      });
    }

return safeReply(interaction, { ephemeral: true, content: 'Unknown subcommand.' });
  },
};
