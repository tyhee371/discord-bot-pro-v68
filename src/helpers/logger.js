const pino = require('pino');
const fs = require('node:fs');
const path = require('node:path');

function ensureLogDir() {
  const dir = path.join(__dirname, '..', '..', 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isShortLivedScript() {
  const argv = process.argv.join(' ');
  return (
    argv.includes('deploy-commands.js') ||
    argv.includes('node --test') ||
    argv.includes('scripts/smoke.js') ||
    process.env.NO_FILE_LOG === '1'
  );
}

/**
 * Delete log files older than `keepDays` days.
 * Runs once at startup and then every 24h — prevents unbounded log growth.
 */
function pruneOldLogs(logDir, keepDays = 30) {
  try {
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(logDir).filter((f) => f.match(/^app-\d{4}-\d{2}-\d{2}\.log$/));
    let pruned = 0;
    for (const file of files) {
      const full = path.join(logDir, file);
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        pruned++;
      }
    }
    if (pruned > 0) {
      process.stdout.write(`[logger] Pruned ${pruned} log file(s) older than ${keepDays} days\n`);
    }
  } catch (_) {
    // Non-fatal — log pruning failure should never crash the bot
  }
}

/**
 * Build a new file destination for today's date.
 * Called at startup and then at midnight to rotate to the next day's file.
 */
function makeDayDestination(logDir) {
  const date = new Date().toISOString().slice(0, 10);
  const filePath = path.join(logDir, `app-${date}.log`);
  return { dest: pino.destination({ dest: filePath, sync: true }), date };
}

function createLogger() {
  const level = process.env.LOG_LEVEL || 'info';

  // For short-lived scripts (deploy/smoke/tests), avoid async file destinations
  // to prevent sonic-boom flushSync "not ready yet".
  if (isShortLivedScript()) {
    return pino({
      level,
      base: null,
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  const logDir = ensureLogDir();

  // Prune logs older than LOG_RETAIN_DAYS (default: 30) at startup
  const keepDays = parseInt(process.env.LOG_RETAIN_DAYS ?? '30', 10);
  pruneOldLogs(logDir, keepDays);

  let { dest: fileDest, date: currentDate } = makeDayDestination(logDir);

  // Streams array — holds references so we can swap the file stream at midnight
  const streams = [
    { stream: process.stdout },
    { stream: fileDest, get: () => fileDest },
  ];

  const logger = pino(
    {
      level,
      base: null,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream(streams),
  );

  // Daily rotation: check at midnight whether the date has changed.
  // Uses a simple interval rather than a cron dependency.
  function scheduleRotation() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 1, 0); // 00:00:01 next day
    const msUntilMidnight = tomorrow - now;

    const t = setTimeout(() => {
      const today = new Date().toISOString().slice(0, 10);
      if (today !== currentDate) {
        // Swap the file destination
        const { dest: newDest, date: newDate } = makeDayDestination(logDir);
        fileDest = newDest;
        currentDate = newDate;
        streams[1].stream = fileDest;
        pruneOldLogs(logDir, keepDays);
        logger.info('[logger] Log rotated to new day file');
      }
      scheduleRotation(); // re-arm for next midnight
    }, msUntilMidnight);
    t.unref(); // don't block process exit
  }

  scheduleRotation();

  return logger;
}

const logger = createLogger();

module.exports = { logger };
