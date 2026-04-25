const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

function findYtDlpPath() {
  const envPath = process.env.YTDLP_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  // Project-local bin
  const local = path.join(__dirname, '..', '..', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  if (fs.existsSync(local)) return local;

  // If installed in PATH, rely on just 'yt-dlp'
  return 'yt-dlp';
}

function execYtDlp(args, opts = {}) {
  const ytdlp = findYtDlpPath();
  return new Promise((resolve, reject) => {
    execFile(ytdlp, args, { timeout: 20_000, windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stderr, stdout }));
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), path: ytdlp });
    });
  });
}

async function getYtDlpVersion() {
  try {
    const { stdout, path: p } = await execYtDlp(['--version']);
    const v = stdout.trim();
    return { ok: true, version: v, path: p };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), path: findYtDlpPath() };
  }
}

function parseYtDlpVersionDate(version) {
  // Common format: YYYY.MM.DD or YYYYMMDD (yt-dlp)
  const m1 = /^\d{4}\.\d{2}\.\d{2}$/.exec(version);
  if (m1) return new Date(version.replace(/\./g, '-') + 'T00:00:00Z');

  const m2 = /^\d{8}$/.exec(version);
  if (m2) return new Date(`${version.slice(0,4)}-${version.slice(4,6)}-${version.slice(6,8)}T00:00:00Z`);

  return null;
}

module.exports = { findYtDlpPath, execYtDlp, getYtDlpVersion, parseYtDlpVersionDate };
