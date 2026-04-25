const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { safeReply } = require('../../utils/safeReply');
const { requireDev } = require('../../utils/devAccess');
const { setErrorsConfig, getErrorsConfig } = require('../../utils/errorReporter');
const { getSafeModeConfig, setSafeModeConfig, listDisabled, resetDisabled } = require('../../utils/safeMode');

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
