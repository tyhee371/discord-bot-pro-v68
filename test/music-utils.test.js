/**
 * Regression tests — Music pure utility functions
 * Covers: cleanQuery, normalizeUrl, isYouTubeUrl, clamp, loopLabel, formatDuration
 *
 * These are all stateless pure functions extracted from musicService.js —
 * they require no Discord.js mock or voice connection setup.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// ── Minimal stubs so musicService.js can be loaded without real discord/voice ─
const { createRequire } = require('module');
const Module = require('module');
const originalLoad = Module._load;

const STUB_DISCORD = {
  EmbedBuilder: class {
    setTitle() { return this; }
    setDescription() { return this; }
    setFooter() { return this; }
    addFields() { return this; }
    setImage() { return this; }
    setThumbnail() { return this; }
    setTimestamp() { return this; }
  },
  ActionRowBuilder: class { addComponents() { return this; } },
  ButtonBuilder: class {
    setCustomId() { return this; }
    setStyle() { return this; }
    setLabel() { return this; }
    setDisabled() { return this; }
  },
  ButtonStyle: { Secondary: 2, Primary: 1, Danger: 4, Success: 3 },
  ChannelType: { GuildVoice: 2 },
};

const STUB_VOICE = {
  joinVoiceChannel: () => ({}),
  getVoiceConnection: () => null,
  createAudioPlayer: () => ({ on: () => {}, state: {} }),
  createAudioResource: () => ({}),
  demuxProbe: async () => ({ stream: null, type: null }),
  entersState: async () => {},
  AudioPlayerStatus: { Playing: 'playing', Paused: 'paused', Idle: 'idle' },
  NoSubscriberBehavior: { Play: 'play' },
  VoiceConnectionStatus: { Ready: 'ready', Disconnected: 'disconnected' },
  StreamType: { Arbitrary: 'arbitrary' },
};

const STUB_SETTINGS = {
  getGuildSettings: async () => ({}),
  setGuildSettings: async () => {},
};

Module._load = function (request, parent, isMain) {
  if (request === 'discord.js') return STUB_DISCORD;
  if (request === '@discordjs/voice') return STUB_VOICE;
  if (request.endsWith('/settings') || request.endsWith('\\settings')) return STUB_SETTINGS;
  if (request === 'play-dl') return {};
  if (request === '@distube/ytdl-core') return {};
  if (request === 'ffmpeg-static') return 'ffmpeg';
  if (request.endsWith('/logger') || request.endsWith('\\logger'))
    return { logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } };
  return originalLoad.apply(this, arguments);
};

// Load after stubs are in place
const musicUtil = require('../src/utils/musicService');

// ── cleanQuery ────────────────────────────────────────────────────────────────

test('cleanQuery trims whitespace', () => {
  assert.equal(musicUtil.cleanQuery('  hello world  '), 'hello world');
});

test('cleanQuery strips Discord angle-bracket wrapping', () => {
  assert.equal(musicUtil.cleanQuery('<https://youtube.com/watch?v=abc>'), 'https://youtube.com/watch?v=abc');
});

test('cleanQuery returns empty string for non-string input', () => {
  assert.equal(musicUtil.cleanQuery(null), '');
  assert.equal(musicUtil.cleanQuery(undefined), '');
  assert.equal(musicUtil.cleanQuery(42), '');
});

// ── normalizeUrl ──────────────────────────────────────────────────────────────

test('normalizeUrl rewrites YouTube Music URLs', () => {
  const result = musicUtil.normalizeUrl('https://music.youtube.com/watch?v=abc123');
  assert.ok(result.startsWith('https://www.youtube.com/'));
});

test('normalizeUrl rewrites mobile YouTube URLs', () => {
  const result = musicUtil.normalizeUrl('https://m.youtube.com/watch?v=abc123');
  assert.ok(result.startsWith('https://www.youtube.com/'));
});

test('normalizeUrl expands youtu.be short links', () => {
  const result = musicUtil.normalizeUrl('https://youtu.be/dQw4w9WgXcQ');
  assert.equal(result, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('normalizeUrl leaves regular YouTube URLs unchanged', () => {
  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  assert.equal(musicUtil.normalizeUrl(url), url);
});

// ── isYouTubeUrl ──────────────────────────────────────────────────────────────

test('isYouTubeUrl returns true for youtube.com URLs', () => {
  assert.equal(musicUtil.isYouTubeUrl('https://www.youtube.com/watch?v=abc'), true);
});

test('isYouTubeUrl returns true for youtu.be short links', () => {
  assert.equal(musicUtil.isYouTubeUrl('https://youtu.be/abc123'), true);
});

test('isYouTubeUrl returns false for non-YouTube URLs', () => {
  assert.equal(musicUtil.isYouTubeUrl('https://soundcloud.com/track'), false);
  assert.equal(musicUtil.isYouTubeUrl('https://spotify.com/track'), false);
});

test('isYouTubeUrl returns false for falsy input', () => {
  assert.equal(musicUtil.isYouTubeUrl(null), false);
  assert.equal(musicUtil.isYouTubeUrl(''), false);
});

// ── clamp ─────────────────────────────────────────────────────────────────────

test('clamp returns value within range', () => {
  assert.equal(musicUtil.clamp(5, 0, 10), 5);
});

test('clamp clamps below minimum', () => {
  assert.equal(musicUtil.clamp(-5, 0, 10), 0);
});

test('clamp clamps above maximum', () => {
  assert.equal(musicUtil.clamp(20, 0, 10), 10);
});

test('clamp returns min for non-finite input', () => {
  assert.equal(musicUtil.clamp(NaN, 0, 10), 0);
  assert.equal(musicUtil.clamp(Infinity, 0, 10), 10);
});

// ── loopLabel ─────────────────────────────────────────────────────────────────

test('loopLabel returns "Off" for "off"', () => {
  assert.equal(musicUtil.loopLabel('off'), 'Off');
});

test('loopLabel returns "Track" for "track"', () => {
  assert.equal(musicUtil.loopLabel('track'), 'Track');
});

test('loopLabel returns "Queue" for "queue"', () => {
  assert.equal(musicUtil.loopLabel('queue'), 'Queue');
});

test('loopLabel returns "Off" for unknown mode', () => {
  assert.equal(musicUtil.loopLabel('banana'), 'Off');
});

// ── formatDuration ────────────────────────────────────────────────────────────

test('formatDuration returns "??" for falsy input', () => {
  assert.equal(musicUtil.formatDuration(null), '??');
  assert.equal(musicUtil.formatDuration(0), '??');
  assert.equal(musicUtil.formatDuration(NaN), '??');
});

test('formatDuration formats seconds under a minute', () => {
  assert.equal(musicUtil.formatDuration(45), '0:45');
});

test('formatDuration formats minutes and seconds', () => {
  assert.equal(musicUtil.formatDuration(185), '3:05');
});

test('formatDuration formats hours, minutes, and seconds', () => {
  assert.equal(musicUtil.formatDuration(3661), '1:01:01');
});
