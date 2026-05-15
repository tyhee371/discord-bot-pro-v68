const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildSettings } = require('../../utils/settings');

function getBuilders(settings) {
  const b = settings?.rolePanel?.builders;
  return (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
}

// Detect if a role has sensitive administrative permissions that shouldn't be self-assigned
function isSensitiveRole(role) {
  if (!role) return false;
  const sensitivePerms = [
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.ModerateMembers,
    PermissionFlagsBits.MoveMembers,
    PermissionFlagsBits.ManageMessages,
  ];
  return sensitivePerms.some(perm => role.permissions.has(perm));
}

module.exports = {
  id: 'rolepanel',

  async execute(interaction) {
    const parts = interaction.customId.split(':'); // rolepanel:select:<builderId>
    if (parts[1] !== 'select') return;

    const builderId = parts[2] || null;

    const settings = await getGuildSettings(interaction.guildId);
    const builders = getBuilders(settings);

    // Resolve the correct builder - by id if provided, else single builder, else error
    let options = [];
    if (builderId && builders[builderId]) {
      options = Array.isArray(builders[builderId].options) ? builders[builderId].options : [];
    } else if (!builderId) {
      // Legacy: no builderId in customId — fall back to single builder
      const ids = Object.keys(builders);
      if (ids.length === 1) {
        options = Array.isArray(builders[ids[0]].options) ? builders[ids[0]].options : [];
      }
    }

    if (!options.length) {
      return interaction.reply({ content: '\u26a0\ufe0f This role panel is not configured yet.', flags: MessageFlags.Ephemeral });
    }

    const roleIds = new Set(options.map(o => String(o.roleId)));
    const selected = new Set((interaction.values || []).map(v => String(v)).filter(v => v !== 'noop'));

    // Validate all selections are valid panel roles
    for (const v of selected) {
      if (!roleIds.has(v)) {
        return interaction.reply({ content: '\u26a0\ufe0f One or more selected roles are not part of this panel.', flags: MessageFlags.Ephemeral });
      }
    }

    // Validate that sensitive roles are not being self-assigned (security check)
    for (const roleId of selected) {
      const role = interaction.guild.roles.cache.get(roleId);
      if (role && isSensitiveRole(role)) {
        return interaction.reply({ 
          content: `\u274c You cannot self-assign the role <@&${roleId}> as it has sensitive administrative permissions. Contact a server admin if you need this role.`, 
          flags: MessageFlags.Ephemeral 
        });
      }
    }

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return interaction.reply({ content: '\u274c Could not load your member info.', flags: MessageFlags.Ephemeral });

    const me = await interaction.guild.members.fetchMe().catch(() => interaction.guild.members.me);
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: '\u274c I need **Manage Roles** to update roles.', flags: MessageFlags.Ephemeral });
    }

    const botTop = me.roles.highest;
    const currentPanelRoles = new Set([...member.roles.cache.keys()].map(String).filter(id => roleIds.has(id)));
    const toAdd    = [...selected].filter(id => !currentPanelRoles.has(id));
    const toRemove = [...currentPanelRoles].filter(id => !selected.has(id));

    // Validate bot hierarchy for all changes
    const bad = [];
    for (const id of [...toAdd, ...toRemove]) {
      const r = interaction.guild.roles.cache.get(id);
      if (!r) continue;
      if (r.managed || r.position >= botTop.position) bad.push(r);
    }
    if (bad.length) {
      return interaction.reply({ content: '\u274c I cannot manage one or more selected roles (managed or above my highest role).', flags: MessageFlags.Ephemeral });
    }

    if (toAdd.length) await member.roles.add(toAdd).catch(() => null);
    if (toRemove.length) await member.roles.remove(toRemove).catch(() => null);

    const fmt = ids => ids.map(id => `<@&${id}>`).join(', ');
    const parts2 = [];
    if (toAdd.length) parts2.push(`\u2705 Added: ${fmt(toAdd)}`);
    if (toRemove.length) parts2.push(`\ud83d\uddd1\ufe0f Removed: ${fmt(toRemove)}`);
    if (!parts2.length) parts2.push('No changes.');

    return interaction.reply({ content: parts2.join('\n'), flags: MessageFlags.Ephemeral });
  },
};
