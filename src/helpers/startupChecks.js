const https  = require('node:https');
const fs     = require('node:fs');
const path   = require('node:path');
const { logger } = require('./logger');
const { getYtDlpVersion, parseYtDlpVersionDate, findYtDlpPath } = require('./ytDlp');

// ── yt-dlp auto-updater ───────────────────────────────────────────────────────

/**
 * Download a file from `url` (following redirects) to `dest`.
 * Returns a Promise that resolves when the file is fully written.
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest + '.tmp');

    function get(currentUrl) {
      https.get(currentUrl, { headers: { 'User-Agent': 'discord-bot-yt-dlp-updater/1.0' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          res.resume();
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          res.resume();
          file.destroy();
          fs.unlink(dest + '.tmp', () => {});
          return reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            // Atomic rename so partial downloads don't corrupt the binary
            try {
              fs.renameSync(dest + '.tmp', dest);
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        });
      }).on('error', (e) => {
        file.destroy();
        fs.unlink(dest + '.tmp', () => {});
        reject(e);
      });
    }

    file.on('error', (e) => {
      fs.unlink(dest + '.tmp', () => {});
      reject(e);
    });

    get(url);
  });
}

/**
 * Fetch the latest yt-dlp release version string from GitHub API.
 * Returns e.g. "2026.05.01" or null on failure.
 */
async function fetchLatestYtDlpVersion() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/yt-dlp/yt-dlp/releases/latest',
      headers: {
        'User-Agent': 'discord-bot-yt-dlp-updater/1.0',
        Accept: 'application/vnd.github.v3+json',
      },
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          // GitHub API returns { message: "..." } on rate-limit or auth errors
          if (json.message) {
            logger.warn({ githubMsg: json.message }, '[yt-dlp] GitHub API returned an error — skipping auto-update');
            return resolve(null);
          }
          const tag = json.tag_name?.replace(/^v/, '') ?? null;
          if (!tag) {
            logger.warn({ response: data.slice(0, 200) }, '[yt-dlp] GitHub API response missing tag_name');
          }
          resolve(tag);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

/**
 * Try to auto-update yt-dlp if the local binary is stale (>14 days).
 * Only runs on the local bin/ path — will not touch system yt-dlp.
 * Silently skips if the download fails (don't crash on startup for this).
 */
async function maybeUpdateYtDlp(currentVersion, ytPath) {
  // Only auto-update the project-local binary — leave system installs alone
  const binDir   = path.join(__dirname, '..', '..', 'bin');
  const binName  = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const binPath  = path.join(binDir, binName);

  if (ytPath !== binPath && fs.existsSync(binPath)) return; // using system yt-dlp
  if (!fs.existsSync(binDir)) {
    try { fs.mkdirSync(binDir, { recursive: true }); } catch { return; }
  }

  logger.info('[yt-dlp] Checking for updates...');
  const latest = await fetchLatestYtDlpVersion();
  if (!latest) {
    logger.warn('[yt-dlp] Could not fetch latest version from GitHub — skipping auto-update.');
    return;
  }

  if (latest === currentVersion) {
    logger.info({ version: latest }, '[yt-dlp] Already up to date.');
    return;
  }

  const assetName = process.platform === 'win32'
    ? 'yt-dlp.exe'
    : process.platform === 'darwin'
      ? 'yt-dlp_macos'
      : 'yt-dlp_linux';

  const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`;
  logger.info({ current: currentVersion, latest, url: downloadUrl }, '[yt-dlp] Updating...');

  try {
    await downloadFile(downloadUrl, binPath);

    // Make executable on Unix
    if (process.platform !== 'win32') {
      try { fs.chmodSync(binPath, 0o755); } catch {}
    }

    logger.info({ version: latest, path: binPath }, '[yt-dlp] Updated successfully ✓');
  } catch (e) {
    logger.warn({ err: e?.message }, '[yt-dlp] Auto-update failed — continuing with current version. Update manually from https://github.com/yt-dlp/yt-dlp/releases');
  }
}

// ── Main startup checks ───────────────────────────────────────────────────────

async function runStartupChecks() {
  logger.info({ node: process.version, pid: process.pid, platform: process.platform }, 'Startup');

  // yt-dlp check + auto-update
  const yt = await getYtDlpVersion();
  if (yt.ok) {
    const dt = parseYtDlpVersionDate(yt.version);
    let staleDays = null;
    if (dt) staleDays = Math.floor((Date.now() - dt.getTime()) / (24 * 3600 * 1000));

    if (staleDays != null && staleDays > 14) {
      logger.warn(
        { ytdlpPath: yt.path, ytdlpVersion: yt.version, staleDays },
        '[yt-dlp] Binary is older than 14 days — attempting auto-update. ' +
        'Stale yt-dlp is the most common cause of YouTube playback failures.',
      );
      // Run the update in the background — don't block bot startup.
      // The update writes to bin/ atomically so a running process isn't affected.
      maybeUpdateYtDlp(yt.version, yt.path).catch((e) => {
        logger.warn({ err: e?.message }, '[yt-dlp] Background auto-update threw unexpectedly');
      });
    } else {
      logger.info({ ytdlpPath: yt.path, ytdlpVersion: yt.version }, 'yt-dlp OK');
    }
  } else {
    logger.warn(
      { ytdlpPath: yt.path, error: yt.error },
      'yt-dlp not found or not runnable. Download from https://github.com/yt-dlp/yt-dlp/releases and place in bin/',
    );
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

  // ── Cookies check — most important for YouTube bot-detection bypass ────────
  const rawCookiesPath = process.env.YTDLP_COOKIES_FILE;
  if (rawCookiesPath) {
    const absPath = require('node:path').isAbsolute(rawCookiesPath)
      ? rawCookiesPath
      : require('node:path').resolve(__dirname, '..', '..', rawCookiesPath);
    if (fs.existsSync(absPath)) {
      const lines  = fs.readFileSync(absPath, 'utf8').split('\n');
      const hasSID = lines.some(l => l.includes('__Secure-3PSID') || l.includes('__Secure-1PSID') || l.includes('SAPISID'));
      if (hasSID) {
        logger.info({ path: absPath }, '[yt-dlp] ✓ cookies.txt loaded — YouTube auth active, bot-detection bypassed');
      } else {
        logger.warn({ path: absPath }, '[yt-dlp] cookies.txt found but contains no login cookies (no __Secure-3PSID/SAPISID). YouTube may still block requests. Re-export cookies while logged in to YouTube.');
      }
    } else {
      logger.warn({ configured: rawCookiesPath, resolved: absPath }, '[yt-dlp] YTDLP_COOKIES_FILE is set but file does not exist at resolved path — playing WITHOUT cookies. YouTube will likely block requests. Check the path in your .env.');
    }
  } else {
    logger.warn('[yt-dlp] YTDLP_COOKIES_FILE is not set in .env — YouTube requests are unauthenticated. Bot-detection will block many videos. Add YTDLP_COOKIES_FILE=./cookies.txt to your .env file.');
  }
}

module.exports = { runStartupChecks };
