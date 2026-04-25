const { redisClient } = require('./redis');
const { logger } = require('../utils/logger');

/**
 * Phase 4: Shared State Manager
 * Manages shared runtime state with Redis backing and in-memory fallback
 */

class SharedStateManager {
  constructor() {
    this.memoryStore = new Map();
    this.redisAvailable = false;
  }

  /**
   * Initialize the state manager
   */
  async initialize() {
    this.redisAvailable = redisClient.isAvailable();
    if (this.redisAvailable) {
      logger.info('[SHARED-STATE] Using Redis for shared state');
    } else {
      logger.info('[SHARED-STATE] Using in-memory fallback for shared state');
    }
  }

  /**
   * Generate Redis key with namespace
   */
  getKey(namespace, key) {
    return `discord-bot:${namespace}:${key}`;
  }

  /**
   * Get value from shared state
   */
  async get(namespace, key) {
    const redisKey = this.getKey(namespace, key);

    if (this.redisAvailable) {
      const value = await redisClient.get(redisKey);
      if (value !== null) {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
    }

    // Fallback to memory
    return this.memoryStore.get(redisKey) || null;
  }

  /**
   * Set value in shared state with optional TTL
   */
  async set(namespace, key, value, ttlSeconds = null) {
    const redisKey = this.getKey(namespace, key);
    const serializedValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

    if (this.redisAvailable) {
      const success = await redisClient.set(redisKey, serializedValue, ttlSeconds);
      if (success) {
        // Also store in memory for faster local access
        this.memoryStore.set(redisKey, value);
        return true;
      }
    }

    // Fallback to memory only
    this.memoryStore.set(redisKey, value);

    // Set up TTL for memory store if specified
    if (ttlSeconds) {
      setTimeout(() => {
        this.memoryStore.delete(redisKey);
      }, ttlSeconds * 1000);
    }

    return true;
  }

  /**
   * Delete value from shared state
   */
  async delete(namespace, key) {
    const redisKey = this.getKey(namespace, key);

    if (this.redisAvailable) {
      await redisClient.del(redisKey);
    }

    this.memoryStore.delete(redisKey);
    return true;
  }

  /**
   * Check if key exists in shared state
   */
  async exists(namespace, key) {
    const redisKey = this.getKey(namespace, key);

    if (this.redisAvailable) {
      const exists = await redisClient.exists(redisKey);
      if (exists) return true;
    }

    return this.memoryStore.has(redisKey);
  }

  /**
   * Set value only if it doesn't exist (atomic operation)
   */
  async setIfNotExists(namespace, key, value, ttlSeconds = null) {
    const redisKey = this.getKey(namespace, key);
    const serializedValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

    if (this.redisAvailable) {
      const success = await redisClient.setnx(redisKey, serializedValue, ttlSeconds);
      if (success) {
        this.memoryStore.set(redisKey, value);
        return true;
      }
      return false;
    }

    // Fallback to memory - not atomic but better than nothing
    if (!this.memoryStore.has(redisKey)) {
      this.memoryStore.set(redisKey, value);
      if (ttlSeconds) {
        setTimeout(() => {
          this.memoryStore.delete(redisKey);
        }, ttlSeconds * 1000);
      }
      return true;
    }
    return false;
  }

  /**
   * Get or set value atomically
   */
  async getOrSet(namespace, key, defaultValue, ttlSeconds = null) {
    const existing = await this.get(namespace, key);
    if (existing !== null) {
      return existing;
    }

    const set = await this.setIfNotExists(namespace, key, defaultValue, ttlSeconds);
    return set ? defaultValue : await this.get(namespace, key);
  }

  /**
   * Increment counter
   */
  async increment(namespace, key, amount = 1) {
    const redisKey = this.getKey(namespace, key);

    if (this.redisAvailable) {
      const newValue = await redisClient.incr(redisKey);
      if (newValue !== null) {
        this.memoryStore.set(redisKey, newValue);
        return newValue;
      }
    }

    // Fallback to memory
    const current = this.memoryStore.get(redisKey) || 0;
    const newValue = current + amount;
    this.memoryStore.set(redisKey, newValue);
    return newValue;
  }

  /**
   * Get TTL for key
   */
  async getTTL(namespace, key) {
    const redisKey = this.getKey(namespace, key);

    if (this.redisAvailable) {
      return await redisClient.ttl(redisKey);
    }

    // Memory store doesn't support TTL queries
    return -2;
  }

  /**
   * Clean up expired keys (mainly for memory store)
   */
  cleanup() {
    // Memory store cleanup is handled by timeouts
    // Redis handles TTL automatically
    logger.debug('[SHARED-STATE] Cleanup completed');
  }
}

// Global shared state manager instance
const sharedState = new SharedStateManager();

module.exports = {
  SharedStateManager,
  sharedState,
};
