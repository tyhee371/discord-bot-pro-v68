const { logger } = require('../utils/logger');

/**
 * Phase 3: Enhanced Lifecycle Management
 * Handles graceful shutdown with operation draining and health checks
 */

let shuttingDown = false;
const activeOperations = new Set();
const shutdownHandlers = [];

/**
 * Register a shutdown handler
 * @param {Function} handler - Async function to run during shutdown
 * @param {string} name - Handler name for logging
 * @param {number} priority - Higher priority handlers run first (default: 0)
 */
function registerShutdownHandler(handler, name, priority = 0) {
  shutdownHandlers.push({ handler, name, priority });
  shutdownHandlers.sort((a, b) => b.priority - a.priority); // Higher priority first
}

/**
 * Track an active operation for shutdown draining
 * @param {string} operationId - Unique identifier for the operation
 */
function trackOperation(operationId) {
  activeOperations.add(operationId);
}

/**
 * Untrack a completed operation
 * @param {string} operationId - Operation identifier to remove
 */
function untrackOperation(operationId) {
  activeOperations.delete(operationId);
}

/**
 * Get count of active operations
 */
function getActiveOperationCount() {
  return activeOperations.size;
}

/**
 * Check if shutdown is in progress
 */
function isShutdown() {
  return shuttingDown;
}

async function shutdown(client, reason = 'shutdown') {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ reason }, 'Graceful shutdown initiated.');

  try {
    // Stop accepting new operations
    logger.info('Stopping new operations...');

    // Wait for active operations to complete (with timeout)
    if (activeOperations.size > 0) {
      logger.info(`Draining ${activeOperations.size} active operations...`);

      // Give operations 30 seconds to complete
      const drainTimeout = 30000;
      const drainStart = Date.now();

      while (activeOperations.size > 0 && (Date.now() - drainStart) < drainTimeout) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        logger.debug(`Still draining: ${activeOperations.size} operations remaining`);
      }

      if (activeOperations.size > 0) {
        logger.warn(`Force terminating ${activeOperations.size} operations after timeout`);
      } else {
        logger.info('All operations drained successfully');
      }
    }

    // Run shutdown handlers in priority order
    logger.info(`Running ${shutdownHandlers.length} shutdown handlers...`);

    for (const { handler, name } of shutdownHandlers) {
      try {
        logger.debug(`Running shutdown handler: ${name}`);
        await handler();
        logger.debug(`Shutdown handler completed: ${name}`);
      } catch (error) {
        logger.error(`Shutdown handler failed: ${name} - ${error.message}`);
      }
    }

    // Destroy client
    if (client?.destroy) {
      await client.destroy();
    }
  } catch (err) {
    logger.warn({ err }, 'Error during shutdown.');
  }

  process.exit(0);
}

function attachLifecycleHandlers(client) {
  process.on('SIGINT', () => shutdown(client, 'SIGINT'));
  process.on('SIGTERM', () => shutdown(client, 'SIGTERM'));

  process.on('beforeExit', () => {
    if (!shuttingDown) logger.info('Process beforeExit: shutting down gracefully.');
  });

  // Handle uncaught exceptions during shutdown
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception during shutdown');
    if (!shuttingDown) {
      shutdown(client, 'uncaughtException');
    }
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error({ reason, promise }, 'Unhandled rejection during shutdown');
    if (!shuttingDown) {
      shutdown(client, 'unhandledRejection');
    }
  });
}

function getHealthStatus(client) {
  const uptimeSeconds = Math.floor(process.uptime());
  const memoryUsage = process.memoryUsage();

  return {
    status: 'ok',
    uptimeSeconds,
    timestamp: Date.now(),
    activeOperations: activeOperations.size,
    memory: {
      rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
    },
    discord: client ? {
      guilds: client.guilds.cache.size,
      users: client.users.cache.size,
      uptime: client.uptime,
      ping: client.ws.ping,
    } : null,
  };
}

/**
 * Readiness check - determines if the bot is ready to serve requests
 */
function getReadinessStatus(client) {
  const health = getHealthStatus(client);

  // Bot is ready if:
  // - Not shutting down
  // - Client is connected and ready
  // - Basic health metrics are available
  const isReady = !shuttingDown &&
                  client &&
                  client.readyAt &&
                  health.discord &&
                  health.discord.guilds >= 0;

  return {
    ...health,
    ready: isReady,
    status: isReady ? 'ready' : 'not_ready',
  };
}

module.exports = {
  attachLifecycleHandlers,
  shutdown,
  getHealthStatus,
  getReadinessStatus,
  registerShutdownHandler,
  trackOperation,
  untrackOperation,
  getActiveOperationCount,
  isShutdown,
};
