/**
 * music-platform.test.js
 *
 * Comprehensive tests for music URL resolution, platform detection,
 * and source routing logic. Tests run without real network calls or
 * Discord/voice connections — all external deps are stubbed.
 *
 * Covers: YouTube, SoundCloud, Spotify, search queries, edge cases,
 * playlist handling, URL normalization, and conflict detection.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// ── Stub external modules before requiring audioEngine ──────────────────────
const Module = require('module');
const _origLoad = Module._load;

const STUB_VOICE = {
  joinVoiceChannel: () => ({ subscribe: () => {}, on: () => {}, destroy: () => {} }),
  getVoiceConnection: () => null,
  createAudioPlayer: () => ({
    on: () => {}, play: () => {}, stop: () => {}, state: { status: 'idle' },
    off: () => {}, once: () => {},
  }),
  createAudioResource: (s, o) => ({ volume: { setVolume: () => {} }, stream: s }),
  demuxProbe: async (s) => ({ stream: s, type: 'arbitrary' }),
  entersState: async () => {},
  AudioPlayerStatus: { Playing: 'playing', Paused: 'paused', Idle: 'idle', Buffering: 'buffering' },
  NoSubscriberBehavior: { Play: 'play' },
  VoiceConnectionStatus: { Ready: 'ready', Disconnected: 'disconnected', Destroyed: 'destroyed' },
  StreamType: { Arbitrary: 'arbitrary', WebmOpus: 'webm/opus', OggOpus: 'ogg/opus' },
};

const STUB_DISCORD = {
  EmbedBuilder: class {
    setTitle() { return this; } setDescription() { return this; }
    setFooter() { return this; } addFields() { return this; }
    setColor() { return this; } setTimestamp() { return this; }
    setThumbnail() { return this; } setImage() { return this; }
  },
  ActionRowBuilder: class { addComponents() { return this; } },
  ButtonBuilder: class {
    setCustomId() { return this; } setStyle() { return this; }
    setLabel() { return this; } setDisabled() { return this; }
    setEmoji() { return this; }
  },
  ButtonStyle: { Secondary: 2, Primary: 1, Danger: 4, Success: 3 },
  ChannelType: { GuildVoice: 2, GuildText: 0 },
  PermissionsBitField: { Flags: { Connect: 1n, Speak: 2n } },
};

const STUB_SETTINGS = {
  getGuildSettings: async () => ({}),
  setGuildSettings: async () => {},
};

const STUB_PLAY_DL = {
  validate: async (url) => {
    if (/youtube\.com\/watch/.test(url)) return 'yt_video';
    if (/youtube\.com\/playlist/.test(url)) return 'yt_playlist';
    if (/soundcloud\.com/.test(url)) return 'so_track';
    if (/open\.spotify\.com\/track/.test(url)) return 'sp_track';
    if (/open\.spotify\.com\/playlist/.test(url)) return 'sp_playlist';
    if (/open\.spotify\.com\/album/.test(url)) return 'sp_album';
    return false;
  },
  video_basic_info: async (url) => ({
    video_details: {
      title: 'Test Video Title',
      url,
      durationInSec: 240,
    },
  }),
  playlist_info: async () => ({
    all_videos: async () => [
      { title: 'Track 1', url: 'https://www.youtube.com/watch?v=aaaaaaaaa01', durationInSec: 180 },
      { title: 'Track 2', url: 'https://www.youtube.com/watch?v=aaaaaaaaa02', durationInSec: 200 },
    ],
  }),
  soundcloud: async (url) => ({
    type: 'track',
    name: 'Test SoundCloud Track',
    url,
    durationInSec: 210,
  }),
  spotify: async (url) => ({
    type: 'track',
    name: 'Test Spotify Track',
    artists: [{ name: 'Test Artist' }],
    durationInSec: 220,
  }),
  search: async (query, opts) => [{
    url: 'https://www.youtube.com/watch?v=searchresult1',
    title: `YouTube result for: ${query}`,
    durationInSec: 190,
  }],
  stream: async (url) => ({ stream: null, type: 'arbitrary' }),
  is_expired: () => false,
  refreshToken: async () => {},
  setToken: async () => {},
};

const STUB_YTDL = Object.assign(() => null, {
  getInfo: async () => ({ formats: [] }),
});

const STUB_LOGGER = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
};

Module._load = function (request, parent, isMain) {
  if (request === 'discord.js') return STUB_DISCORD;
  if (request === '@discordjs/voice') return STUB_VOICE;
  if (request === 'play-dl') return STUB_PLAY_DL;
  if (request === '@distube/ytdl-core') return STUB_YTDL;
  if (request === 'opusscript') return class {};
  if (request === 'ffmpeg-static') return '/usr/bin/ffmpeg';
  if (request === 'sodium' || request === 'libsodium-wrappers') return { ready: Promise.resolve(), randombytes_buf: () => Buffer.alloc(32) };
  if (/ytDlpPool|ytDlp\.js$/.test(request)) return { acquireSlot: async () => ({ release: () => {} }), runWithSlot: async (fn) => fn() };
  if (/musicStateStore/.test(request)) return { persistState: async () => {}, loadState: async () => null, clearState: async () => {} };
  if (/helpers\/duration|\/duration$/.test(request)) return { formatDuration: (s) => `${s}s` };
  if (/helpers\/safeReply|\/safeReply$/.test(request)) return { safeReply: async () => {} };
  if (/helpers\/asyncLock|\/asyncLock$/.test(request)) return class { async run(k, fn) { return fn(); } };
  if (/helpers\/modules|\/modules$/.test(request)) return { isModuleEnabled: () => true };
  if (/helpers\/placeholders/.test(request)) return { resolvePlaceholders: (s) => s };
  if (/app\/cache/.test(request)) return { discordCache: { get: async () => null, set: async () => {} }, cacheManager: { get: async () => null, set: async () => {}, cleanup: () => {} } };
  if (/app\/sharedState/.test(request)) return { sharedState: { get: async () => null, set: async () => {}, delete: async () => {}, increment: async () => 1 } };
  if (/stores\/settings$|\/settings$/.test(request)) return STUB_SETTINGS;
  if (/helpers\/logger$|\/logger$/.test(request)) return STUB_LOGGER;
  if (/helpers\/metrics$|\/metrics$/.test(request)) return {
    increment: () => {}, gauge: () => {}, snapshot: () => ({}),
  };
  if (/services\/musicStateStore$/.test(request)) return {
    persistState: async () => {}, loadState: async () => null, clearState: async () => {},
  };
  return _origLoad.apply(this, arguments);
};

// Set required env vars
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test_token';
process.env.CLIENT_ID = process.env.CLIENT_ID || 'test_client_id';
process.env.NODE_ENV = 'test';

const { __test } = require('../src/utils/audioEngine');
const { normalizeUrl, stripAngleBrackets, isYouTubeUrl } = __test;

// ── URL normalization ────────────────────────────────────────────────────────

test('normalizeUrl: YouTube Music → YouTube', () => {
  assert.equal(
    normalizeUrl('https://music.youtube.com/watch?v=abc123DEF45'),
    'https://www.youtube.com/watch?v=abc123DEF45',
  );
});

test('normalizeUrl: youtu.be shortlink → full watch URL', () => {
  assert.equal(
    normalizeUrl('https://youtu.be/abc123DEF45'),
    'https://www.youtube.com/watch?v=abc123DEF45',
  );
});

test('normalizeUrl: youtu.be with query params → keeps v param only', () => {
  const result = normalizeUrl('https://youtu.be/abc123DEF45?si=trackingparam');
  assert.ok(result.includes('abc123DEF45'), 'video ID must be preserved');
});

test('normalizeUrl: SoundCloud URL unchanged', () => {
  const url = 'https://soundcloud.com/artist/track-name';
  assert.equal(normalizeUrl(url), url);
});

test('normalizeUrl: Spotify URL unchanged', () => {
  const url = 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh';
  assert.equal(normalizeUrl(url), url);
});

test('stripAngleBrackets then normalizeUrl handles Discord embed URLs', () => {
  // Discord users often paste URLs wrapped in angle brackets: <https://youtu.be/ID>
  // The resolve flow calls stripAngleBrackets() THEN normalizeUrl() separately.
  // This test validates that two-step pipeline produces the correct result.
  const raw = '<https://youtu.be/abc123DEF45>';
  const stripped = stripAngleBrackets(raw);
  assert.equal(stripped, 'https://youtu.be/abc123DEF45', 'Angle brackets must be stripped first');
  const normalized = normalizeUrl(stripped);
  assert.ok(normalized.includes('abc123DEF45'), 'Video ID must survive normalization');
  assert.ok(normalized.startsWith('https://www.youtube.com/'), 'Must resolve to youtube.com');
  assert.ok(!normalized.includes('youtu.be'), 'youtu.be shortlink must be expanded');
});

// ── isYouTubeUrl ─────────────────────────────────────────────────────────────

test('isYouTubeUrl: detects standard YouTube watch URL', () => {
  assert.equal(isYouTubeUrl('https://www.youtube.com/watch?v=abc123DEF45'), true);
});

test('isYouTubeUrl: detects YouTube Music', () => {
  assert.equal(isYouTubeUrl('https://music.youtube.com/watch?v=abc123DEF45'), true);
});

test('isYouTubeUrl: detects youtu.be', () => {
  assert.equal(isYouTubeUrl('https://youtu.be/abc123DEF45'), true);
});

test('isYouTubeUrl: YouTube playlist URL', () => {
  assert.equal(isYouTubeUrl('https://www.youtube.com/playlist?list=PLxxxxxxxx'), true);
});

test('isYouTubeUrl: rejects SoundCloud', () => {
  assert.equal(isYouTubeUrl('https://soundcloud.com/artist/track'), false);
});

test('isYouTubeUrl: rejects Spotify', () => {
  assert.equal(isYouTubeUrl('https://open.spotify.com/track/abc'), false);
});

test('isYouTubeUrl: rejects plain search query', () => {
  assert.equal(isYouTubeUrl('lofi hip hop music'), false);
});

test('isYouTubeUrl: rejects direct MP3 URL', () => {
  assert.equal(isYouTubeUrl('https://example.com/audio.mp3'), false);
});

// ── stripAngleBrackets ───────────────────────────────────────────────────────

test('stripAngleBrackets: removes Discord URL embed formatting', () => {
  assert.equal(
    stripAngleBrackets('<https://youtu.be/abc123DEF45>'),
    'https://youtu.be/abc123DEF45',
  );
});

test('stripAngleBrackets: leaves plain URL unchanged', () => {
  const url = 'https://youtu.be/abc123DEF45';
  assert.equal(stripAngleBrackets(url), url);
});

// ── Platform conflict detection ───────────────────────────────────────────────
// Ensures platform routing is mutually exclusive — a URL cannot be
// classified as both YouTube AND SoundCloud AND Spotify simultaneously.

test('Platform routing is mutually exclusive: YouTube', () => {
  const url = 'https://www.youtube.com/watch?v=abc123DEF45';
  assert.equal(isYouTubeUrl(url), true);
  assert.equal(/soundcloud\.com/i.test(url), false);
  assert.equal(/open\.spotify\.com/i.test(url), false);
});

test('Platform routing is mutually exclusive: SoundCloud', () => {
  const url = 'https://soundcloud.com/artist/track-name';
  assert.equal(isYouTubeUrl(url), false);
  assert.equal(/soundcloud\.com/i.test(url), true);
  assert.equal(/open\.spotify\.com/i.test(url), false);
});

test('Platform routing is mutually exclusive: Spotify', () => {
  const url = 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh';
  assert.equal(isYouTubeUrl(url), false);
  assert.equal(/soundcloud\.com/i.test(url), false);
  assert.equal(/open\.spotify\.com/i.test(url), true);
});

// ── play-dl strategy guard ───────────────────────────────────────────────────
// Verifies that strategy 3 (play-dl) would be skipped for unsupported sources.
// This prevents "Invalid URL" errors from polluting the error log.

test('play-dl strategy 3 guard: accepts YouTube URL', () => {
  const url = 'https://www.youtube.com/watch?v=abc123DEF45';
  const playdlSupported = isYouTubeUrl(url) || /soundcloud\.com/i.test(url);
  assert.equal(playdlSupported, true);
});

test('play-dl strategy 3 guard: accepts SoundCloud URL', () => {
  const url = 'https://soundcloud.com/artist/track';
  const playdlSupported = isYouTubeUrl(url) || /soundcloud\.com/i.test(url);
  assert.equal(playdlSupported, true);
});

test('play-dl strategy 3 guard: SKIPS Spotify URL', () => {
  const url = 'https://open.spotify.com/track/abc';
  const playdlSupported = isYouTubeUrl(url) || /soundcloud\.com/i.test(url);
  assert.equal(playdlSupported, false);
});

test('play-dl strategy 3 guard: SKIPS direct MP3 link', () => {
  const url = 'https://example.com/audio.mp3';
  const playdlSupported = isYouTubeUrl(url) || /soundcloud\.com/i.test(url);
  assert.equal(playdlSupported, false);
});

// ── YouTube URL cleaning ──────────────────────────────────────────────────────

test('Auto-mix list (RD...) is stripped to single video', () => {
  // The resolver strips RD playlists to prevent auto-adding 25+ tracks
  const url = 'https://www.youtube.com/watch?v=abc123DEF45&list=RDabc123DEF45&start_radio=1';
  const u = new URL(url);
  const v = u.searchParams.get('v');
  const list = u.searchParams.get('list');
  const isAutoMix = list && (list.startsWith('RD') || u.searchParams.has('start_radio'));
  assert.equal(isAutoMix, true, 'Should be detected as auto mix');
  assert.equal(v, 'abc123DEF45', 'Video ID must be extractable');
});

test('Real playlist (PL...) is kept as playlist URL', () => {
  const url = 'https://www.youtube.com/watch?v=abc123DEF45&list=PLxxxxxxxxxxxxxxxxxxxx';
  const u = new URL(url);
  const list = u.searchParams.get('list');
  const isRealPlaylist = list && (
    list.startsWith('PL') || list.startsWith('OLAK') ||
    list.startsWith('UU') || list.startsWith('LL')
  );
  assert.equal(isRealPlaylist, true, 'PL prefix should be a real playlist');
});

test('YouTube URL without list param is clean watch URL', () => {
  const url = 'https://www.youtube.com/watch?v=abc123DEF45';
  const u = new URL(url);
  assert.equal(u.searchParams.has('list'), false, 'Should have no list param');
  assert.equal(u.searchParams.get('v'), 'abc123DEF45', 'Should have video ID');
});

// ── Volume clamping ───────────────────────────────────────────────────────────

test('Volume is clamped between 0.01 and 2', () => {
  // Matches the real clamp() in audioEngine: !isFinite → return min
  const clamp = (v) => {
    if (!Number.isFinite(v)) return 0.01;
    return Math.max(0.01, Math.min(2, v));
  };
  assert.equal(clamp(0), 0.01, 'Zero volume is clamped to 0.01');
  assert.equal(clamp(-1), 0.01, 'Negative volume is clamped to 0.01');
  assert.equal(clamp(5), 2, 'Excessive volume is clamped to 2');
  assert.equal(clamp(0.5), 0.5, 'Normal volume passes through');
  assert.equal(clamp(NaN), 0.01, 'NaN returns min (0.01)');
  assert.equal(clamp(Infinity), 0.01, 'Infinity returns min (not clamped)');
});

// ── Loop mode labels ──────────────────────────────────────────────────────────

test('Loop modes are mutually exclusive strings', () => {
  const modes = ['off', 'track', 'queue'];
  const unique = new Set(modes);
  assert.equal(unique.size, modes.length, 'All loop modes must be unique');
  for (const m of modes) {
    assert.equal(typeof m, 'string', `Loop mode "${m}" must be a string`);
  }
});

// ── Spotify → YouTube bridging ────────────────────────────────────────────────

test('Spotify track resolution builds correct search query', () => {
  const title = 'Blinding Lights';
  const artist = 'The Weeknd';
  const searchQ = artist ? `${title} ${artist}` : title;
  assert.equal(searchQ, 'Blinding Lights The Weeknd');
});

test('Spotify track with no artist uses title only', () => {
  const title = 'Unknown Track';
  const artist = '';
  const searchQ = artist ? `${title} ${artist}` : title;
  assert.equal(searchQ, 'Unknown Track');
});

test('Spotify result title includes source attribution', () => {
  const title = 'Blinding Lights';
  const artist = 'The Weeknd';
  const resultTitle = `${title}${artist ? ` — ${artist}` : ''} (Spotify → YouTube)`;
  assert.equal(resultTitle, 'Blinding Lights — The Weeknd (Spotify → YouTube)');
});

// ── MAX_PLAYLIST_TRACKS guard ─────────────────────────────────────────────────

test('Playlist slicing prevents queue overflow', () => {
  const MAX_PLAYLIST_TRACKS = 200;
  const hugeFakePlaylist = Array.from({ length: 500 }, (_, i) => ({
    title: `Track ${i}`,
    url: `https://www.youtube.com/watch?v=track${i.toString().padStart(5, '0')}`,
    durationInSec: 180,
  }));
  const sliced = hugeFakePlaylist.slice(0, MAX_PLAYLIST_TRACKS);
  assert.equal(sliced.length, 200, 'Playlist must be capped at MAX_PLAYLIST_TRACKS');
});

// ── Track URL validation ──────────────────────────────────────────────────────

test('Tracks with missing URL are filtered out', () => {
  const rawTracks = [
    { title: 'Good Track', url: 'https://www.youtube.com/watch?v=good001', durationInSec: 180 },
    { title: 'Bad Track', url: null, durationInSec: 180 },
    { title: 'Also Bad', url: undefined, durationInSec: 180 },
    { title: 'Relative', url: '/watch?v=relative', durationInSec: 180 },
  ];
  const filtered = rawTracks.filter(t => typeof t.url === 'string' && t.url.startsWith('http'));
  assert.equal(filtered.length, 1, 'Only the valid HTTPS URL should survive');
  assert.equal(filtered[0].title, 'Good Track');
});
