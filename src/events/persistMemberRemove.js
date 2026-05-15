'use strict';

/**
 * persistMemberRemove.js
 * ----------------------
 * Fires on GuildMemberRemove (alongside the existing leave-message handler).
 * When member persistence is enabled for this guild it snapshots:
 *   - all roles the member held (excluding @everyone)
 *   - their server nickname (if any)
 *
 * Data is written to Keyv via stores/memberPersistence.js and is read back
 * by persistMemberAdd.js when the same user rejoins.
 *
 * This file uses the SAME Events.GuildMemberRemove name as guildMemberRemove.js.
 * The event loader calls client.on() for every file, so both handlers fire —
 * they do not interfere with each other.
 */

const { Events } = require('discord.js');
const { getGuildSettings } = require('../utils/settings');
const { saveMemberData } = require('../stores/memberPersistence');
const { logger } = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberRemove,

  async execute(_client, member) {
    try {
      // Bots never need persistence
      if (member.user?.bot) return;

      const settings = await getGuildSettings(member.guild.id);
      const cfg = settings?.memberPersistence ?? {};

      const wantRoles    = cfg.restoreRoles    === true;
      const wantNickname = cfg.restoreNickname === true;

      // Nothing enabled — skip DB write entirely
      if (!wantRoles && !wantNickname) return;

      // Collect roles (exclude @everyone which is always present and cannot be assigned)
      const roleIds = wantRoles
        ? member.roles.cache
            .filter(r => r.id !== member.guild.id) // guild.id === @everyone role id
            .map(r => r.id)
        : [];

      const nickname = wantNickname ? (member.nickname ?? null) : null;

      await saveMemberData(member.guild.id, member.user.id, roleIds, nickname);

      logger.info(
        {
          guildId:  member.guild.id,
          userId:   member.user.id,
          roles:    roleIds.length,
          nickname: nickname ?? '(none)',
        },
        '[PERSIST] Saved member data on leave',
      );
    } catch (err) {
      // Non-fatal — never let persistence errors crash the leave handler
      logger.error(
        { err, guildId: member.guild?.id, userId: member.user?.id },
        '[PERSIST] Failed to save member data on leave',
      );
    }
  },
};
