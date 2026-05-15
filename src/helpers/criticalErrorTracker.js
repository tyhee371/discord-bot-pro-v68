const { logger } = require('../helpers/logger');
const { reportInteractionError, reportProcessError } = require('./errorReporter');

/**
 * Wraps a critical event handler to ensure exceptions are tracked and reported
 * @param {string} eventName - Name of the event (e.g., 'interactionCreate', 'voiceStateUpdate')
 * @param {Function} handler - The async handler function
 * @param {Object} client - Discord client for error reporting
 * @returns {Function} Wrapped handler that catches and reports exceptions
 */
function wrapCriticalEventHandler(eventName, handler, client) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      // Always log to console/file
      logger.error(
        { err, eventName, argCount: args.length },
        `Uncaught exception in critical event handler: ${eventName}`
      );

      // Try to report to configured error channels
      try {
        await reportProcessError(client, err, `Event: ${eventName}`);
      } catch (reportErr) {
        logger.warn(
          { err: reportErr, eventName },
          `Failed to report error for ${eventName}`
        );
      }

      // Re-throw to maintain current behavior (fail-open where necessary)
      // but with proper logging
      if (process.env.NODE_ENV === 'development') {
        throw err;
      }
    }
  };
}

/**
 * Wraps an interaction handler to ensure exceptions are tracked and reported
 * @param {string} commandName - Name of the command
 * @param {Function} handler - The async handler function
 * @param {Object} client - Discord client for error reporting
 * @returns {Function} Wrapped handler that catches and reports exceptions
 */
function wrapInteractionHandler(commandName, handler, client) {
  return async (interaction) => {
    try {
      return await handler(interaction);
    } catch (err) {
      // Always log
      logger.error(
        { err, commandName, userId: interaction.user?.id },
        `Uncaught exception in interaction handler: ${commandName}`
      );

      // Try to report to error channels
      try {
        await reportInteractionError(interaction, err, commandName);
      } catch (reportErr) {
        logger.warn(
          { err: reportErr, commandName },
          `Failed to report interaction error for ${commandName}`
        );
      }

      // Try to reply to user if possible
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ An unexpected error occurred. Please try again later.',
            ephemeral: true,
          });
        } else {
          await interaction.editReply({
            content: '❌ An unexpected error occurred. Please try again later.',
          });
        }
      } catch (replyErr) {
        logger.warn(
          { err: replyErr, commandName },
          `Failed to send error reply for ${commandName}`
        );
      }

      if (process.env.NODE_ENV === 'development') {
        throw err;
      }
    }
  };
}

/**
 * Monitors a promise for unhandled rejection and reports it
 * @param {Promise} promise - The promise to monitor
 * @param {string} context - Description of context for logging
 * @param {Object} client - Discord client for error reporting
 * @returns {Promise} The original promise (doesn't affect control flow)
 */
function monitorPromise(promise, context, client) {
  if (!(promise instanceof Promise)) return promise;

  promise.catch((err) => {
    logger.error(
      { err, context },
      `Unhandled promise rejection: ${context}`
    );

    if (client) {
      reportProcessError(client, err, `Promise rejection: ${context}`).catch((e) => {
        logger.warn({ err: e }, 'Failed to report promise rejection');
      });
    }
  });

  return promise;
}

module.exports = {
  wrapCriticalEventHandler,
  wrapInteractionHandler,
  monitorPromise,
};
