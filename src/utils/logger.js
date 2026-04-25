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
  const date = new Date().toISOString().slice(0, 10);
  const filePath = path.join(logDir, `app-${date}.log`);

  // Use sync file destination for stability on Windows
  const fileDest = pino.destination({ dest: filePath, sync: true });

  const logger = pino(
    {
      level,
      base: null,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream([{ stream: process.stdout }, { stream: fileDest }]),
  );

  return logger;
}

const logger = createLogger();

module.exports = { logger };
