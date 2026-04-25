const { logger } = require('../utils/logger');
const { lockManager } = require('./rateLimit');

/**
 * Phase 4: Music Queue Manager
 * Provides bounded concurrency and backpressure for music operations
 */

class MusicQueueManager {
  constructor(maxConcurrent = 3, queueTimeout = 30000) {
    this.maxConcurrent = maxConcurrent;
    this.queueTimeout = queueTimeout;
    this.activeOperations = new Set();
    this.operationQueue = [];
    this.processing = false;
  }

  /**
   * Queue a music operation with backpressure
   * @param {string} operationId - Unique operation identifier
   * @param {Function} operation - Async function to execute
   * @param {number} priority - Priority (higher = more important)
   * @returns {Promise} Result of the operation
   */
  async queueOperation(operationId, operation, priority = 0) {
    return new Promise((resolve, reject) => {
      const queueItem = {
        id: operationId,
        operation,
        priority,
        resolve,
        reject,
        queuedAt: Date.now(),
        timeoutId: setTimeout(() => {
          this.removeFromQueue(operationId);
          reject(new Error(`Operation ${operationId} timed out in queue`));
        }, this.queueTimeout)
      };

      // Insert based on priority (higher priority first)
      const insertIndex = this.operationQueue.findIndex(item => item.priority < priority);
      if (insertIndex === -1) {
        this.operationQueue.push(queueItem);
      } else {
        this.operationQueue.splice(insertIndex, 0, queueItem);
      }

      logger.debug(`[MUSIC-QUEUE] Queued operation ${operationId} (priority: ${priority}, queue size: ${this.operationQueue.length})`);

      // Start processing if not already
      this.processQueue();
    });
  }

  /**
   * Process the operation queue
   */
  async processQueue() {
    if (this.processing || this.operationQueue.length === 0) {
      return;
    }

    this.processing = true;

    try {
      while (this.operationQueue.length > 0 && this.activeOperations.size < this.maxConcurrent) {
        const queueItem = this.operationQueue.shift();
        clearTimeout(queueItem.timeoutId);

        // Check if operation is already running
        if (this.activeOperations.has(queueItem.id)) {
          logger.debug(`[MUSIC-QUEUE] Skipping duplicate operation ${queueItem.id}`);
          continue;
        }

        this.activeOperations.add(queueItem.id);
        logger.debug(`[MUSIC-QUEUE] Starting operation ${queueItem.id}`);

        // Execute operation
        try {
          const result = await queueItem.operation();
          queueItem.resolve(result);
          logger.debug(`[MUSIC-QUEUE] Completed operation ${queueItem.id}`);
        } catch (error) {
          logger.warn(`[MUSIC-QUEUE] Operation ${queueItem.id} failed: ${error.message}`);
          queueItem.reject(error);
        } finally {
          this.activeOperations.delete(queueItem.id);
        }
      }
    } finally {
      this.processing = false;

      // Check if more operations can be processed
      if (this.operationQueue.length > 0) {
        setImmediate(() => this.processQueue());
      }
    }
  }

  /**
   * Remove operation from queue
   */
  removeFromQueue(operationId) {
    const index = this.operationQueue.findIndex(item => item.id === operationId);
    if (index !== -1) {
      const item = this.operationQueue.splice(index, 1)[0];
      clearTimeout(item.timeoutId);
      logger.debug(`[MUSIC-QUEUE] Removed operation ${operationId} from queue`);
    }
  }

  /**
   * Cancel a queued operation
   */
  cancelOperation(operationId) {
    this.removeFromQueue(operationId);

    if (this.activeOperations.has(operationId)) {
      // Note: Can't actually cancel a running operation, but we can mark it
      logger.debug(`[MUSIC-QUEUE] Cannot cancel active operation ${operationId}`);
    }
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      activeOperations: this.activeOperations.size,
      queuedOperations: this.operationQueue.length,
      maxConcurrent: this.maxConcurrent,
      queueTimeout: this.queueTimeout,
      processing: this.processing
    };
  }

  /**
   * Check if an operation is currently running
   */
  isOperationActive(operationId) {
    return this.activeOperations.has(operationId);
  }

  /**
   * Wait for all operations to complete
   */
  async drain(timeoutMs = 30000) {
    const startTime = Date.now();

    while ((this.activeOperations.size > 0 || this.operationQueue.length > 0) &&
           (Date.now() - startTime) < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return {
      success: this.activeOperations.size === 0 && this.operationQueue.length === 0,
      activeRemaining: this.activeOperations.size,
      queuedRemaining: this.operationQueue.length
    };
  }
}

/**
 * Guild-specific music queue to prevent conflicts
 */
class GuildMusicQueue {
  constructor(guildId) {
    this.guildId = guildId;
    this.queueManager = new MusicQueueManager(2, 45000); // 2 concurrent, 45s timeout
  }

  /**
   * Queue a music operation for this guild
   */
  async queueOperation(operationId, operation, priority = 0) {
    const fullOperationId = `${this.guildId}:${operationId}`;
    return await this.queueManager.queueOperation(fullOperationId, operation, priority);
  }

  /**
   * Check if operation is active
   */
  isOperationActive(operationId) {
    return this.queueManager.isOperationActive(`${this.guildId}:${operationId}`);
  }

  /**
   * Get queue stats
   */
  getStats() {
    return {
      guildId: this.guildId,
      ...this.queueManager.getStats()
    };
  }

  /**
   * Drain queue
   */
  async drain(timeoutMs = 30000) {
    return await this.queueManager.drain(timeoutMs);
  }
}

/**
 * Global music queue manager
 */
class GlobalMusicQueueManager {
  constructor() {
    this.guildQueues = new Map();
  }

  /**
   * Get or create queue for guild
   */
  getGuildQueue(guildId) {
    if (!this.guildQueues.has(guildId)) {
      this.guildQueues.set(guildId, new GuildMusicQueue(guildId));
    }
    return this.guildQueues.get(guildId);
  }

  /**
   * Queue operation for specific guild
   */
  async queueGuildOperation(guildId, operationId, operation, priority = 0) {
    const guildQueue = this.getGuildQueue(guildId);
    return await guildQueue.queueOperation(operationId, operation, priority);
  }

  /**
   * Get stats for all guilds
   */
  getAllStats() {
    const stats = {};
    for (const [guildId, queue] of this.guildQueues) {
      stats[guildId] = queue.getStats();
    }
    return stats;
  }

  /**
   * Clean up inactive guild queues
   */
  cleanupInactiveGuilds() {
    // Remove guilds with no active or queued operations
    for (const [guildId, queue] of this.guildQueues) {
      const stats = queue.getStats();
      if (stats.activeOperations === 0 && stats.queuedOperations === 0) {
        this.guildQueues.delete(guildId);
        logger.debug(`[MUSIC-QUEUE] Cleaned up inactive guild queue: ${guildId}`);
      }
    }
  }
}

// Global instance
const musicQueueManager = new GlobalMusicQueueManager();

module.exports = {
  MusicQueueManager,
  GuildMusicQueue,
  GlobalMusicQueueManager,
  musicQueueManager,
};
