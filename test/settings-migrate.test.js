// Set dummy environment variables for testing
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'dummy_token_for_test';
process.env.CLIENT_ID = process.env.CLIENT_ID || 'dummy_client_id_for_test';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const { migrateSettings, CURRENT_SCHEMA_VERSION } = require('../src/utils/settings');

test('migrateSettings adds schemaVersion and prefix', () => {
  const { settings, changed } = migrateSettings({});
  assert.equal(changed, true);
  assert.equal(settings.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(settings.prefix, '!');
});

test('migrateSettings is idempotent', () => {
  const a = migrateSettings({ prefix: '??', schemaVersion: CURRENT_SCHEMA_VERSION }).settings;
  const b = migrateSettings(a).settings;
  assert.deepEqual(a, b);
});
