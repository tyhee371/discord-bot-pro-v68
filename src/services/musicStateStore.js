/**
 * musicStateStore.js — Redis-backed persistence for serializable music state
 *
 * The full in-process state (connection, player, timers) lives in audioEngine.js.
 * This module persists the SERIALIZABLE subset to Redis so that:
 *   1. State survives bot restarts (queue, volume, 24/7 mode are restored)
 *   2. Multiple shards can read each other's music state (prerequisite for sharding)
 *
 * Serializable fields: queue, current, volume, stay247, voiceChannelId,
 *                      textChannelId, loopMode, lastActionAt
 * Non-serializable (stays in-process): connection, player, timers, activeProc
 *
 * Phase 3: wired in; Phase 4 (sharding) will use cross-shard reads.
 */

const { sharedState } = require('../app/sharedState');
const { logger } = require('../helpers/logger');

const NS = 'music';
const TTL_SECONDS = 4 * 60 * 60; // 4 hours — auto-expire idle state

/**
 * Persist serializable music state to Redis (or in-process fallback).
 * Called after any mutation that should survive a restart.
 * @param {string} guildId
 * @param {object} st — full in-process state object
 */
async function persistState(guildId, st) {
  if (!guildId || !st) return;
  try {
    const payload = {
      queue: (st.queue ?? []).map(serializeTrack),
      current: st.current ? serializeTrack(st.current) : null,
      volume: st.volume ?? 0.5,
      stay247: st.stay247 ?? false,
      voiceChannelId: st.voiceChannelId ?? null,
      textChannelId: st.textChannelId ?? null,
      loopMode: st.loopMode ?? 'off',
      lastActionAt: st.lastActionAt ?? Date.now(),
    };
    await sharedState.set(NS, guildId, payload, TTL_SECONDS);
  } catch (err) {
    logger.debug({ err, guildId }, '[musicStateStore] persist failed (non-fatal)');
  }
}

/**
 * Load persisted music state from Redis.
 * Returns null if no state found or Redis unavailable.
 * @param {string} guildId
 * @returns {object|null}
 */
async function loadState(guildId) {
  if (!guildId) return null;
  try {
    return await sharedState.get(NS, guildId);
  } catch (err) {
    logger.debug({ err, guildId }, '[musicStateStore] load failed (non-fatal)');
    return null;
  }
}

/**
 * Delete persisted state when a guild disconnects cleanly.
 * @param {string} guildId
 */
async function clearState(guildId) {
  if (!guildId) return;
  try {
    await sharedState.delete(NS, guildId);
  } catch (err) {
    logger.debug({ err, guildId }, '[musicStateStore] clear failed (non-fatal)');
  }
}

/** Serialize a track to a plain object safe for JSON storage. */
function serializeTrack(track) {
  if (!track) return null;
  return {
    url: track.url,
    title: track.title,
    duration: track.duration,
    thumbnail: track.thumbnail,
    requestedBy: track.requestedBy,
    platform: track.platform,
    isLive: track.isLive ?? false,
  };
}

module.exports = { persistState, loadState, clearState };
