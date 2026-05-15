require('events').defaultMaxListeners = 50;

const { token } = require('./config');
const { logger } = require('./utils/logger');
const { reportProcessError } = require('./utils/errorReporter');
const { startApp } = require('./app/bootstrap');

function getClientForReporting() {
  return global.__botClient || null;
}

// Unified warning handler.
// - Suppresses the known @discordjs/voice audio cycle timing warning (cosmetic only,
//   fires when an audio frame takes >20ms — fixed in @discordjs/voice >=0.17.0).
// - Logs TimeoutNegativeWarning with full stack to help trace negative setTimeout callers.
// - Forwards all other warnings to the structured logger.
process.on('warning', (w) => {
  try {
    if (w.name === 'TimeoutNegativeWarning' && (w.stack?.includes('@discordjs/voice') || w.stack?.includes('@discordjs\\voice'))) return;
    if (w.name === 'TimeoutNegativeWarning') {
      logger.warn({ name: w.name, message: w.message, stack: w.stack }, 'Node warning');
      return;
    }
    logger.warn({ name: w.name, message: w.message }, `[WARN] ${w.name}: ${w.message}`);
  } catch (_) {
    // ignore errors inside the warning handler itself
  }
});

process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'Unhandled promise rejection');
  const client = getClientForReporting();
  if (client) reportProcessError(client, err, 'unhandledRejection').catch(() => {});
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');

  const client = getClientForReporting();
  if (client) reportProcessError(client, err, 'uncaughtException').catch(() => {});

  // Common in VN networks / some ISPs: outbound connect timeouts to Discord (Cloudflare).
  // Keep process alive so discord.js can reconnect instead of hard-crashing.
  const code = err?.code || err?.cause?.code;
  const isTimeout =
    code === 'ETIMEDOUT' ||
    (err?.name === 'AggregateError' && (err?.code === 'ETIMEDOUT' || err?.aggregateErrors?.some?.((e) => e?.code === 'ETIMEDOUT')));

  if (isTimeout) {
    logger.warn({ err }, 'Network timeout to Discord. Check firewall/DNS/IPv6. Continuing and letting client retry.');
    return;
  }

  // Cloudflare 521/522/523: Discord servers temporarily unreachable — transient, discord.js reconnects.
  const errMsg = err?.message || '';
  const isCloudflareDown =
    /Unexpected server response: 52[0-9]/.test(errMsg) ||
    err?.code === 'ECONNRESET';

  if (isCloudflareDown) {
    logger.warn({ err }, 'Discord gateway returned Cloudflare/network error. Continuing and letting client reconnect...');
    return;
  }

  process.exit(1);
});

startApp().catch((e) => {
  logger.fatal({ err: e }, 'Failed to start bot');
  process.exit(1);
});
