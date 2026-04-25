const { sharedState } = require('./sharedState');
const { logger } = require('../utils/logger');

/**
 * Phase 4: Rate Limiting and Cooldown System
 * Provides distributed rate limiting using Redis-backed shared state
 */

class RateLimiter {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize the rate limiter
   */
  async initialize() {
    await sharedState.initialize();
    this.initialized = true;
    logger.info('[RATE-LIMIT] Rate limiter initialized');
  }

  /**
   * Check if an action is allowed for a user/guild combination
   * @param {string} type - Type of action (command, button, etc.)
   * @param {string} identifier - User ID, guild ID, or combined identifier
   * @param {number} limit - Maximum actions allowed
   * @param {number} windowSeconds - Time window in seconds
   * @returns {Object} { allowed: boolean, remaining: number, resetTime: number }
   */
  async checkLimit(type, identifier, limit, windowSeconds) {
    if (!this.initialized) {
      await this.initialize();
    }

    const key = `${type}:${identifier}`;
    const now = Math.floor(Date.now() / 1000);
    const windowKey = `ratelimit:${key}:${Math.floor(now / windowSeconds)}`;

    try {
      // Get current count for this window
      let currentCount = await sharedState.get('ratelimit', windowKey) || 0;

      // Check if limit exceeded
      const allowed = currentCount < limit;
      const remaining = Math.max(0, limit - currentCount - (allowed ? 1 : 0));

      // Calculate reset time (end of current window)
      const resetTime = (Math.floor(now / windowSeconds) + 1) * windowSeconds;

      if (allowed) {
        // Increment counter
        await sharedState.set('ratelimit', windowKey, currentCount + 1, windowSeconds);
      }

      return {
        allowed,
        remaining,
        resetTime,
        current: currentCount + (allowed ? 1 : 0)
      };
    } catch (error) {
      logger.warn(`[RATE-LIMIT] Error checking limit for ${key}: ${error.message}`);
      // Allow action on error to avoid blocking users
      return {
        allowed: true,
        remaining: limit - 1,
        resetTime: now + windowSeconds,
        current: 1
      };
    }
  }

  /**
   * Reset rate limit for a specific identifier
   */
  async resetLimit(type, identifier) {
    const key = `${type}:${identifier}`;
    const now = Math.floor(Date.now() / 1000);

    // Reset all possible windows (current and next)
    for (let i = -1; i <= 1; i++) {
      const windowKey = `ratelimit:${key}:${Math.floor(now / 3600) + i}`;
      await sharedState.delete('ratelimit', windowKey);
    }

    logger.debug(`[RATE-LIMIT] Reset limits for ${key}`);
  }

  /**
   * Get current rate limit status
   */
  async getStatus(type, identifier, windowSeconds = 3600) {
    const key = `${type}:${identifier}`;
    const now = Math.floor(Date.now() / 1000);
    const windowKey = `ratelimit:${key}:${Math.floor(now / windowSeconds)}`;

    const currentCount = await sharedState.get('ratelimit', windowKey) || 0;
    const ttl = await sharedState.getTTL('ratelimit', windowKey);

    return {
      current: currentCount,
      ttl: ttl > 0 ? ttl : 0,
      windowSeconds
    };
  }
}

/**
 * Cooldown system for commands and actions
 */
class CooldownManager {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize the cooldown manager
   */
  async initialize() {
    await sharedState.initialize();
    this.initialized = true;
    logger.info('[COOLDOWN] Cooldown manager initialized');
  }

  /**
   * Check if a user is on cooldown for an action
   * @param {string} action - Action identifier
   * @param {string} userId - User ID
   * @param {number} cooldownSeconds - Cooldown duration
   * @returns {Object} { onCooldown: boolean, remainingSeconds: number }
   */
  async checkCooldown(action, userId, cooldownSeconds) {
    if (!this.initialized) {
      await this.initialize();
    }

    const key = `cooldown:${action}:${userId}`;

    try {
      const lastUsed = await sharedState.get('cooldown', key);
      const now = Date.now();

      if (lastUsed) {
        const timePassed = now - lastUsed;
        const remaining = cooldownSeconds * 1000 - timePassed;

        if (remaining > 0) {
          return {
            onCooldown: true,
            remainingSeconds: Math.ceil(remaining / 1000)
          };
        }
      }

      // Set new cooldown
      await sharedState.set('cooldown', key, now, cooldownSeconds);
      return {
        onCooldown: false,
        remainingSeconds: 0
      };
    } catch (error) {
      logger.warn(`[COOLDOWN] Error checking cooldown for ${action}:${userId}: ${error.message}`);
      // Allow action on error
      return {
        onCooldown: false,
        remainingSeconds: 0
      };
    }
  }

  /**
   * Clear cooldown for a user action
   */
  async clearCooldown(action, userId) {
    const key = `cooldown:${action}:${userId}`;
    await sharedState.delete('cooldown', key);
    logger.debug(`[COOLDOWN] Cleared cooldown for ${action}:${userId}`);
  }

  /**
   * Get cooldown status
   */
  async getCooldownStatus(action, userId) {
    const key = `cooldown:${action}:${userId}`;
    const lastUsed = await sharedState.get('cooldown', key);

    if (!lastUsed) {
      return { onCooldown: false, remainingSeconds: 0 };
    }

    const now = Date.now();
    const timePassed = now - lastUsed;
    const ttl = await sharedState.getTTL('cooldown', key);

    return {
      onCooldown: ttl > 0,
      remainingSeconds: ttl > 0 ? ttl : 0,
      lastUsed: new Date(lastUsed).toISOString()
    };
  }
}

/**
 * Lock manager for preventing concurrent operations
 */
class LockManager {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize the lock manager
   */
  async initialize() {
    await sharedState.initialize();
    this.initialized = true;
    logger.info('[LOCK] Lock manager initialized');
  }

  /**
   * Acquire a lock
   * @param {string} lockName - Name of the lock
   * @param {string} ownerId - ID of the lock owner
   * @param {number} ttlSeconds - Lock TTL in seconds
   * @returns {boolean} True if lock acquired, false if already locked
   */
  async acquireLock(lockName, ownerId, ttlSeconds = 30) {
    if (!this.initialized) {
      await this.initialize();
    }

    const lockValue = `${ownerId}:${Date.now()}`;
    const acquired = await sharedState.setIfNotExists('lock', lockName, lockValue, ttlSeconds);

    if (acquired) {
      logger.debug(`[LOCK] Acquired lock ${lockName} for ${ownerId}`);
    }

    return acquired;
  }

  /**
   * Release a lock
   * @param {string} lockName - Name of the lock
   * @param {string} ownerId - ID of the lock owner
   */
  async releaseLock(lockName, ownerId) {
    const lockValue = await sharedState.get('lock', lockName);

    if (lockValue && lockValue.startsWith(`${ownerId}:`)) {
      await sharedState.delete('lock', lockName);
      logger.debug(`[LOCK] Released lock ${lockName} for ${ownerId}`);
      return true;
    }

    return false;
  }

  /**
   * Check if a lock is held
   */
  async isLocked(lockName) {
    return await sharedState.exists('lock', lockName);
  }

  /**
   * Get lock information
   */
  async getLockInfo(lockName) {
    const lockValue = await sharedState.get('lock', lockName);
    const ttl = await sharedState.getTTL('lock', lockName);

    if (!lockValue) {
      return null;
    }

    const [ownerId, timestamp] = lockValue.split(':');
    return {
      ownerId,
      acquiredAt: new Date(parseInt(timestamp)).toISOString(),
      ttl,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString()
    };
  }
}

// Global instances
const rateLimiter = new RateLimiter();
const cooldownManager = new CooldownManager();
const lockManager = new LockManager();

module.exports = {
  RateLimiter,
  CooldownManager,
  LockManager,
  rateLimiter,
  cooldownManager,
  lockManager,
};
