const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { safeReply, safeDefer } = require('../../utils/safeReply');

function parseColor(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
    return parseInt(hex, 16);
  }
  if (/^[0-9a-f]{6}$/i.test(s)) return parseInt(s, 16);
  return null;
}

async function replyOrEdit(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    const { flags, ephemeral, ...rest } = payload || {};
    return interaction.editReply(rest);
  }
  return safeReply(interaction, payload);
}

module.exports = {
  // ensures interactionCreate defers ephemerally
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Role management (mod/admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Create a new role.')
        .addStringOption((o) => o.setName('name').setDescription('Role name').setRequired(true))
        .addStringOption((o) => o.setName('color').setDescription('Hex color like #ffcc00 (optional)').setRequired(false))
        .addBooleanOption((o) => o.setName('hoist').setDescription('Show role separately?').setRequired(false))
        .addBooleanOption((o) => o.setName('mentionable').setDescription('Allow mentioning?').setRequired(false)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub !== 'create') {
      return replyOrEdit(interaction, { content: '❌ Unknown subcommand.', flags: MessageFlags.Ephemeral });
    }

    const name = interaction.options.getString('name', true).trim().slice(0, 100);
    const colorRaw = interaction.options.getString('color', false);
    const hoist = interaction.options.getBoolean('hoist') ?? false;
    const mentionable = interaction.options.getBoolean('mentionable') ?? false;

    const color = parseColor(colorRaw);
    if (colorRaw && color == null) {
      return replyOrEdit(interaction, { content: '❌ Invalid color. Use hex like `#ffcc00`.', flags: MessageFlags.Ephemeral });
    }

    const me = await interaction.guild.members.fetchMe().catch(() => interaction.guild.members.me);
    if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
      return replyOrEdit(interaction, { content: '❌ I need **Manage Roles** to create roles.', flags: MessageFlags.Ephemeral });
    }

    try {
      const role = await interaction.guild.roles.create({
        name,
        // discord.js 14.25+: "color" is deprecated, use "colors"
        colors: color != null ? { primaryColor: color } : undefined,
        hoist,
        mentionable,
        reason: `Created by ${interaction.user.tag} via /role create`,
      });

      return replyOrEdit(interaction, { content: `✅ Created role: ${role} (ID: \`${role.id}\`)`, flags: MessageFlags.Ephemeral });
    } catch (err) {
      const msg = err?.message ?? String(err);
      return replyOrEdit(interaction, {
        content: `❌ Failed to create role. Make sure my bot role is above where you want new roles.
\`${msg.slice(0, 1500)}\``,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};