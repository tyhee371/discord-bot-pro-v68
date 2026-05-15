/**
 * Regression tests — Phase 5 advanced systems
 * Covers: ruleEngine (pure logic), aiModeration (rule-based path),
 *         diagnosticsSnapshot (canary checks), analyticsService (formatting)
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// ── Stubs ─────────────────────────────────────────────────────────────────────
const store = new Map();
const dbStub = {
  async get(key) { return store.get(key) ?? null; },
  async set(key, v) { store.set(key, v); },
  async delete(key) { store.delete(key); },
};
const loggerStub = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const metricsStub = {
  increment: () => {}, gauge: () => {}, rate: () => {},
  getCounter: () => 0, snapshot: () => ({ counters: {}, gauges: {}, rates: {}, uptimeSeconds: 0 }),
};
const schedulerStub = { _inProcess: new Map() };

const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req.endsWith('/db')     || req.endsWith('\\db'))     return { db: dbStub };
  if (req.endsWith('/logger') || req.endsWith('\\logger')) return { logger: loggerStub };
  if (req.endsWith('/metrics')|| req.endsWith('\\metrics'))return { metrics: metricsStub, Metrics: class {} };
  if (req.endsWith('/redis')  || req.endsWith('\\redis'))  return { redisClient: { isAvailable: () => false } };
  if (req.endsWith('/durableScheduler') || req.endsWith('\\durableScheduler'))
    return { scheduler: schedulerStub, DurableScheduler: class {} };
  if (req.endsWith('/modCases') || req.endsWith('\\modCases'))
    return { createCase: async () => ({ id: 1 }), getCase: async () => null, listCasesForUser: async () => [] };
  return origLoad.apply(this, arguments);
};

// ─────────────────────────────────────────────────────────────────────────────
// ruleEngine — validateRule
// ─────────────────────────────────────────────────────────────────────────────
const { validateRule, MAX_RULES, MAX_ACTIONS } = require('../src/utils/ruleEngine');

test('ruleEngine: validateRule accepts a valid rule', () => {
  const { ok, errors } = validateRule({
    id: 'r1', name: 'Test', trigger: 'message',
    conditions: [{ type: 'author_is_bot', params: {} }],
    actions:    [{ type: 'delete_message', params: {} }],
  });
  assert.equal(ok, true);
  assert.equal(errors.length, 0);
});

test('ruleEngine: validateRule rejects rule missing id', () => {
  const { ok, errors } = validateRule({ name: 'X', trigger: 'message', conditions: [], actions: [] });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('id')));
});

test('ruleEngine: validateRule rejects rule missing trigger', () => {
  const { ok, errors } = validateRule({ id: 'r1', name: 'X', conditions: [], actions: [] });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('trigger')));
});

test('ruleEngine: validateRule rejects too many actions', () => {
  const actions = Array.from({ length: MAX_ACTIONS + 1 }, () => ({ type: 'send_message', params: {} }));
  const { ok, errors } = validateRule({ id: 'r1', name: 'X', trigger: 'message', conditions: [], actions });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('Max')));
});

test('ruleEngine: validateRule blocks ban action', () => {
  const { ok, errors } = validateRule({
    id: 'r1', name: 'X', trigger: 'message',
    conditions: [],
    actions: [{ type: 'ban', params: {} }],
  });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('ban')));
});

test('ruleEngine: validateRule blocks kick action', () => {
  const { ok, errors } = validateRule({
    id: 'r1', name: 'X', trigger: 'message',
    conditions: [],
    actions: [{ type: 'kick', params: {} }],
  });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('kick')));
});

// ─────────────────────────────────────────────────────────────────────────────
// ruleEngine — condition evaluators
// ─────────────────────────────────────────────────────────────────────────────

// We access internals via re-require after clearing cache
delete require.cache[require.resolve('../src/utils/ruleEngine')];
const ruleEngineModule = require('../src/utils/ruleEngine');

// Test runRules with a mock guild — just verifies it doesn't throw
test('ruleEngine: runRules does not throw when no rules configured', async () => {
  store.set('settings:g1', JSON.stringify({ rules: [] }));

  // Patch getGuildSettings inline
  const settingsPath = require.resolve('../src/utils/settings');
  const origSettings = require.cache[settingsPath];
  require.cache[settingsPath] = {
    ...origSettings,
    exports: { ...((origSettings?.exports) ?? {}), getGuildSettings: async () => ({ rules: [] }) },
  };

  await assert.doesNotReject(() =>
    ruleEngineModule.runRules('g1', 'message', { guild: null, member: null, message: null, client: null }),
  );
});

test('ruleEngine: TRIGGERS constant is defined and non-empty', () => {
  const { TRIGGERS } = require('../src/utils/ruleEngine');
  assert.ok(Array.isArray(TRIGGERS) && TRIGGERS.length > 0);
  assert.ok(TRIGGERS.includes('message'));
  assert.ok(TRIGGERS.includes('member_join'));
});

// ─────────────────────────────────────────────────────────────────────────────
// aiModeration — rule-based path (no API key needed)
// ─────────────────────────────────────────────────────────────────────────────
const { ruleBasedScreen, CATEGORIES } = require('../src/utils/aiModeration');

test('aiModeration: ruleBasedScreen detects spam (repeated chars)', () => {
  const result = ruleBasedScreen('aaaaaaaaaaaaaaaa', {});
  assert.ok(result !== null);
  assert.equal(result.flagged, true);
  assert.equal(result.category, 'spam');
  assert.ok(result.confidence >= 0.9);
});

test('aiModeration: ruleBasedScreen detects multiple URLs', () => {
  const content = 'http://a.com http://b.com http://c.com http://d.com';
  const result = ruleBasedScreen(content, {});
  assert.ok(result !== null);
  assert.equal(result.flagged, true);
});

test('aiModeration: ruleBasedScreen detects Discord invite when blockInvites=true', () => {
  const result = ruleBasedScreen('join us discord.gg/example', { blockInvites: true });
  assert.ok(result !== null);
  assert.equal(result.flagged, true);
  assert.equal(result.category, 'spam');
});

test('aiModeration: ruleBasedScreen ignores invite when blockInvites=false', () => {
  const result = ruleBasedScreen('join us discord.gg/example', { blockInvites: false });
  assert.equal(result, null);
});

test('aiModeration: ruleBasedScreen returns null for clean content', () => {
  const result = ruleBasedScreen('Hello, how are you doing today?', {});
  assert.equal(result, null);
});

test('aiModeration: ruleBasedScreen returns null for empty input', () => {
  assert.equal(ruleBasedScreen('', {}), null);
  assert.equal(ruleBasedScreen(null, {}), null);
});

test('aiModeration: CATEGORIES object has required keys', () => {
  assert.ok(typeof CATEGORIES === 'object');
  assert.ok('hate_speech' in CATEGORIES);
  assert.ok('harassment' in CATEGORIES);
  assert.ok('spam' in CATEGORIES);
});

test('aiModeration: screenMessage returns disabled result when AI not enabled', async () => {
  const { screenMessage } = require('../src/utils/aiModeration');
  const result = await screenMessage('Hello world', 'g1', {});
  assert.equal(result.advisory, true);
  assert.ok(['disabled', 'rules'].includes(result.source));
});

// ─────────────────────────────────────────────────────────────────────────────
// diagnosticsSnapshot — canary checks
// ─────────────────────────────────────────────────────────────────────────────
const { runCanaryChecks, captureSnapshot } = require('../src/app/diagnosticsSnapshot');

test('canary: runCanaryChecks returns healthy/checks structure', async () => {
  const result = await runCanaryChecks(null);
  assert.ok(typeof result.healthy === 'boolean');
  assert.ok(Array.isArray(result.checks));
  assert.ok(result.checks.length > 0);
});

test('canary: each check has required fields', async () => {
  const result = await runCanaryChecks(null);
  for (const check of result.checks) {
    assert.ok('name' in check,    `check missing name`);
    assert.ok('healthy' in check, `check ${check.name} missing healthy`);
    assert.ok('message' in check, `check ${check.name} missing message`);
  }
});

test('canary: snapshot captures process section', async () => {
  const snap = await captureSnapshot(null);
  assert.ok(snap.capturedAt);
  assert.ok(snap.sections.process);
  assert.ok(typeof snap.sections.process.uptimeSeconds === 'number');
  assert.ok(typeof snap.sections.process.memRssMb === 'number');
  assert.ok(typeof snap.sections.process.nodeVersion === 'string');
});

test('canary: snapshot captures metrics section', async () => {
  const snap = await captureSnapshot(null);
  assert.ok('metrics' in snap.sections);
});

test('canary: snapshot errors array is present', async () => {
  const snap = await captureSnapshot(null);
  assert.ok(Array.isArray(snap.errors));
});

// ─────────────────────────────────────────────────────────────────────────────
// analyticsService — formatSnapshotFields
// ─────────────────────────────────────────────────────────────────────────────
const { formatSnapshotFields } = require('../src/app/analyticsService');

const MOCK_SNAP = {
  generatedAt:   Date.now(),
  discord:       { guilds: 3, users: 150, channels: 40, ping: 45, uptimeMs: 360000, shardCount: 1 },
  process:       { uptimeSeconds: 3600, memHeapUsedMb: 120, memHeapTotalMb: 256, memRssMb: 180 },
  scheduler:     { armedJobs: 2 },
  commandRates:  { slashPerMin: 5.2, prefixPerMin: 1.1 },
  eventRates:    { starboardPerMin: 0.5, stickyPerMin: 0, voicePerMin: 2, musicPlayPerMin: 3 },
  counters: {
    commandsExecuted:    100,
    settingsCacheHits:   80,
    settingsCacheMisses: 20,
    settingsWrites:      10,
    schedulerCompleted:  5,
    schedulerFailed:     0,
    schedulerDropped:    0,
    dlockAcquired:       30,
    dlockTimeout:        0,
    dlockFallback:       2,
  },
  gauges: { musicOpQueueDepth: 0 },
  rawMetrics: { counters: {}, gauges: {}, rates: {}, uptimeSeconds: 3600 },
};

test('analyticsService: formatSnapshotFields returns array of fields', () => {
  const fields = formatSnapshotFields(MOCK_SNAP);
  assert.ok(Array.isArray(fields));
  assert.ok(fields.length > 0);
});

test('analyticsService: each field has name and value', () => {
  const fields = formatSnapshotFields(MOCK_SNAP);
  for (const f of fields) {
    assert.ok(typeof f.name  === 'string' && f.name.length  > 0, 'field missing name');
    assert.ok(typeof f.value === 'string' && f.value.length > 0, 'field missing value');
  }
});

test('analyticsService: formatSnapshotFields works with null discord', () => {
  const snap = { ...MOCK_SNAP, discord: null };
  assert.doesNotThrow(() => formatSnapshotFields(snap));
});
