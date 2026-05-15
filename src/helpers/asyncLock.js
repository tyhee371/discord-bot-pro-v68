/**
 * AsyncLock — lightweight per-resource mutex for Node.js.
 *
 * Guarantees that concurrent callers for the same key are serialised:
 * the second caller waits for the first to finish before proceeding.
 * No external dependencies — pure Promise chaining.
 *
 * Usage:
 *   const lock = new AsyncLock();
 *
 *   // Any two calls with the same key are serialised:
 *   const result = await lock.run('warns:g1:u1', async () => {
 *     const list = await db.get(key);
 *     list.push(item);
 *     await db.set(key, list);
 *     return list;
 *   });
 *
 * Keys are GC'd from the internal Map as soon as their queue drains,
 * so memory usage stays proportional to current concurrency, not history.
 */
class AsyncLock {
  constructor() {
    /** @type {Map<string, Promise<void>>} */
    this._locks = new Map();
  }

  /**
   * Run `fn` exclusively for `key`.
   * Concurrent calls with the same key are queued and run one-at-a-time.
   *
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  run(key, fn) {
    // Chain onto the existing tail promise for this key (or resolved if none).
    const prev = this._locks.get(key) ?? Promise.resolve();

    // Build a new tail that runs fn after prev settles.
    // We capture resolve/reject so the outer caller gets the actual return value.
    let resolve, reject;
    const next = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const tail = prev.then(async () => {
      try {
        const result = await fn();
        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        // Cleanup runs before `next` settles, so lock.size is correct
        // immediately after `await lock.run(...)` returns.
        if (this._locks.get(key) === tail) {
          this._locks.delete(key);
        }
      }
    });

    this._locks.set(key, tail);

    // Return a promise that resolves/rejects with fn's result.
    return next;
  }

  /**
   * Number of keys currently holding or waiting for a lock.
   * Useful for health checks / metrics.
   */
  get size() {
    return this._locks.size;
  }
}

module.exports = { AsyncLock };
