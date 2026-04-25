const { PermissionFlagsBits } = require('discord.js');

function hasRole(member, roleId) {
  return !!(roleId && member?.roles?.cache?.has?.(roleId));
}

/**
 * Backward-compatible:
 * - isStaff(member, settings)
 * - isStaff(guild, member, settings)
 */
function isStaff(arg1, arg2, arg3) {
  let guild = null;
  let member = null;
  let settings = null;

  if (arg3 !== undefined) {
    guild = arg1;
    member = arg2;
    settings = arg3;
  } else {
    member = arg1;
    settings = arg2;
  }

  if (!member) return false;

  const memberId = member.id ?? member.user?.id ?? null;

  // Server owner always allowed
  if (guild?.ownerId && memberId && guild.ownerId === memberId) return true;

  const adminRoleId = settings?.tickets?.adminRoleId ?? null;
  const modRoleId = settings?.tickets?.modRoleId ?? settings?.tickets?.supportRoleId ?? null;

  if (hasRole(member, adminRoleId) || hasRole(member, modRoleId)) return true;

  // Permission fallback: allow ManageGuild / Administrator
  return !!(
    member.permissions?.has?.(PermissionFlagsBits.Administrator) ||
    member.permissions?.has?.(PermissionFlagsBits.ManageGuild)
  );
}

module.exports = { isStaff };
