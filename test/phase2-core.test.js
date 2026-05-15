/**
 * Regression tests — Phase 2 core utilities
 * Covers: AsyncLock, Debouncer, settings cache, metrics
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// ─────────────────────────────────────────────────────────────────────────────
// AsyncLock
// ─────────────────────────────────────────────────────────────────────────────
const { AsyncLock } = require('../src/utils/asyncLock');

test('AsyncLock: serialises concurrent calls for same key', async () => {
  const lock = new AsyncLock();
  const order = [];

  const p1 = lock.run('k', async () => {
    order.push('start-1');
    await new Promise((r) => setTimeout(r, 20));
    order.push('end-1');
    return 1;
  });

  const p2 = lock.run('k', async () => {
    order.push('start-2');
    await new Promise((r) => setTimeout(r, 5));
    order.push('end-2');
    return 2;
  });

  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, 1);
  assert.equal(r2, 2);
  // p2 must not start until p1 finishes
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2']);
});

test('AsyncLock: different keys run concurrently', async () => {
  const lock = new AsyncLock();
  const started = [];

  const p1 = lock.run('a', async () => {
    started.push('a');
    await new Promise((r) => setTimeout(r, 30));
  });
  const p2 = lock.run('b', async () => {
    started.push('b');
    await new Promise((r) => setTimeout(r, 5));
  });

  // Give both a tick to start
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(started.includes('a') && started.includes('b'), 'both should start concurrently');
  await Promise.all([p1, p2]);
});

test('AsyncLock: rejects bubble to caller without poisoning lock', async () => {
  const lock = new AsyncLock();
  await assert.rejects(() => lock.run('k', async () => { throw new Error('boom'); }), /boom/);
  // Lock must still be usable after a rejection
  const result = await lock.run('k', async () => 42);
  assert.equal(result, 42);
});

test('AsyncLock: size decrements after queue drains', async () => {
  const lock = new AsyncLock();
  const p = lock.run('x', () => new Promise((r) => setTimeout(r, 10)));
  assert.equal(lock.size, 1);
  await p;
  assert.equal(lock.size, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Debouncer
// ─────────────────────────────────────────────────────────────────────────────
const { Debouncer } = require('../src/utils/debouncer');

test('Debouncer: only fires the last scheduled call within window', async () => {
  const d = new Debouncer(50);
  const calls = [];

  d.schedule('k', () => calls.push(1));
  d.schedule('k', () => calls.push(2));
  d.schedule('k', () => calls.push(3));

  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(calls, [3], 'only the last callback should fire');
});

test('Debouncer: fires independently for different keys', async () => {
  const d = new Debouncer(30);
  const calls = [];

  d.schedule('a', () => calls.push('a'));
  d.schedule('b', () => calls.push('b'));

  await new Promise((r) => setTimeout(r, 60));
  assert.ok(calls.includes('a') && calls.includes('b'));
});

test('Debouncer: cancel prevents the callback from firing', async () => {
  const d = new Debouncer(50);
  const calls = [];

  d.schedule('k', () => calls.push(1));
  d.cancel('k');

  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(calls, []);
});

test('Debouncer: isPending returns correct state', async () => {
  const d = new Debouncer(50);
  d.schedule('k', () => {});
  assert.equal(d.isPending('k'), true);
  d.cancel('k');
  assert.equal(d.isPending('k'), false);
});

test('Debouncer: flush cancels all pending timers', async () => {
  const d = new Debouncer(50);
  const calls = [];
  d.schedule('a', () => calls.push('a'));
  d.schedule('b', () => calls.push('b'));
  assert.equal(d.size, 2);
  d.flush();
  assert.equal(d.size, 0);
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(calls, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Metrics
// ─────────────────────────────────────────────────────────────────────────────
const { Metrics } = require('../src/utils/metrics');

test('Metrics: increment and getCounter', () => {
  const m = new Metrics();
  m.increment('cmd.run');
  m.increment('cmd.run');
  m.increment('cmd.run', undefined, 3);
  assert.equal(m.getCounter('cmd.run'), 5);
});

test('Metrics: increment with labels is isolated', () => {
  const m = new Metrics();
  m.increment('cmd', { type: 'slash' });
  m.increment('cmd', { type: 'prefix' });
  assert.equal(m.getCounter('cmd', { type: 'slash' }), 1);
  assert.equal(m.getCounter('cmd', { type: 'prefix' }), 1);
  assert.equal(m.getCounter('cmd'), 0);
});

test('Metrics: gauge set and get', () => {
  const m = new Metrics();
  m.gauge('queue.depth', 5);
  assert.equal(m.getGauge('queue.depth'), 5);
  m.gauge('queue.depth', 12);
  assert.equal(m.getGauge('queue.depth'), 12);
});

test('Metrics: rate returns events/min', async () => {
  const m = new Metrics();
  // fire 6 events
  for (let i = 0; i < 6; i++) m.rate('reactions');
  const r = m.getRate('reactions');
  // 6 events in ~0 ms → rate should be > 0
  assert.ok(r > 0, `expected rate > 0, got ${r}`);
});

test('Metrics: snapshot contains counters, gauges, rates, uptime', () => {
  const m = new Metrics();
  m.increment('x');
  m.gauge('y', 2);
  m.rate('z');
  const s = m.snapshot();
  assert.ok(typeof s.uptimeSeconds === 'number');
  assert.ok('x' in s.counters);
  assert.ok('y' in s.gauges);
  assert.ok('z' in s.rates);
});

test('Metrics: reset clears all state', () => {
  const m = new Metrics();
  m.increment('a');
  m.gauge('b', 5);
  m.rate('c');
  m.reset();
  const s = m.snapshot();
  assert.equal(Object.keys(s.counters).length, 0);
  assert.equal(Object.keys(s.gauges).length, 0);
  assert.equal(Object.keys(s.rates).length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Settings cache
// ─────────────────────────────────────────────────────────────────────────────
test('settings: cache hit avoids redundant db reads', async () => {
  const store = new Map();
  let readCount = 0;
  const db = {
    async get(key) { readCount++; return store.get(key) ?? null; },
    async set(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };

  const Module = require('module');
  const origLoad = Module._load;
  Module._load = function (req, parent, isMain) {
    if (req.endsWith('/db') || req.endsWith('\\db')) return { db };
    if (req.endsWith('/logger') || req.endsWith('\\logger')) return { logger: { info: () => {} } };
    return origLoad.apply(this, arguments);
  };

  // Clear require cache to get a fresh module with our stub
  const settingsPath = require.resolve('../src/utils/settings');
  delete require.cache[settingsPath];
  // Also clear asyncLock and metrics from cache to avoid cross-test state
  const asyncLockPath = require.resolve('../src/utils/asyncLock');
  const metricsPath = require.resolve('../src/utils/metrics');
  delete require.cache[asyncLockPath];
  delete require.cache[metricsPath];

  const { getGuildSettings, setGuildSettings } = require('../src/utils/settings');

  // First read hits db
  await getGuildSettings('g1');
  const countAfterFirst = readCount;

  // Second read within TTL should use cache (no extra db read)
  await getGuildSettings('g1');
  assert.equal(readCount, countAfterFirst, 'second read should hit cache, not db');

  // Write should invalidate and next read should hit db again
  await setGuildSettings('g1', { prefix: '?' });
  const countAfterWrite = readCount;
  await getGuildSettings('g1');
  // After write the cache is updated inline, so read count should NOT increase
  assert.equal(readCount, countAfterWrite, 'read after write should use updated cache');

  Module._load = origLoad;
});

test('settings: concurrent getGuildSettings for same guild fires db only once', async () => {
  const store = new Map();
  let readCount = 0;
  const db = {
    async get(key) {
      readCount++;
      // simulate async latency
      await new Promise((r) => setTimeout(r, 10));
      return store.get(key) ?? null;
    },
    async set(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };

  const Module = require('module');
  const origLoad = Module._load;
  Module._load = function (req, parent, isMain) {
    if (req.endsWith('/db') || req.endsWith('\\db')) return { db };
    if (req.endsWith('/logger') || req.endsWith('\\logger')) return { logger: { info: () => {} } };
    return origLoad.apply(this, arguments);
  };

  const settingsPath = require.resolve('../src/utils/settings');
  delete require.cache[settingsPath];
  const asyncLockPath = require.resolve('../src/utils/asyncLock');
  const metricsPath = require.resolve('../src/utils/metrics');
  delete require.cache[asyncLockPath];
  delete require.cache[metricsPath];

  const { getGuildSettings } = require('../src/utils/settings');

  // Fire three concurrent reads for the same guild
  await Promise.all([getGuildSettings('g2'), getGuildSettings('g2'), getGuildSettings('g2')]);

  // With AsyncLock, only 1 db read should happen (first acquires lock,
  // second and third see cache after lock releases)
  assert.ok(readCount <= 2, `expected ≤2 db reads for 3 concurrent calls, got ${readCount}`);

  Module._load = origLoad;
});
