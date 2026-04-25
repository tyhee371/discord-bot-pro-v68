const musicUtil = require('../utils/musicService');
const { musicQueueManager } = require('../app/musicQueue');
const { logger } = require('../utils/logger');

/**
 * Phase 3: Cleanup all music connections and timers on shutdown
 */
async function cleanupMusicConnections(client) {
  // Get all guilds and disconnect from voice channels
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      await musicUtil.leave(guildId);
    } catch (error) {
      // Ignore errors during shutdown cleanup
    }
  }
}

/**
 * Connect to voice channel with queue management
 */
async function connectOnly(params) {
  const { guild } = params;
  return await musicQueueManager.queueGuildOperation(
    guild.id,
    'connect',
    () => musicUtil.connectOnly(params),
    10 // High priority
  );
}

/**
 * Enqueue and play with queue management
 */
async function enqueueAndMaybePlay(params) {
  const { guild } = params;
  return await musicQueueManager.queueGuildOperation(
    guild.id,
    'enqueue',
    () => musicUtil.enqueueAndMaybePlay(params),
    5 // Medium priority
  );
}

/**
 * Skip track with queue management
 */
async function skip(guildId) {
  return await musicQueueManager.queueGuildOperation(
    guildId,
    'skip',
    () => musicUtil.skip(guildId),
    8 // High priority
  );
}

/**
 * Stop playback with queue management
 */
async function stop(guildId) {
  return await musicQueueManager.queueGuildOperation(
    guildId,
    'stop',
    () => musicUtil.stop(guildId),
    9 // Very high priority
  );
}

/**
 * Set loop mode with queue management
 */
async function setLoopMode(guildId, mode) {
  return await musicQueueManager.queueGuildOperation(
    guildId,
    'setLoop',
    () => musicUtil.setLoopMode(guildId, mode),
    3 // Lower priority
  );
}

/**
 * Jump to position with queue management
 */
async function jumpTo(guildId, position) {
  return await musicQueueManager.queueGuildOperation(
    guildId,
    'jump',
    () => musicUtil.jumpTo(guildId, position),
    7 // High priority
  );
}

/**
 * Leave voice channel with queue management
 */
async function leave(guildId) {
  return await musicQueueManager.queueGuildOperation(
    guildId,
    'leave',
    () => musicUtil.leave(guildId),
    9 // Very high priority
  );
}

module.exports = {
  connectOnly,
  enqueueAndMaybePlay,
  getConnectedChannelId: musicUtil.getConnectedChannelId,
  skip,
  stop,
  pause: musicUtil.pause,
  resume: musicUtil.resume,
  buildNowPlayingPayload: musicUtil.buildNowPlayingPayload,
  buildQueuePagePayload: musicUtil.buildQueuePagePayload,
  setLoopMode,
  cycleLoopMode: musicUtil.cycleLoopMode,
  jumpTo,
  set247: musicUtil.set247,
  leave,
  getNowPlaying: musicUtil.getNowPlaying,
  restore247ForClient: musicUtil.restore247ForClient,
  peekState: musicUtil.peekState,
  scheduleAloneDisconnect: musicUtil.scheduleAloneDisconnect,
  clearAloneTimer: musicUtil.clearAloneTimer,
  cleanupMusicConnections,
};

