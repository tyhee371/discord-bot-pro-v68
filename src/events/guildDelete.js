const { Events } = require('discord.js');
const { logger } = require('../helpers/logger');
const { evictStaleGuild } = require('../helpers/safeMode');
const { db } = require('../db');

module.exports = {
  name: Events.GuildDelete,
  async execute(client, guild) {
    if (!guild?.id) return;

    // guild.available === false means Discord outage — bot is still in the guild,
    // just can't reach it. Don't clean up in this case.
    if (guild.available === false) {
      logger.info({ guildId: guild.id }, '[guildDelete] Guild unavailable (outage) — skipping cleanup');
      return;
    }

    logger.info({ guildId: guild.id, name: guild.name }, '[guildDelete] Bot removed from guild — cleaning up in-process state');

    // Clear safeMode in-process state for this guild
    evictStaleGuild(guild.id);

    // Note: Keyv/SQLite data (settings, tickets, warns, rooms, giveaways) is NOT
    // deleted here intentionally — if the bot is re-invited, existing config is preserved.
    // Add explicit deletion here only if storage growth becomes a concern.
  },
};
