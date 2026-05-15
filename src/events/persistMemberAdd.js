'use strict';

/**
 * persistMemberAdd.js
 * -------------------
 * Fires on GuildMemberAdd (alongside the existing greet handler).
 * When member persistence is enabled for this guild it restores:
 *   - previously held roles (subject to bot role-hierarchy)
 *   - server nickname
 *
 * This file uses the SAME Events.GuildMemberAdd name as guildMemberAdd.js.
 * The event loader calls client.on() for every file, so both handlers fire
 * independently and do not interfere with each other.
 *
 * Role hierarchy safety:
 *   Discord will throw a 403 if the bot tries to assign a role that is
 *   higher than (or equal to) its own highest role. We filter those out
 *   before attempting the bulk add.
 *
 * Missing roles:
 *   Roles that no longer exist in the guild are silently skipped.
 *
 * Permission checks:
 *   MANAGE_ROLES  — needed to add roles
 *   MANAGE_NICKNAMES — needed to set nickname
 *   Both are checked independently; a missing permission for one does not
 *   prevent the other from running.
 */

const { Events, PermissionFlagsBits } = require('discord.js');
const { getGuildSettings } = require('../utils/settings');
const { getMemberData, clearMemberData } = require('../stores/memberPersistence');
const { logger } = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberAdd,

  async execute(_client, member) {
    try {
      // Bots never need persistence
      if (member.user?.bot) return;

      const settings = await getGuildSettings(member.guild.id);
      const cfg = settings?.memberPersistence ?? {};

      const wantRoles    = cfg.restoreRoles    === true;
      const wantNickname = cfg.restoreNickname === true;

      if (!wantRoles && !wantNickname) return;

      const saved = await getMemberData(member.guild.id, member.user.id);
      if (!saved) return; // first time joining — nothing to restore

      const { roleIds, nickname } = saved;

      // ── Bot self-member (needed for hierarchy & permission checks) ──────────
      const botMember = member.guild.members.me;
      if (!botMember) return;

      // Highest role position the bot currently holds
      const botHighestPosition = botMember.roles.highest.position;

      // ── Restore roles ────────────────────────────────────────────────────────
      if (wantRoles && roleIds.length > 0) {
        const hasManageRoles = botMember.permissions.has(PermissionFlagsBits.ManageRoles);

        if (!hasManageRoles) {
          logger.warn(
            { guildId: member.guild.id, userId: member.user.id },
            '[PERSIST] Cannot restore roles — bot lacks MANAGE_ROLES',
          );
        } else {
          // Filter: role must still exist AND be below the bot's highest role
          const rolesToAdd = roleIds
            .map(id => member.guild.roles.cache.get(id))
            .filter(role => {
              if (!role) return false;                        // deleted role
              if (role.id === member.guild.id) return false; // @everyone
              if (role.managed) return false;                 // integration-managed (e.g. bot roles)
              if (role.position >= botHighestPosition) return false; // hierarchy violation
              return true;
            });

          if (rolesToAdd.length > 0) {
            try {
              await member.roles.add(rolesToAdd, 'Member persistence: restoring roles on rejoin');

              logger.info(
                {
                  guildId: member.guild.id,
                  userId:  member.user.id,
                  restored: rolesToAdd.map(r => r.id),
                  skipped:  roleIds.length - rolesToAdd.length,
                },
                '[PERSIST] Restored roles on rejoin',
              );
            } catch (err) {
              // Log but continue — nickname restore can still proceed
              logger.error(
                { err, guildId: member.guild.id, userId: member.user.id },
                '[PERSIST] Failed to restore roles (API error)',
              );
            }
          }
        }
      }

      // ── Restore nickname ─────────────────────────────────────────────────────
      if (wantNickname && nickname) {
        const hasManageNicknames = botMember.permissions.has(PermissionFlagsBits.ManageNicknames);

        if (!hasManageNicknames) {
          logger.warn(
            { guildId: member.guild.id, userId: member.user.id },
            '[PERSIST] Cannot restore nickname — bot lacks MANAGE_NICKNAMES',
          );
        } else {
          // The bot cannot change the nickname of a member whose highest role
          // is at or above its own highest role (server owner is excluded entirely).
          const memberHighestPosition = member.roles.highest?.position ?? 0;
          const canEdit = member.guild.ownerId !== member.user.id &&
                          memberHighestPosition < botHighestPosition;

          if (!canEdit) {
            logger.warn(
              { guildId: member.guild.id, userId: member.user.id },
              '[PERSIST] Cannot restore nickname — member rank too high or is owner',
            );
          } else {
            try {
              await member.setNickname(nickname, 'Member persistence: restoring nickname on rejoin');

              logger.info(
                { guildId: member.guild.id, userId: member.user.id, nickname },
                '[PERSIST] Restored nickname on rejoin',
              );
            } catch (err) {
              logger.error(
                { err, guildId: member.guild.id, userId: member.user.id },
                '[PERSIST] Failed to restore nickname (API error)',
              );
            }
          }
        }
      }

      // Clear the saved snapshot regardless of partial failures so stale data
      // does not accumulate. On next leave, a fresh snapshot is written.
      await clearMemberData(member.guild.id, member.user.id);

    } catch (err) {
      // Non-fatal — never let persistence errors crash the join handler
      logger.error(
        { err, guildId: member.guild?.id, userId: member.user?.id },
        '[PERSIST] Unexpected error in persistMemberAdd',
      );
    }
  },
};
