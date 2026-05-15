const { logger } = require('../helpers/logger');

function pushLoadError(e) {
  try {
    if (!global.__startupLoadErrors) global.__startupLoadErrors = [];
    global.__startupLoadErrors.push(e);
  } catch (_) {
    // ignore
  }
}

/**
 * Safely require a module so one bad file doesn't crash the whole bot.
 * Returns null on failure and logs the error with context.
 *
 * Load errors are also recorded in-memory for the `/errors` log channel boot report.
 */
function safeRequire(filePath, label = 'module') {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(filePath);
  } catch (err) {
    logger.error({ err, filePath, label }, `[LOAD] Failed to load ${label}: ${filePath}`);
    pushLoadError({ at: Date.now(), filePath, label, message: String(err?.message || err), stack: String(err?.stack || '') });
    return null;
  }
}

function getStartupLoadErrors() {
  return Array.isArray(global.__startupLoadErrors) ? global.__startupLoadErrors : [];
}

function clearStartupLoadErrors() {
  global.__startupLoadErrors = [];
}

module.exports = { safeRequire, getStartupLoadErrors, clearStartupLoadErrors };
