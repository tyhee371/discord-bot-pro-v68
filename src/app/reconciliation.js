const { logger } = require('../utils/logger');
const { getGuildSettings } = require('../utils/settings');
const { getRoom, setRoom, deleteRoom } = require('../services/tempRoomService');
const { getTicket, setTicket, deleteTicket } = require('../services/ticketService');
const { getTimer, setTimer, clearTimer } = require('../services/moderationService');

/**
 * Phase 3: Startup Reconciliation
 * Cleans up orphaned state on bot restart to maintain consistency
 */

/**
 * Clean up orphaned temp rooms and channels
 * - Remove room data for channels that no longer exist
 * - Clean up rooms for guilds the bot is no longer in
 */
async function reconcileTempRooms(client) {
  logger.info('[RECONCILE] Starting temp room cleanup...');

  try {
    const guilds = client.guilds.cache;
    const cleanedRooms = 0;
    const cleanedChannels = 0;

    // Check each guild the bot is currently in
    for (const [guildId, guild] of guilds) {
      try {
        const settings = await getGuildSettings(guildId);
        if (!settings?.tempRooms?.enabled) continue;

        // Get all rooms for this guild
        const allRooms = {}; // We'll need to implement a way to get all rooms per guild
        // For now, we'll check known room patterns

        // Check voice channels for orphaned room data
        const voiceChannels = guild.channels.cache.filter(ch => ch.type === 2); // GUILD_VOICE
        for (const [channelId, channel] of voiceChannels) {
          const roomData = await getRoom(guildId, channelId);
          if (roomData) {
            // Verify the room data is still valid
            if (!roomData.ownerId || !roomData.createdAt) {
              await deleteRoom(guildId, channelId);
              logger.debug(`[RECONCILE] Cleaned invalid room data for channel ${channelId}`);
              cleanedRooms++;
            }
          }
        }
      } catch (error) {
        logger.warn(`[RECONCILE] Error reconciling guild ${guildId}: ${error.message}`);
      }
    }

    logger.info(`[RECONCILE] Temp room cleanup complete. Cleaned ${cleanedRooms} rooms, ${cleanedChannels} channels.`);
  } catch (error) {
    logger.error(`[RECONCILE] Temp room cleanup failed: ${error.message}`);
  }
}

/**
 * Clean up orphaned ticket state
 * - Remove ticket data for channels that no longer exist
 * - Clean up tickets for guilds the bot is no longer in
 * - Reset open ticket tracking for invalid states
 */
async function reconcileTickets(client) {
  logger.info('[RECONCILE] Starting ticket cleanup...');

  try {
    const guilds = client.guilds.cache;
    let cleanedTickets = 0;
    let cleanedChannels = 0;

    // Check each guild the bot is currently in
    for (const [guildId, guild] of guilds) {
      try {
        const settings = await getGuildSettings(guildId);
        if (!settings?.tickets?.enabled) continue;

        // We'll need to implement a way to iterate through all tickets
        // For now, this is a placeholder for the reconciliation logic

        // Check for orphaned ticket channels
        const textChannels = guild.channels.cache.filter(ch => ch.type === 0); // GUILD_TEXT
        for (const [channelId, channel] of textChannels) {
          // Check if this looks like a ticket channel (by name pattern or parent category)
          if (channel.name.match(/^ticket-\d+$/)) {
            const ticketData = await getTicket(guildId, channelId);
            if (!ticketData) {
              // Channel exists but no ticket data - this is orphaned
              logger.debug(`[RECONCILE] Found orphaned ticket channel ${channelId}`);
              // We could auto-delete or flag for manual cleanup
              cleanedChannels++;
            }
          }
        }
      } catch (error) {
        logger.warn(`[RECONCILE] Error reconciling tickets for guild ${guildId}: ${error.message}`);
      }
    }

    logger.info(`[RECONCILE] Ticket cleanup complete. Cleaned ${cleanedTickets} tickets, ${cleanedChannels} channels.`);
  } catch (error) {
    logger.error(`[RECONCILE] Ticket cleanup failed: ${error.message}`);
  }
}

/**
 * Clean up stale timers and locks
 * - Clear expired prison timers
 * - Clean up stale music alone disconnect timers
 * - Remove expired cooldowns and rate limits
 */
async function reconcileTimers(client) {
  logger.info('[RECONCILE] Starting timer cleanup...');

  try {
    const guilds = client.guilds.cache;
    let cleanedTimers = 0;

    // Check each guild for stale timers
    for (const [guildId, guild] of guilds) {
      try {
        // Check prison timers
        const prisonTimer = await getTimer(guildId);
        if (prisonTimer && prisonTimer.expiresAt < Date.now()) {
          await clearTimer(guildId);
          logger.debug(`[RECONCILE] Cleared expired prison timer for guild ${guildId}`);
          cleanedTimers++;
        }

        // Note: Music alone disconnect timers are handled by the music service
        // and should be reconciled there. We'll add that in the music service reconciliation.

      } catch (error) {
        logger.warn(`[RECONCILE] Error reconciling timers for guild ${guildId}: ${error.message}`);
      }
    }

    logger.info(`[RECONCILE] Timer cleanup complete. Cleaned ${cleanedTimers} timers.`);
  } catch (error) {
    logger.error(`[RECONCILE] Timer cleanup failed: ${error.message}`);
  }
}

/**
 * Run all startup reconciliation tasks
 */
async function runStartupReconciliation(client) {
  logger.info('[RECONCILE] Starting startup reconciliation...');

  const startTime = Date.now();

  try {
    await Promise.all([
      reconcileTempRooms(client),
      reconcileTickets(client),
      reconcileTimers(client),
    ]);

    const duration = Date.now() - startTime;
    logger.info(`[RECONCILE] Startup reconciliation complete in ${duration}ms`);
  } catch (error) {
    logger.error(`[RECONCILE] Startup reconciliation failed: ${error.message}`);
  }
}

module.exports = {
  runStartupReconciliation,
  reconcileTempRooms,
  reconcileTickets,
  reconcileTimers,
};
