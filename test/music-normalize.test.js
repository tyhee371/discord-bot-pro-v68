// Set dummy environment variables for testing
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'dummy_token_for_test';
process.env.CLIENT_ID = process.env.CLIENT_ID || 'dummy_client_id_for_test';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../src/utils/musicService');

test('normalizeUrl converts youtube music and youtu.be', () => {
  assert.equal(
    __test.normalizeUrl('https://music.youtube.com/watch?v=abc123DEF45'),
    'https://www.youtube.com/watch?v=abc123DEF45',
  );

  assert.equal(
    __test.normalizeUrl('https://youtu.be/abc123DEF45'),
    'https://www.youtube.com/watch?v=abc123DEF45',
  );
});

test('stripAngleBrackets removes <...> formatting', () => {
  assert.equal(__test.stripAngleBrackets('<https://youtu.be/abc123DEF45>'), 'https://youtu.be/abc123DEF45');
});

test('youtube watch link with list=PL is treated as playlist URL in resolver logic (sanity)', () => {
  // This test checks normalizeUrl only; playlist conversion happens later in resolver.
  assert.equal(
    __test.normalizeUrl('https://www.youtube.com/watch?v=abc123DEF45&list=PLxxxx'),
    'https://www.youtube.com/watch?v=abc123DEF45&list=PLxxxx',
  );
});
