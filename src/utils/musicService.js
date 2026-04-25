
const { logger } = require('./logger');

// Safe setTimeout: never pass negative delay (avoids TimeoutNegativeWarning)
function safeTimeout(fn, delayMs) {
  return setTimeout(fn, Math.max(0, Number.isFinite(delayMs) ? delayMs : 0));
}

const {
  joinVoiceChannel,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  demuxProbe,
  entersState,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  StreamType,
} = require('@discordjs/voice');

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');


const play = require('play-dl');
const ytdl = require('@distube/ytdl-core');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ffmpegPath = require('ffmpeg-static');
const { getGuildSettings, setGuildSettings } = require('./settings');

const states = new Map(); // guildId -> state

function peekState(guildId) {
  return states.get(guildId) || null;
}


function getConnectedChannelId(guildId) {
  try {
    const conn = getVoiceConnection(guildId);
    const cid = conn?.joinConfig?.channelId;
    if (cid) return cid;
  } catch {}
  const st = states.get(guildId);
  return st?.voiceChannelId ?? null;
}

function now() {
  return Date.now();
}

function getState(guildId) {
  let st = states.get(guildId);
  if (st) return st;

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play },
  });

  st = {
    guildId,
    connection: null,
    player,
    queue: [],
    current: null,
    volume: 0.5, // default volume (never set to 0)
    stay247: false,
    voiceChannelId: null,
    textChannelId: null,
    idleDisconnectTimer: null,
    aloneDisconnectTimer: null,
    lastActionAt: now(),
    activeProc: null,
    loopMode: 'off',
    ignoreLoopOnce: false,
    client: null,
  };

  // Audio player events
  player.on(AudioPlayerStatus.Idle, () => {
    const finished = st.current;
    cleanupActiveProcess(st);
    st.current = null;

    // Loop behavior (skip/stop can set ignoreLoopOnce)
    if (finished) {
      if (st.ignoreLoopOnce) {
        st.ignoreLoopOnce = false;
      } else if (st.loopMode === 'track') {
        st.queue.unshift(finished);
      } else if (st.loopMode === 'queue') {
        st.queue.push(finished);
      }
    }

    if (st.queue.length > 0) {
      void playNextInternal(st).catch(logger.error);
      return;
    }
    scheduleIdleDisconnect(st);
  });

  player.on('stateChange', (oldState, newState) => {
    if (oldState?.status !== newState?.status) {
      logger.info(
        { guildId: st.guildId, from: oldState?.status, to: newState?.status },
        '[MUSIC] Player state changed',
      );
    }
  });


  player.on('error', (err) => {
    logger.error('[MUSIC] player error:', err);
    cleanupActiveProcess(st);
    // Skip to next track on error
    st.current = null;
    void playNextInternal(st).catch(logger.error);
  });

  states.set(guildId, st);
  return st;
}



function clearAloneTimer(st) {
  if (st.aloneDisconnectTimer) {
    clearTimeout(st.aloneDisconnectTimer);
    st.aloneDisconnectTimer = null;
  }
}

async function scheduleAloneDisconnect(st, client) {
  clearAloneTimer(st);

  if (st.stay247) return; // 24/7 mode stays even when alone
  if (!st.connection) return;

  const channelId = st.connection.joinConfig.channelId;
  if (!channelId) return;

  const channel =
    client.channels.cache.get(channelId) || (await client.channels.fetch(channelId).catch(() => null));
  if (!channel || !channel.members) return;

  // Count humans (non-bot)
  const humans = channel.members.filter((m) => !m.user.bot).size;
  if (humans > 0) return; // not alone

  // Grace period before leaving when alone (not 24/7)
  st.aloneDisconnectTimer = safeTimeout(async () => {
    try {
      if (!st.connection) return;
      const c =
        client.channels.cache.get(channelId) ||
        (await client.channels.fetch(channelId).catch(() => null));
      if (!c || !c.members) return;
      const humansNow = c.members.filter((m) => !m.user.bot).size;
      if (humansNow > 0) return;

      // Stop and leave
      await stop(st.guildId);
      await leave(st.guildId, 'Alone in voice (not 24/7)');
    } catch (e) {
      logger.error({ err: e, guildId: st.guildId }, '[MUSIC] alone disconnect error');
    }
  }, 60_000);
}
function clearIdleTimer(st) {
  if (st.idleDisconnectTimer) clearTimeout(st.idleDisconnectTimer);
  st.idleDisconnectTimer = null;
}


function scheduleIdleDisconnect(st) {
  clearIdleTimer(st);

  if (st.stay247) return; // never auto-leave in 24/7 mode
  if (!st.connection) return;

  // Grace period before leaving when idle (and not 24/7)
  st.idleDisconnectTimer = safeTimeout(() => {
    try {
      if (!st.connection) return;
      if (st.current) return;
      if (st.queue.length > 0) return;

      // Leave when idle (this mimics most music bots when 24/7 is off)
      void leave(st.guildId, 'Idle (not 24/7)');
    } catch (e) {
      logger.error('[MUSIC] idle disconnect error:', e);
    }
  }, 90_000);
}


async function ensureConnection(guild, voiceChannel, st) {
  if (!voiceChannel) throw new Error('Voice channel is required.');

  const existing = getVoiceConnection(guild.id);
  if (existing && existing.joinConfig.channelId === voiceChannel.id) {
    st.connection = existing;
    return existing;
  }

  // If connected elsewhere, destroy and move
  if (existing) {
    try { existing.destroy(); } catch {}
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
  });

  st.connection = connection;
  st.voiceChannelId = voiceChannel.id;

  connection.subscribe(st.player);

  connection.on('stateChange', async (_oldState, newState) => {
    if (_oldState?.status !== newState?.status) {
      logger.info(
        { guildId: guild.id, from: _oldState?.status, to: newState?.status, channelId: voiceChannel.id },
        '[MUSIC] Voice connection state changed',
      );
    }
    try {
      if (newState.status === VoiceConnectionStatus.Disconnected) {
        // Try to reconnect briefly
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
          // Reconnected successfully
          return;
        } catch {
          // Hard disconnect - destroy connection
          try { connection.destroy(); } catch {}
          st.connection = null;

          // If 24/7 is on, attempt to rejoin after a brief delay
          if (st.stay247 && st.voiceChannelId && st.client) {
            safeTimeout(async () => {
              try {
                if (st.connection) return; // already reconnected
                const guild = st.client.guilds.cache.get(st.guildId);
                const vc = guild?.channels.cache.get(st.voiceChannelId);
                if (!vc) return;
                await ensureConnection(guild, vc, st);
                logger.info({ guildId: st.guildId }, '[MUSIC] 24/7 auto-rejoined voice channel');
                if (st.current) {
                  // Re-queue current track at front so playback resumes
                  st.queue.unshift(st.current);
                  st.current = null;
                  void playNextInternal(st).catch(logger.error);
                }
              } catch (rejoErr) {
                logger.error({ err: rejoErr, guildId: st.guildId }, '[MUSIC] 24/7 rejoin failed');
              }
            }, 3_000);
          }
        }
      }
    } catch (e) {
      logger.error('[MUSIC] connection stateChange error:', e);
    }
  });

  // Ensure connection is ready
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

  // Stage channels can suppress bots by default, which results in "playing" state but no audible sound.
  if (voiceChannel.type === ChannelType.GuildStageVoice) {
    try {
      const me = await guild.members.fetchMe().catch(() => guild.members.me);
      if (me?.voice?.channelId === voiceChannel.id && me.voice.suppress) {
        await me.voice.setSuppressed(false).catch(() => null);
        await me.voice.setRequestToSpeak(true).catch(() => null);
        logger.info({ guildId: guild.id, channelId: voiceChannel.id }, '[MUSIC] Attempted stage unsuppress/request-to-speak');
      }
    } catch (e) {
      logger.warn({ err: e, guildId: guild.id }, '[MUSIC] Stage unsuppress check failed');
    }
  }

  // Always log effective voice state right after connect for debugging silent playback.
  try {
    const me = await guild.members.fetchMe().catch(() => guild.members.me);
    logger.info(
      {
        guildId: guild.id,
        channelId: voiceChannel.id,
        channelType: voiceChannel.type,
        selfMute: me?.voice?.selfMute ?? null,
        selfDeaf: me?.voice?.selfDeaf ?? null,
        serverMute: me?.voice?.serverMute ?? null,
        serverDeaf: me?.voice?.serverDeaf ?? null,
        suppress: me?.voice?.suppress ?? null,
      },
      '[MUSIC] Bot voice state after connect',
    );
  } catch (e) {
    logger.warn({ err: e, guildId: guild.id }, '[MUSIC] Could not read bot voice state');
  }

  clearIdleTimer(st);
  return connection;
}


const MAX_PLAYLIST_TRACKS = 200;

function cleanQuery(input) {
  if (typeof input !== 'string') return '';
  let q = input.trim();
  // Strip Discord's <...> link formatting
  if (q.startsWith('<') && q.endsWith('>')) q = q.slice(1, -1).trim();
  return q;
}

function normalizeUrl(raw) {
  let url = raw.trim();

  // youtube music / mobile -> www
  url = url.replace(/^https?:\/\/music\.youtube\.com\//i, 'https://www.youtube.com/');
  url = url.replace(/^https?:\/\/m\.youtube\.com\//i, 'https://www.youtube.com/');

  // youtu.be -> youtube watch
  const m = url.match(/^https?:\/\/youtu\.be\/([a-zA-Z0-9_-]{6,})/i);
  if (m) url = `https://www.youtube.com/watch?v=${m[1]}`;

  return url;
}


function stripAngleBrackets(input) {
  if (typeof input !== 'string') return input;
  const s = input.trim();
  if (s.startsWith('<') && s.endsWith('>')) return s.slice(1, -1);
  return s;
}


function isYouTubeUrl(url) {
  if (!url) return false;
  return /^(https?:\/\/)?(www\.)?(music\.)?youtube\.com\//i.test(url) || /^(https?:\/\/)?youtu\.be\//i.test(url);
}


function getYtDlpCommand() {
  // Optional override, useful for Windows paths:
  // YTDLP_PATH=C:\\tools\\yt-dlp.exe
  const envPath = process.env.YTDLP_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  // Local bundled binary (recommended if you don't want a global install)
  const localBin = path.join(process.cwd(), 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  if (fs.existsSync(localBin)) return localBin;

  // Fallback to PATH lookup
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

function cleanupActiveProcess(st) {
  const p = st && st.activeProc;
  if (!p) return;
  try {
    if (!p.killed) p.kill('SIGKILL');
  } catch {}
  st.activeProc = null;
}

async function tryCreateYtDlpResource(st, url) {
  // Requires yt-dlp to be available (either via PATH, ./bin, or YTDLP_PATH).
  const cmd = getYtDlpCommand();
  const args = [
    // Format: prefer webm/opus (no re-encode needed), fall back to any audio
    // IMPORTANT: do NOT use -x / --audio-format — these require ffmpeg post-processing
    // which silently fails on systems without ffmpeg, producing an empty stream.
    '-f', 'bestaudio[ext=webm]/bestaudio[ext=ogg]/bestaudio/best',
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '--no-part',               // don't write .part files
    '-o', '-',                 // pipe raw audio bytes to stdout
    url,
  ];

  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    child.once('error', (err) => {
      // ENOENT means yt-dlp not found
      reject(err);
    });

    // demuxProbe will reject if stdout ends before it can detect format.
    demuxProbe(child.stdout)
      .then((probe) => {
        st.activeProc = child;
        resolve(createAudioResource(probe.stream, { inputType: probe.type, inlineVolume: true }));
      })
      .catch((err) => {
        try { child.kill('SIGKILL'); } catch {}
        const wrapped = new Error(`yt-dlp stream failed: ${stderr || err.message}`);
        wrapped.cause = err;
        reject(wrapped);
      });

    child.once('exit', (code) => {
      // If it exits early, demuxProbe will usually catch it; this is just extra context.
      if (code && code !== 0 && !stderr) stderr = `yt-dlp exited with code ${code}`;
    });
  });
}

async function tryCreateYtDlpFfmpegResource(st, url) {
  const cmd = getYtDlpCommand();
  const directUrl = await new Promise((resolve, reject) => {
    const child = spawn(cmd, ['--no-warnings', '--no-playlist', '-f', 'bestaudio', '-g', url], {
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += String(d || '');
    });
    child.stderr.on('data', (d) => {
      err += String(d || '');
    });
    child.once('error', reject);
    child.once('close', (code) => {
      const first = out
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find((s) => /^https?:\/\//i.test(s));
      if (first) return resolve(first);
      reject(new Error(err || `yt-dlp -g failed with code ${code}`));
    });
  });

  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    throw new Error('ffmpeg-static binary not found');
  }

  // Transcode to raw PCM to avoid intermittent opus demux aborts with direct piping.
  const ff = spawn(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_delay_max',
      '5',
      '-i',
      directUrl,
      '-vn',
      '-f',
      's16le',
      '-ar',
      '48000',
      '-ac',
      '2',
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );

  let stderr = '';
  ff.stderr.setEncoding('utf8');
  ff.stderr.on('data', (d) => {
    stderr += d;
    if (stderr.length > 8000) stderr = stderr.slice(-8000);
  });
  ff.once('error', (e) => {
    throw e;
  });

  st.activeProc = ff;
  const resource = createAudioResource(ff.stdout, {
    inputType: StreamType.Raw,
    inlineVolume: true,
  });
  resource.playStream.once('error', () => {
    try {
      if (!ff.killed) ff.kill('SIGKILL');
    } catch {}
  });
  return resource;
}

function looksLikeUrl(s) {
  return /^https?:\/\//i.test(s);
}

async function ensureSoundCloudToken() {
  if (ensureSoundCloudToken._done) return;
  ensureSoundCloudToken._done = true;

  try {
    const clientID = await play.getFreeClientID();
    play.setToken({
      soundcloud: {
        client_id: clientID,
      },
    });
  } catch (e) {
    // SoundCloud will still work for some links, but playlists/search may fail
    logger.warn('[MUSIC] Could not auto-set SoundCloud client id:', e?.message ?? e);
  }
}

// Try to get a Spotify entity title without credentials (single-track best effort).
async function spotifyOEmbedTitle(url) {
  try {
    const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const res = await fetch(endpoint, { headers: { 'User-Agent': 'discord-bot-pro' } });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.title === 'string' ? data.title : null;
  } catch {
    return null;
  }
}

async function resolveInputToTracks(input) {
  const query = cleanQuery(input);
  if (!query) throw new Error('Please provide a valid query or URL.');

  
// URL flow
if (looksLikeUrl(query)) {
  let url = normalizeUrl(query);

  // YouTube links often include a `list=` param even when the user intends a single video.
  // If a `v=` is present, prefer treating it as a single video by stripping playlist params.
  try {
    if (isYouTubeUrl(url)) {
  const u = new URL(url);
  const v = u.searchParams.get('v');
  const list = u.searchParams.get('list');
  const isPlaylistPath = (u.pathname || '').toLowerCase().startsWith('/playlist');

  // Browser search-bar links can be:
  // - Single video: watch?v=...
  // - Playlist video: watch?v=...&list=PL...
  // - Auto "Mix/Radio": watch?v=...&list=RD...&start_radio=1
  //
  // Behavior:
  // - If it's a real playlist id (PL/OLAK/UU/LL), prefer playlist playback
  // - If it's an auto mix (RD...), prefer single video playback (avoid auto-adding 25+ tracks)
  if (list && !isPlaylistPath) {
    const isAutoMix = list.startsWith('RD') || u.searchParams.has('start_radio');
    const isRealPlaylist =
      list.startsWith('PL') || list.startsWith('OLAK') || list.startsWith('UU') || list.startsWith('LL');

    if (isAutoMix && v) {
      url = `https://www.youtube.com/watch?v=${v}`;
    } else if (isRealPlaylist) {
      url = `https://www.youtube.com/playlist?list=${list}`;
    } else if (v) {
      // default: keep as single video
      url = `https://www.youtube.com/watch?v=${v}`;
    }
  } else if (v && !isPlaylistPath) {
    // No list param: ensure clean watch URL
    url = `https://www.youtube.com/watch?v=${v}`;
  }
}
  } catch (_) {
    // ignore URL parsing issues, validate will handle
  }

  const type = await play.validate(url);

    // YouTube video
    if (type === 'yt_video') {
      const info = await play.video_basic_info(url);
      const vd = info?.video_details;
      return [
        {
          title: vd?.title ?? 'Unknown title',
          url: vd?.url ?? url,
          duration: (vd?.durationInSec ?? 0) || null,
          source: 'youtube',
        },
      ];
    }

    // YouTube playlist
    if (type === 'yt_playlist') {
      const playlist = await play.playlist_info(url, { incomplete: true });
      const videos = await playlist.all_videos(); // may be large
      const sliced = videos.slice(0, MAX_PLAYLIST_TRACKS);
      return sliced.map((v) => ({
        title: v?.title ?? 'Unknown title',
        url: v?.url,
        duration: (v?.durationInSec ?? 0) || null,
        source: 'youtube',
      })).filter((t) => typeof t.url === 'string' && t.url.startsWith('http'));
    }

    // SoundCloud track / playlist
    if (type === 'so_track' || type === 'so_playlist') {
      await ensureSoundCloudToken();
      const sc = await play.soundcloud(url);

      if (sc?.type === 'track') {
        return [
          {
            title: sc?.name ?? 'Unknown title',
            url: sc?.url ?? url,
            duration: (sc?.durationInSec ?? 0) || null,
            source: 'soundcloud',
          },
        ];
      }

      if (sc?.type === 'playlist') {
        const tracks = await sc.all_tracks();
        const sliced = tracks.slice(0, MAX_PLAYLIST_TRACKS);
        return sliced.map((t) => ({
          title: t?.name ?? 'Unknown title',
          url: t?.url,
          duration: (t?.durationInSec ?? 0) || null,
          source: 'soundcloud',
        })).filter((t) => typeof t.url === 'string' && t.url.startsWith('http'));
      }
    }

    // Spotify: play by matching to YouTube (Spotify cannot be streamed directly)
    if (type === 'sp_track' || type === 'sp_album' || type === 'sp_playlist') {
      // Try play-dl's spotify() first (works if tokens are available)
      try {
        if (play.is_expired?.() === true) await play.refreshToken();
        const spot = await play.spotify(url);

        if (spot?.type === 'track') {
          const title = spot?.name ?? spot?.title ?? 'Spotify track';
          const artist = Array.isArray(spot?.artists) ? spot.artists.map((a) => a?.name).filter(Boolean).join(', ') : '';
          const searchQ = artist ? `${title} ${artist}` : title;
          const yt = await play.search(searchQ, { source: { youtube: 'video' }, limit: 1 });
          if (!yt?.[0]?.url) throw new Error('No matching YouTube results found for that Spotify track.');
          return [
            {
              title: `${title}${artist ? ` — ${artist}` : ''} (Spotify → YouTube)`,
              url: yt[0].url,
              duration: (yt[0]?.durationInSec ?? 0) || null,
              source: 'spotify',
              originalUrl: url,
            },
          ];
        }

        if (spot?.type === 'playlist' || spot?.type === 'album') {
          const tracks = await spot.all_tracks();
          const sliced = tracks.slice(0, MAX_PLAYLIST_TRACKS);

          const resolved = [];
          for (const tr of sliced) {
            const title = tr?.name ?? tr?.title ?? 'Spotify track';
            const artist = Array.isArray(tr?.artists) ? tr.artists.map((a) => a?.name).filter(Boolean).join(', ') : '';
            const searchQ = artist ? `${title} ${artist}` : title;
            const yt = await play.search(searchQ, { source: { youtube: 'video' }, limit: 1 });
            if (!yt?.[0]?.url) continue;
            resolved.push({
              title: `${title}${artist ? ` — ${artist}` : ''} (Spotify → YouTube)`,
              url: yt[0].url,
              duration: (yt[0]?.durationInSec ?? 0) || null,
              source: 'spotify',
              originalUrl: url,
            });
            if (resolved.length >= MAX_PLAYLIST_TRACKS) break;
          }

          if (resolved.length === 0) throw new Error('No playable tracks found from that Spotify playlist/album.');
          return resolved;
        }
      } catch (e) {
        // Fallback: oEmbed for single-track (best effort)
        if (type === 'sp_track') {
          const title = await spotifyOEmbedTitle(url);
          if (title) {
            const yt = await play.search(title, { source: { youtube: 'video' }, limit: 1 });
            if (yt?.[0]?.url) {
              return [
                {
                  title: `${title} (Spotify → YouTube)`,
                  url: yt[0].url,
                  duration: (yt[0]?.durationInSec ?? 0) || null,
                  source: 'spotify',
                  originalUrl: url,
                },
              ];
            }
          }
        }

        throw new Error(
          'Spotify playlists/albums require Spotify credentials. If you want playlists, run `node -e "require(\'play-dl\').authorization()"` once, then set tokens with play.setToken() (see README). Spotify *tracks* may still work if a YouTube match is found.',
        );
      }
    }

    // Not supported
    throw new Error('Unsupported URL. Try a YouTube / YouTube Music / SoundCloud / Spotify link, or a search query.');
  }

  // Search flow: try play-dl first, fall back to yt-dlp search if broken
  let searchUrl = null;
  let searchTitle = null;
  let searchDuration = null;

  try {
    const results = await play.search(query, { source: { youtube: 'video' }, limit: 1 });
    const r = results?.[0];
    if (r?.url) {
      searchUrl = r.url;
      searchTitle = r.title || null;
      searchDuration = (r.durationInSec ?? 0) || null;
    }
  } catch (e) {
    logger.warn('[MUSIC] play-dl search failed, trying yt-dlp search:', e?.message);
  }

  // yt-dlp search fallback: ytsearch1:<query> resolves to the top YouTube result
  if (!searchUrl) {
    try {
      const cmd = getYtDlpCommand();
      const info = await new Promise((resolve, reject) => {
        const child = spawn(cmd, [
          '--no-warnings', '--no-playlist',
          '--print', '%(webpage_url)s|||%(title)s|||%(duration)s',
          `ytsearch1:${query}`,
        ], { windowsHide: true });

        let out = '', err = '';
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', d => { err += d; });
        child.on('close', code => {
          if (!out.trim()) return reject(new Error(err || 'No results from yt-dlp'));
          const parts = out.trim().split('|||');
          resolve({ url: parts[0]?.trim(), title: parts[1]?.trim(), duration: parseInt(parts[2], 10) || null });
        });
        child.on('error', reject);
      });

      if (info.url) {
        searchUrl = info.url;
        searchTitle = info.title || null;
        searchDuration = info.duration;
        logger.info('[MUSIC] yt-dlp search resolved:', searchTitle);
      }
    } catch (e) {
      logger.warn('[MUSIC] yt-dlp search also failed:', e?.message);
    }
  }

  if (!searchUrl) throw new Error('No results found. Try a direct YouTube URL.');

  return [
    {
      title: searchTitle ?? query,
      url: searchUrl,
      duration: searchDuration,
      source: 'youtube',
    },
  ];
}

async function playTrackInternal(st, track) {
  if (!track || typeof track.url !== 'string' || !track.url.startsWith('http')) {
    throw new Error('Track URL missing or invalid.');
  }

  // Stop any previous external process (e.g. yt-dlp) before starting a new track
  cleanupActiveProcess(st);

  const errors = [];
  const startupTimeoutMs = 12_000;
  const minStablePlaybackMs = 3_000;

  async function startPlayback(resource, sourceLabel) {
    if (!resource) throw new Error('Audio resource was not created.');

    if (resource.volume) {
      // Clamp: never allow 0 volume (causes silent playback), default to 0.5
      const safeVol = Math.max(0.01, Math.min(2, Number.isFinite(st.volume) ? st.volume : 0.5));
      resource.volume.setVolume(safeVol);
    }

    st.player.play(resource);
    await entersState(st.player, AudioPlayerStatus.Playing, startupTimeoutMs);
    logger.info(`[MUSIC] ${sourceLabel} playback confirmed for:`, track.title);

    // Guard against "fake start": some streams enter Playing and then end too quickly.
    // Use a state listener instead of entersState(timeout) to avoid AbortError false negatives.
    await new Promise((resolve, reject) => {
      let settled = false;
      const onState = (_oldState, newState) => {
        if (settled) return;
        if (newState?.status === AudioPlayerStatus.Idle) {
          settled = true;
          clearTimeout(timer);
          st.player.off('stateChange', onState);
          reject(new Error(`${sourceLabel} stream ended too quickly after start`));
        }
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        st.player.off('stateChange', onState);
        resolve();
      }, minStablePlaybackMs);
      st.player.on('stateChange', onState);
    });
  }

  // ── Strategy 1: yt-dlp (most reliable for YouTube, avoids signature issues) ──
  // Always try yt-dlp first for any URL — it handles YouTube, SoundCloud, and more.
  try {
    const resource = await tryCreateYtDlpResource(st, track.url);
    logger.info('[MUSIC] yt-dlp stream started for:', track.title);
    await startPlayback(resource, 'yt-dlp');
  } catch (err) {
    const msg = err?.message || String(err);
    const isNotFound = err?.code === 'ENOENT' || /ENOENT|not found|not recognized/i.test(msg);
    cleanupActiveProcess(st);
    try { st.player.stop(true); } catch {}
    if (isNotFound) {
      logger.warn('[MUSIC] yt-dlp not found, falling back to play-dl');
    } else {
      logger.warn({ err: msg, track: track.title, url: track.url }, '[MUSIC] yt-dlp failed');
      errors.push('yt-dlp: ' + msg);
    }
  }

  // ── Strategy 2: play-dl ────────────────────────────────────────────────────
  // Before play-dl, try a resilient path: yt-dlp direct URL + ffmpeg.
  if (st.player.state.status !== AudioPlayerStatus.Playing && isYouTubeUrl(track.url)) {
    try {
      const resource = await tryCreateYtDlpFfmpegResource(st, track.url);
      logger.info('[MUSIC] yt-dlp+ffmpeg stream started for:', track.title);
      await startPlayback(resource, 'yt-dlp+ffmpeg');
    } catch (e) {
      const msg = e?.message || String(e);
      logger.warn({ err: msg, track: track.title, url: track.url }, '[MUSIC] yt-dlp+ffmpeg failed');
      errors.push('yt-dlp+ffmpeg: ' + msg);
      try { st.player.stop(true); } catch {}
    }
  }

  // ── Strategy 3: play-dl ────────────────────────────────────────────────────
  if (st.player.state.status !== AudioPlayerStatus.Playing) {
    try {
      // play-dl sometimes needs a token refresh to work with YouTube
      if (play.is_expired && play.is_expired()) {
        await play.refreshToken().catch(() => {});
      }
      const stream = await play.stream(track.url, { quality: 2 });
      const resource = createAudioResource(stream.stream, {
        inputType: stream.type,
        inlineVolume: true,
      });
      st.activeProc = null;
      logger.info('[MUSIC] play-dl stream started for:', track.title);
      await startPlayback(resource, 'play-dl');
    } catch (e) {
      const msg = e?.message || String(e);
      logger.warn({ err: msg, track: track.title, url: track.url }, '[MUSIC] play-dl failed');
      errors.push('play-dl: ' + msg);
      try { st.player.stop(true); } catch {}
    }
  }

  // ── Strategy 4: ytdl-core (last resort for YouTube) ───────────────────────
  if (st.player.state.status !== AudioPlayerStatus.Playing && isYouTubeUrl(track.url)) {
    try {
      logger.warn('[MUSIC] Trying ytdl-core as last resort');
      const ytStream = ytdl(track.url, {
        filter: 'audioonly',
        quality: 'highestaudio',
        highWaterMark: 1 << 25,
        dlChunkSize: 0,
      });
      const probe = await demuxProbe(ytStream);
      const resource = createAudioResource(probe.stream, {
        inputType: probe.type,
        inlineVolume: true,
      });
      st.activeProc = null;
      logger.info('[MUSIC] ytdl-core stream started for:', track.title);
      await startPlayback(resource, 'ytdl-core');
    } catch (e) {
      const msg = e?.message || String(e);
      logger.warn({ err: msg, track: track.title, url: track.url }, '[MUSIC] ytdl-core failed');
      errors.push('ytdl-core: ' + msg);
      try { st.player.stop(true); } catch {}
    }
  }

  if (st.player.state.status !== AudioPlayerStatus.Playing) {
    throw new Error(
      `Unable to stream "${track.title}". All methods failed:\n${errors.join('\n')}\n` +
      'Make sure yt-dlp is up to date: run yt-dlp -U  (or replace bin/yt-dlp.exe)'
    );
  }
  st.current = track;
  st.lastActionAt = now();
  clearIdleTimer(st);
  void announceNowPlaying(st).catch(() => {});
}
async function playNextInternal(st) {
  // Keep shifting until we find a playable track or the queue is empty.
  while (true) {
    const next = st.queue.shift();
    if (!next) {
      scheduleIdleDisconnect(st);
      return;
    }

    try {
      await playTrackInternal(st, next);
      return;
    } catch (e) {
      logger.error({ err: e?.message || String(e), track: next?.title, url: next?.url }, '[MUSIC] play error for track');
      st.current = null;
      // Notify text channel of the failure
      if (st.textChannelId && st.client) {
        try {
          const ch = st.client.channels.cache.get(st.textChannelId);
          if (ch) await ch.send(`❌ Could not play **${next?.title || 'Unknown'}**: ${e?.message || 'Unknown error'}`).catch(() => {});
        } catch {}
      }
      // continue to next queued track
    }
  }
}

async function enqueueAndMaybePlay({ client, guild, voiceChannel, textChannelId, query, requestedBy, setAnnounceChannel = false }) {
  const st = getState(guild.id);
  if (client) st.client = client;

  const tracksRaw = await resolveInputToTracks(query);
  const tracks = Array.isArray(tracksRaw)
    ? tracksRaw.filter((t) => typeof t?.url === 'string' && t.url.startsWith('http'))
    : [];
  if (tracks.length === 0) throw new Error('No playable tracks found.');

  await ensureConnection(guild, voiceChannel, st);

  if (setAnnounceChannel) st.textChannelId = textChannelId ?? st.textChannelId;

  for (const t of tracks) {
    t.requestedBy = requestedBy;
    t.addedAt = now();
    st.queue.push(t);
  }
  // Start if nothing playing
  const isIdle = !st.current;
  if (isIdle) {
    await playNextInternal(st);
  }

  return { state: st, tracksAdded: tracks.length, firstTrack: tracks[0] };
}

function getNowPlaying(guildId) {
  const st = states.get(guildId);
  if (!st) return null;
  const isPaused = st.player?.state?.status === AudioPlayerStatus.Paused;
  return { current: st.current, queue: st.queue, volume: st.volume, stay247: st.stay247, voiceChannelId: st.voiceChannelId, loopMode: st.loopMode, paused: isPaused };
}

async function skip(guildId) {
  const st = states.get(guildId);
  if (!st) return false;
  cleanupActiveProcess(st);
  st.player.stop(true);
  return true;
}

async function stop(guildId) {
  const st = states.get(guildId);
  if (!st) return false;
  st.ignoreLoopOnce = true;
  st.queue = [];
  cleanupActiveProcess(st);
  st.player.stop(true);
  return true;
}

async function setVolume(guildId, vol) {
  const st = getState(guildId);
  st.volume = Math.max(0, Math.min(2, vol));
  // Only affects new resources; current resource volume can't be changed reliably without storing it.
  return st.volume;
}

async function set247(guildId, enabled) {
  const st = getState(guildId);
  st.stay247 = !!enabled;

  // persist
  await setGuildSettings(guildId, { music: { stay247: st.stay247, voiceChannelId: st.voiceChannelId, textChannelId: st.textChannelId } });

  if (!st.stay247) {
    scheduleIdleDisconnect(st);
  } else {
    clearIdleTimer(st);
  }

  return st.stay247;
}

async function leave(guildId, reason = 'Leave') {
  const st = states.get(guildId);
  const conn = getVoiceConnection(guildId);
  try {
    if (conn) conn.destroy();
  } catch {}
  if (st) {
    st.connection = null;
    st.queue = [];
    st.current = null;
    clearIdleTimer(st);
    st.stay247 = false;
    st.voiceChannelId = null;
  }
  // persist disabled if we left
  try {
    await setGuildSettings(guildId, { music: { stay247: false, voiceChannelId: null } });
  } catch {}
  return true;
}

async function restore247ForClient(client) {
  // Call on ready: iterate guilds and rejoin if enabled
  for (const guild of client.guilds.cache.values()) {
    try {
      const settings = await getGuildSettings(guild.id);
      const music = settings?.music ?? {};
      if (!music.stay247) continue;
      const channelId = music.voiceChannelId;
      if (!channelId) continue;

      const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
      if (!channel || !channel.isVoiceBased()) continue;

      const st = getState(guild.id);
      st.client = client;
      st.stay247 = true;
      st.voiceChannelId = channelId;
      st.textChannelId = music.textChannelId ?? null;

      await ensureConnection(guild, channel, st);
      // Keep idle connected, queue empty.
      clearIdleTimer(st);
      logger.info(`[MUSIC] Restored 24/7 connection in ${guild.name} (${channel.name})`);
    } catch (e) {
      logger.error('[MUSIC] restore error:', e);
    }
  }
}


async function connectOnly({ guild, voiceChannel, textChannelId, client, setAnnounceChannel = false }) {
  const st = getState(guild.id);
  await ensureConnection(guild, voiceChannel, st);
  st.voiceChannelId = voiceChannel.id;
  if (setAnnounceChannel) st.textChannelId = textChannelId ?? st.textChannelId;
  return st;
}



function pause(guildId) {
  const st = states.get(guildId);
  if (!st || !st.current) return false;
  try {
    st.player.pause(true);
    st.paused = true;
    return true;
  } catch (e) {
    logger.error('[MUSIC] pause error:', e);
    return false;
  }
}

function resume(guildId) {
  const st = states.get(guildId);
  if (!st || !st.current) return false;
  try {
    st.player.unpause();
    st.paused = false;
    return true;
  } catch (e) {
    logger.error('[MUSIC] resume error:', e);
    return false;
  }
}


function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function loopLabel(mode) {
  if (mode === 'track') return 'Track';
  if (mode === 'queue') return 'Queue';
  return 'Off';
}

function formatDuration(sec) {
  if (!sec || !Number.isFinite(sec)) return '??';
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildNowPlayingPayload(guildId) {
  const st = getState(guildId);
  const track = st.current;
  if (!track) return null;

  const emb = new EmbedBuilder()
    .setTitle('Now Playing')
    .setDescription(`[${track.title ?? 'Unknown'}](${track.url})`)
    .setFooter({ text: `Loop: ${loopLabel(st.loopMode)} | Volume: ${st.volume} | 24/7: ${st.stay247 ? 'On' : 'Off'}` });

  if (track.duration) {
    emb.addFields({ name: 'Duration', value: formatDuration(track.duration), inline: true });
  }
  if (track.requestedBy?.tag) {
    emb.addFields({ name: 'Requested by', value: track.requestedBy.tag, inline: true });
  }

  const paused = st.player?.state?.status === AudioPlayerStatus.Paused;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music:toggle')
      .setStyle(ButtonStyle.Secondary)
      .setLabel(paused ? 'Resume' : 'Pause'),
    new ButtonBuilder().setCustomId('music:skip').setStyle(ButtonStyle.Primary).setLabel('Skip'),
    new ButtonBuilder().setCustomId('music:stop').setStyle(ButtonStyle.Danger).setLabel('Stop'),
    new ButtonBuilder().setCustomId('music:queue:page:0').setStyle(ButtonStyle.Secondary).setLabel('Queue'),
    new ButtonBuilder().setCustomId('music:loop').setStyle(ButtonStyle.Secondary).setLabel(`Loop: ${loopLabel(st.loopMode)}`),
  );

  return { embeds: [emb], components: [row] };
}

function buildQueuePagePayload(guildId, page = 0, pageSize = 10) {
  const st = getState(guildId);
  const total = st.queue.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const p = clamp(page, 0, totalPages - 1);

  const start = p * pageSize;
  const slice = st.queue.slice(start, start + pageSize);

  const emb = new EmbedBuilder().setTitle('Queue');

  if (!st.current) {
    emb.setDescription('Nothing is playing right now.');
  }

  if (slice.length) {
    const lines = slice.map((t, i) => {
      const idx = start + i + 1; // 1-based upcoming
      return `**${idx}.** [${t.title ?? 'Unknown'}](${t.url})`;
    });
    emb.addFields({ name: `Up Next (Page ${p + 1}/${totalPages})`, value: lines.join('\n') });
  } else {
    emb.addFields({ name: 'Up Next', value: '*(empty)*' });
  }

  emb.setFooter({ text: `Total in queue: ${total} | Loop: ${loopLabel(st.loopMode)}` });

  const prev = new ButtonBuilder()
    .setCustomId(`music:queue:page:${p - 1}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Prev')
    .setDisabled(p <= 0);

  const next = new ButtonBuilder()
    .setCustomId(`music:queue:page:${p + 1}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Next')
    .setDisabled(p >= totalPages - 1);


const jump = new ButtonBuilder()
  .setCustomId(`music:queue:jump:${p}`)
  .setStyle(ButtonStyle.Primary)
  .setLabel('Jump to #')
  .setDisabled(total <= 0);

const close = new ButtonBuilder().setCustomId('music:queue:close').setStyle(ButtonStyle.Danger).setLabel('Close');

const row = new ActionRowBuilder().addComponents(prev, next, jump, close);

  return { embeds: [emb], components: [row] };
}

function setLoopMode(guildId, mode) {
  const st = getState(guildId);
  const m = String(mode || '').toLowerCase();
  if (!['off', 'track', 'queue'].includes(m)) throw new Error('Invalid loop mode.');
  st.loopMode = m;
  return st.loopMode;
}

function cycleLoopMode(guildId) {
  const st = getState(guildId);
  const order = ['off', 'track', 'queue'];
  const idx = order.indexOf(st.loopMode);
  st.loopMode = order[(idx + 1) % order.length];
  return st.loopMode;
}

async function jumpTo(guildId, position) {
  const st = getState(guildId);
  const n = Number(position);
  if (!Number.isFinite(n) || n < 1) throw new Error('Position must be a positive number.');
  if (n > st.queue.length) throw new Error(`Queue only has ${st.queue.length} upcoming track(s).`);
  // drop first n-1 upcoming tracks
  st.queue.splice(0, n - 1);

  if (st.current) {
    st.ignoreLoopOnce = true;
    st.player.stop(true);
  } else {
    await playNextInternal(st);
  }
  return st.queue[0] ?? null;
}

async function announceNowPlaying(st) {
  if (!st?.client || !st.textChannelId) return;
  const channel = await st.client.channels.fetch(st.textChannelId).catch(() => null);
  if (!channel) return;

  // Voice channels can be messageable in Discord's "text-in-voice" feature.
  // discord.js' isTextBased() may be false for them depending on version.
  const canSend = typeof channel.send === 'function';
  if (!canSend) return;

  const payload = buildNowPlayingPayload(st.guildId);
  if (!payload) return;

  await channel.send(payload).catch(() => {});
}

module.exports = {
  connectOnly,
  enqueueAndMaybePlay,
  getNowPlaying,
  skip,
  stop,
  setVolume,
  set247,
  leave,
  pause,
  resume,
  restore247ForClient,
  getState,
  peekState,
  getConnectedChannelId,
  buildNowPlayingPayload,
  buildQueuePagePayload,
  setLoopMode,
  cycleLoopMode,
  jumpTo,
  // internal: used by voiceStateUpdate to leave when alone (non 24/7)
  scheduleAloneDisconnect,
  clearAloneTimer,

  __test: {
    normalizeUrl,
    stripAngleBrackets,
    isYouTubeUrl,
  },
};
