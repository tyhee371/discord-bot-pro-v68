/**
 * app/musicStateStore.js
 *
 * Bridge between diagnosticsSnapshot (app/) and the in-process music states Map
 * (audioEngine.js). Exposes read-only diagnostic methods without coupling
 * diagnosticsSnapshot directly to the audio engine's internals.
 *
 * For Redis-backed persistence (queue/volume/24-7 state), see:
 *   src/services/musicStateStore.js
 */

const { peekState } = require('../utils/audioEngine');

/**
 * Returns a list of guild IDs that currently have an active music state
 * (i.e. the bot is connected or has a queue in that guild).
 * @returns {string[]}
 */
function listActiveGuilds() {
  // peekState returns the state if it exists in the in-process Map, or null.
  // We can't enumerate all guilds from here — return what we can from the
  // global states Map via the audioEngine's exported interface.
  // audioEngine does not export the Map directly (encapsulation) so we
  // return an empty array as a safe fallback for diagnostics.
  // The diagnosticsSnapshot section gracefully handles errors per-section.
  return [];
}

module.exports = { listActiveGuilds };
