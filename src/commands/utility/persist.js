'use strict';

/**
 * /persist — configure Member Persistence for this server.
 *
 * Subcommands:
 *   status  — show current settings
 *   set     — toggle restoreRoles and/or restoreNickname on/off
 *
 * Requires ManageGuild permission.
 */

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');

const { getGuildSettings, setGuildSettings } = require('../../utils/settings');
const { safeReply } = require('../../utils/safeReply');

// ── Helpers ──────────────────────────────────────────────────────────────────

function tf(v) { return v ? '✅ Enabled' : '❌ Disabled'; }

// ── Command definition ────────────────────────────────────────────────────────

module.exports = {
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('persist')
    .setDescription('Configure Member Persistence (restore roles & nickname on rejoin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    // /persist status
    .addSubcommand((s) =>
      s
        .setName('status')
        .setDescription('Show current member persistence settings.'),
    )

    // /persist set
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Enable or disable restore-roles and restore-nickname.')
        .addStringOption((o) =>
          o
            .setName('restore_roles')
            .setDescription('Restore all roles when a member rejoins.')
            .setRequired(false)
            .addChoices(
              { name: 'Enable',  value: 'true'  },
              { name: 'Disable', value: 'false' },
            ),
        )
        .addStringOption((o) =>
          o
            .setName('restore_nickname')
            .setDescription('Restore the server nickname when a member rejoins.')
            .setRequired(false)
            .addChoices(
              { name: 'Enable',  value: 'true'  },
              { name: 'Disable', value: 'false' },
            ),
        ),
    ),

  // ── Handler ──────────────────────────────────────────────────────────────

  async execute(interaction) {
    const sub      = interaction.options.getSubcommand();
    const guildId  = interaction.guildId;
    const settings = await getGuildSettings(guildId);
    const cfg      = settings?.memberPersistence ?? { restoreRoles: false, restoreNickname: false };

    // ── /persist status ───────────────────────────────────────────────────
    if (sub === 'status') {
      const embed = new EmbedBuilder()
        .setTitle('🔁 Member Persistence')
        .setDescription('Controls whether the bot saves and restores member data when someone leaves and rejoins.')
        .addFields(
          { name: '🎭 Restore Roles',    value: tf(cfg.restoreRoles),    inline: true },
          { name: '📛 Restore Nickname', value: tf(cfg.restoreNickname), inline: true },
        )
        .setFooter({ text: 'Use /persist set to change these settings.' })
        .setTimestamp();

      return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // ── /persist set ──────────────────────────────────────────────────────
    if (sub === 'set') {
      const rolesRaw    = interaction.options.getString('restore_roles');
      const nicknameRaw = interaction.options.getString('restore_nickname');

      if (rolesRaw === null && nicknameRaw === null) {
        return safeReply(interaction, {
          content: '⚠️ Please provide at least one option (`restore_roles` or `restore_nickname`).',
          flags: MessageFlags.Ephemeral,
        });
      }

      const patch = { memberPersistence: {} };
      const lines = [];

      if (rolesRaw !== null) {
        const val = rolesRaw === 'true';
        patch.memberPersistence.restoreRoles = val;
        lines.push(`🎭 Restore Roles → **${val ? 'Enabled' : 'Disabled'}**`);
      }

      if (nicknameRaw !== null) {
        const val = nicknameRaw === 'true';
        patch.memberPersistence.restoreNickname = val;
        lines.push(`📛 Restore Nickname → **${val ? 'Enabled' : 'Disabled'}**`);
      }

      await setGuildSettings(guildId, patch);

      return safeReply(interaction, {
        content: `✅ Member Persistence updated:\n${lines.join('\n')}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    return safeReply(interaction, { content: 'Unknown subcommand.', flags: MessageFlags.Ephemeral });
  },
};
