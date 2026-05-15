/**
 * giveawayTimer.js — durable giveaway end timers.
 *
 * Phase 4: Uses DurableScheduler instead of raw setTimeout so timers
 * survive bot restarts. The job type is 'giveaway:end'.
 *
 * Handler registration lives in registerSchedulerHandlers() which is
 * called from bootstrap.js after the client is ready.
 */

const { scheduler } = require('../app/durableScheduler');

const JOB_TYPE = 'giveaway:end';

/**
 * Schedule a giveaway end job.
 * Idempotent — calling again with the same messageId cancels the
 * previous job first, matching the old clearEnd() + schedulEnd() pattern.
 *
 * @param {string} messageId
 * @param {number} delayMs
 * @param {object} payload   { channelId, guildId, messageId }
 * @returns {Promise<string>} jobId
 */
async function schedulEnd(messageId, delayMs, payload = {}) {
  // Cancel any existing job for this giveaway before creating a new one
  await clearEnd(messageId);

  return scheduler.schedule({
    id: `giveaway-end:${messageId}`,     // deterministic id so cancel works by messageId
    guildId: payload.guildId ?? 'unknown',
    type: JOB_TYPE,
    payload: { messageId, ...payload },
    runAt: Date.now() + Math.max(0, delayMs),
  });
}

/**
 * Cancel a scheduled giveaway end.
 * @param {string} messageId
 */
async function clearEnd(messageId) {
  await scheduler.cancel(`giveaway-end:${messageId}`);
}

/**
 * Check whether a giveaway end is scheduled.
 * @param {string} messageId
 * @returns {Promise<boolean>}
 */
async function hasTimer(messageId) {
  const job = await scheduler.get(`giveaway-end:${messageId}`);
  return job !== null;
}

module.exports = { schedulEnd, clearEnd, hasTimer, JOB_TYPE };
