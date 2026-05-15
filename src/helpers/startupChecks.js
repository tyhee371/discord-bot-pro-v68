const { logger } = require('../helpers/logger');
const { getYtDlpVersion, parseYtDlpVersionDate } = require('../utils/ytDlp');

async function runStartupChecks() {
  logger.info({ node: process.version, pid: process.pid, platform: process.platform }, 'Startup');

  // yt-dlp check (recommended for YouTube stability)
  const yt = await getYtDlpVersion();
  if (yt.ok) {
    const dt = parseYtDlpVersionDate(yt.version);
    let staleDays = null;
    if (dt) staleDays = Math.floor((Date.now() - dt.getTime()) / (24 * 3600 * 1000));

    if (staleDays != null && staleDays > 14) {
      logger.warn(
        { ytdlpPath: yt.path, ytdlpVersion: yt.version, staleDays },
        'yt-dlp is older than 14 days. If YouTube breaks, update yt-dlp first.',
      );
    } else {
      logger.info({ ytdlpPath: yt.path, ytdlpVersion: yt.version }, 'yt-dlp OK');
    }
  } else {
    logger.warn({ ytdlpPath: yt.path, error: yt.error }, 'yt-dlp not found or not runnable.');
  }

  // DAVEY load test (prevents the runtime DAVE protocol crash)
  try {
    require('@snazzah/davey');
    logger.info('DAVEY OK: @snazzah/davey loaded successfully.');
  } catch (e) {
    logger.warn(
      { error: e?.message || String(e) },
      'DAVEY missing: voice may crash with "Cannot utilize the DAVE protocol". Reinstall with optional deps.',
    );
  }
}

module.exports = { runStartupChecks };
