/**
 * Debouncer — per-resource debounce for high-frequency Discord events.
 *
 * Prevents starboard reaction storms, sticky repost cycles, and voice-state
 * churn from hammering the database and Discord API on every individual event.
 *
 * Usage:
 *   const debouncer = new Debouncer(300);   // 300 ms window
 *
 *   debouncer.schedule('starboard:guildId:msgId', () => updateStarboard(...));
 *   // Only the LAST call within 300 ms actually runs.
 *
 *   debouncer.cancel('starboard:guildId:msgId');  // optional explicit cancel
 *
 * Each key is independent — debouncing one resource never delays another.
 */
class Debouncer {
  /**
   * @param {number} defaultDelayMs  Default window in milliseconds.
   */
  constructor(defaultDelayMs = 300) {
    this._defaultDelay = defaultDelayMs;
    /** @type {Map<string, ReturnType<typeof setTimeout>>} */
    this._timers = new Map();
  }

  /**
   * Schedule `fn` to run after `delayMs` (default: constructor value).
   * If called again for the same `key` before the timer fires, the previous
   * call is cancelled and the window resets.
   *
   * @param {string}   key
   * @param {Function} fn           Zero-argument async or sync function.
   * @param {number}   [delayMs]    Override the default delay for this call.
   */
  schedule(key, fn, delayMs) {
    const delay = typeof delayMs === 'number' ? delayMs : this._defaultDelay;
    this.cancel(key);
    const timer = setTimeout(() => {
      this._timers.delete(key);
      try {
        const result = fn();
        if (result && typeof result.catch === 'function') {
          result.catch(() => {}); // swallow — callers attach their own handlers
        }
      } catch {
        // intentionally silent — debounced callbacks must not crash the loop
      }
    }, delay);
    this._timers.set(key, timer);
  }

  /**
   * Cancel a pending debounced call, if any.
   * @param {string} key
   */
  cancel(key) {
    const existing = this._timers.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
      this._timers.delete(key);
    }
  }

  /**
   * Whether a call for `key` is currently pending.
   * @param {string} key
   * @returns {boolean}
   */
  isPending(key) {
    return this._timers.has(key);
  }

  /**
   * Number of keys currently pending. Useful for health metrics.
   */
  get size() {
    return this._timers.size;
  }

  /**
   * Cancel all pending timers (e.g. on graceful shutdown).
   */
  flush() {
    for (const timer of this._timers.values()) clearTimeout(timer);
    this._timers.clear();
  }
}

module.exports = { Debouncer };
