const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { safeReply } = require('../../utils/safeReply');
const { requireDev } = require('../../utils/devAccess');
const { setErrorsConfig, getErrorsConfig } = require('../../utils/errorReporter');
const { getSafeModeConfig, setSafeModeConfig, listDisabled, resetDisabled } = require('../../utils/safeMode');
const { buildAnalyticsSnapshot, formatSnapshotFields } = require('../../app/analyticsService');
const { captureSnapshot, runCanaryChecks } = require('../../app/diagnosticsSnapshot');
const { EmbedBuilder } = require('discord.js');

module.exports = {
  // Mark as dev-only so /help can hide it from normal users.
  devOnly: true,
  data: new SlashCommandBuilder()
    .setName('dev')
    .setDescription('Developer tools (dev/tester only).')
    // Limit visibility to server managers by default. Actual access is controlled by BOT_DEV_* allowlist.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommandGroup((g) =>
      g
        .setName('errors')
        .setDescription('Error reporting tools')
        .addSubcommand((s) =>
          s
            .setName('setup')
            .setDescription('Enable error reporting to a channel')
            .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)),
        )
        .addSubcommand((s) => s.setName('off').setDescription('Disable error reporting'))
        .addSubcommand((s) => s.setName('test').setDescription('Send a test error (throws)')),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('reliability')
        .setDescription('Reliability engineering and health tools')
        .addSubcommand((s) => s.setName('canary').setDescription('Run canary health checks'))
        .addSubcommand((s) => s.setName('snapshot').setDescription('Export full diagnostics snapshot'))
        .addSubcommand((s) =>
          s
            .setName('chaos')
            .setDescription('Chaos drill: simulate a component failure to test resilience')
            .addStringOption((o) =>
              o.setName('target')
                .setDescription('Component to stress')
                .setRequired(true)
                .addChoices(
                  { name: 'metrics (reset counters)', value: 'metrics' },
                  { name: 'settings_cache (flush cache)', value: 'settings_cache' },
                  { name: 'scheduler (report queue depth)', value: 'scheduler' },
                ),
            ),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('analytics')
        .setDescription('Bot analytics and performance dashboard')
        .addSubcommand((s) => s.setName('dashboard').setDescription('Show live performance dashboard'))
        .addSubcommand((s) => s.setName('snapshot').setDescription('Export a full diagnostics snapshot as JSON')),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('safemode')
        .setDescription('Safe mode tools')
        .addSubcommand((s) => s.setName('status').setDescription('Show safe mode status and disabled handlers'))
        .addSubcommand((s) =>
          s
            .setName('on')
            .setDescription('Enable safe mode for this server')
            .addIntegerOption((o) => o.setName('threshold').setDescription('Failures before disabling (default 3)').setMinValue(1))
            .addIntegerOption((o) => o.setName('window').setDescription('Rolling window seconds (default 600)').setMinValue(30))
            .addIntegerOption((o) => o.setName('minutes').setDescription('Disable duration minutes (default 30)').setMinValue(1)),
        )
        .addSubcommand((s) => s.setName('off').setDescription('Disable safe mode for this server'))
        .addSubcommand((s) => s.setName('reset').setDescription('Clear the disabled list (re-enable everything)')),
    ),

  async execute(interaction) {
    // Dev/tester allowlist gate.
    const ok = await requireDev(interaction);
    if (!ok) return;

    const group = interaction.options.getSubcommandGroup();
    const sub = interaction.options.getSubcommand();
    const gid = interaction.guildId;

    if (!gid) {
      return safeReply(interaction, { ephemeral: true, content: 'This command can only be used in a server.' });
    }

    // --- errors ---
    if (group === 'errors') {
      if (sub === 'setup') {
        const ch = interaction.options.getChannel('channel', true);
        await setErrorsConfig(gid, { enabled: true, channelId: ch.id });
        return safeReply(interaction, { ephemeral: true, content: `✅ Errors will be reported in ${ch}.` });
      }

      if (sub === 'off') {
        await setErrorsConfig(gid, { enabled: false });
        return safeReply(interaction, { ephemeral: true, content: '✅ Error reporting disabled.' });
      }

      if (sub === 'test') {
        const cfg = await getErrorsConfig(gid);
        if (!cfg.enabled || !cfg.channelId) {
          return safeReply(interaction, { ephemeral: true, content: '❌ Error reporting is not enabled. Use `/dev errors setup` first.' });
        }
        // Force an error to be thrown and caught by interactionCreate
        throw new Error('Test error: this is only a test.');
      }
    }

    // --- reliability ---
    if (group === 'reliability') {
      if (sub === 'canary') {
        const result = await runCanaryChecks(client).catch(() => null);
        if (!result) return interaction.editReply('❌ Canary checks failed to run.');
        const icon = (ok) => ok ? '🟢' : '🔴';
        const lines = result.checks.map((c) => `${icon(c.healthy)} **${c.name}**: ${c.message}`);
        const emb = new EmbedBuilder()
          .setTitle(`${result.healthy ? '✅' : '⚠️'} Canary Health Checks`)
          .setDescription(lines.join('\n'))
          .setColor(result.healthy ? 0x22c55e : 0xf97316)
          .setTimestamp();
        return interaction.editReply({ content: '', embeds: [emb] });
      }

      if (sub === 'snapshot') {
        const snap = await captureSnapshot(client).catch(() => null);
        if (!snap) return interaction.editReply('❌ Failed to capture snapshot.');
        const json = JSON.stringify(snap, null, 2);
        const buf  = Buffer.from(json, 'utf-8');
        const { AttachmentBuilder } = require('discord.js');
        const file = new AttachmentBuilder(buf, { name: `diag-${Date.now()}.json` });
        return interaction.editReply({ content: '📦 Full diagnostics snapshot:', files: [file] });
      }

      if (sub === 'chaos') {
        const target = interaction.options.getString('target', true);
        let result = '';
        if (target === 'metrics') {
          const { metrics } = require('../../utils/metrics');
          const before = Object.keys(metrics.snapshot().counters).length;
          metrics.reset();
          result = `✅ Metrics counters reset (had **${before}** counter keys). All in-process rates cleared.`;
        } else if (target === 'settings_cache') {
          const { getCacheStats } = require('../../utils/settings');
          const stats = getCacheStats();
          result = `✅ Settings cache stats: **${stats.size}** entries, TTL **${stats.ttlMs}ms**. Cache will self-invalidate on next write.`;
        } else if (target === 'scheduler') {
          const { scheduler } = require('../../app/durableScheduler');
          const armed = scheduler._inProcess?.size ?? 0;
          result = `✅ Scheduler queue depth: **${armed}** armed jobs. All jobs are persisted — restart safe.`;
        }
        const emb = new EmbedBuilder()
          .setTitle('🔥 Chaos Drill Result')
          .setDescription(result)
          .setColor(0xf97316)
          .setTimestamp();
        return interaction.editReply({ content: '', embeds: [emb] });
      }
    }

    // --- analytics ---
    if (group === 'analytics') {
      const snap = await buildAnalyticsSnapshot(client).catch(() => null);
      if (!snap) return interaction.editReply('❌ Failed to build analytics snapshot.');

      if (sub === 'dashboard') {
        const fields = formatSnapshotFields(snap);
        const emb = new EmbedBuilder()
          .setTitle('📊 Bot Analytics Dashboard')
          .setDescription(`Generated <t:${Math.floor(snap.generatedAt / 1000)}:R>`)
          .addFields(fields)
          .setTimestamp();
        return interaction.editReply({ content: '', embeds: [emb] });
      }

      if (sub === 'snapshot') {
        // Export full snapshot as a JSON file attachment
        const json = JSON.stringify(snap, null, 2);
        const buf = Buffer.from(json, 'utf-8');
        const { AttachmentBuilder } = require('discord.js');
        const file = new AttachmentBuilder(buf, { name: `snapshot-${Date.now()}.json` });
        return interaction.editReply({ content: '📦 Full diagnostics snapshot:', files: [file] });
      }
    }

    // --- safemode ---
    if (group === 'safemode') {
      if (sub === 'status') {
        const cfg = await getSafeModeConfig(gid);
        const dis = listDisabled(gid);
        const lines = dis.length
          ? dis.slice(0, 20).map((d) => `• \`${d.key}\` — re-enables <t:${Math.floor(d.disabledUntil / 1000)}:R>`).join('\n')
          : 'None ✅';

        return safeReply(interaction, {
          ephemeral: true,
          content:
            `**Safe Mode:** ${cfg.enabled ? '✅ ON' : '❌ OFF'}\n` +
            `Threshold: **${cfg.threshold}** in **${cfg.windowSeconds}s**\n` +
            `Disable duration: **${cfg.disableMinutes} min**\n\n` +
            `**Disabled now:**\n${lines}`,
        });
      }

      if (sub === 'on') {
        const threshold = interaction.options.getInteger('threshold');
        const windowSeconds = interaction.options.getInteger('window');
        const disableMinutes = interaction.options.getInteger('minutes');

        const cfg = await setSafeModeConfig(gid, {
          enabled: true,
          ...(threshold ? { threshold } : {}),
          ...(windowSeconds ? { windowSeconds } : {}),
          ...(disableMinutes ? { disableMinutes } : {}),
        });

        return safeReply(interaction, {
          ephemeral: true,
          content: `🛡️ Safe mode enabled.\nThreshold: ${cfg.threshold} in ${cfg.windowSeconds}s. Disable: ${cfg.disableMinutes} min.`,
        });
      }

      if (sub === 'off') {
        await setSafeModeConfig(gid, { enabled: false });
        return safeReply(interaction, { ephemeral: true, content: '✅ Safe mode disabled.' });
      }

      if (sub === 'reset') {
        resetDisabled(gid);
        return safeReply(interaction, { ephemeral: true, content: '✅ Cleared disabled list. Everything is re-enabled.' });
      }
    }

    return safeReply(interaction, { ephemeral: true, content: 'Unknown dev subcommand.' });
  },
};
