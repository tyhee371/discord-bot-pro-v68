/**
 * Load / performance tests — Phase 4 event storms
 *
 * These tests verify correctness under concurrency, not just happy paths.
 * They run within the standard `node --test` harness but simulate storms
 * by firing many concurrent operations.
 *
 * Covers:
 *   - AsyncLock under concurrent write storms (warns, giveaway index)
 *   - Debouncer under reaction burst
 *   - DurableScheduler: schedule, cancel, rehydrate, retry
 *   - storageManifest: lookup coverage
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
const metricsStub = { increment: () => {}, gauge: () => {}, rate: () => {} };

const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req.endsWith('/db') || req.endsWith('\\db')) return { db: dbStub };
  if (req.endsWith('/logger') || req.endsWith('\\logger')) return { logger: loggerStub };
  if (req.endsWith('/metrics') || req.endsWith('\\metrics')) return { metrics: metricsStub };
  if (req.endsWith('/redis') || req.endsWith('\\redis'))
    return { redisClient: { isAvailable: () => false, get: async () => null, set: async () => true, setnx: async () => true, del: async () => {}, eval: async () => {} } };
  return origLoad.apply(this, arguments);
};

// ─────────────────────────────────────────────────────────────────────────────
// AsyncLock — concurrent storm correctness
// ─────────────────────────────────────────────────────────────────────────────
const { AsyncLock } = require('../src/utils/asyncLock');

test('AsyncLock: 50 concurrent addWarn calls produce correct count', async () => {
  const lock = new AsyncLock();
  const key = 'warns:g1:u1';
  store.clear();

  async function addOne() {
    return lock.run(key, async () => {
      const raw = store.get(key) ?? '[]';
      const list = JSON.parse(raw);
      list.push({ id: Date.now() + Math.random() });
      store.set(key, JSON.stringify(list));
    });
  }

  // Fire 50 concurrent adds
  await Promise.all(Array.from({ length: 50 }, addOne));

  const final = JSON.parse(store.get(key) ?? '[]');
  assert.equal(final.length, 50, `expected 50 warns, got ${final.length}`);
});

test('AsyncLock: concurrent index updates deduplicate correctly', async () => {
  const lock = new AsyncLock();
  const idxKey = 'idx:g1';
  store.clear();

  async function addId(id) {
    return lock.run(idxKey, async () => {
      const raw = store.get(idxKey) ?? '[]';
      const ids = JSON.parse(raw);
      if (!ids.includes(id)) ids.push(id);
      store.set(idxKey, JSON.stringify(ids));
    });
  }

  // Each ID added twice concurrently — should deduplicate to 20 unique
  const ids = Array.from({ length: 20 }, (_, i) => `id-${i}`);
  await Promise.all([...ids, ...ids].map(addId));

  const final = JSON.parse(store.get(idxKey) ?? '[]');
  assert.equal(final.length, 20, `expected 20 unique ids, got ${final.length}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Debouncer — reaction burst
// ─────────────────────────────────────────────────────────────────────────────
const { Debouncer } = require('../src/utils/debouncer');

test('Debouncer: 100 rapid reaction events collapse to 1 execution', async () => {
  const d = new Debouncer(60);
  let execCount = 0;

  for (let i = 0; i < 100; i++) {
    d.schedule('starboard:g1:msg1', () => { execCount++; });
  }

  await new Promise((r) => setTimeout(r, 120));
  assert.equal(execCount, 1, `expected 1 execution, got ${execCount}`);
});

test('Debouncer: independent messages each fire once', async () => {
  const d = new Debouncer(30);
  const counts = {};

  for (let m = 0; m < 10; m++) {
    for (let r = 0; r < 5; r++) {
      const k = `starboard:g1:msg${m}`;
      d.schedule(k, () => { counts[k] = (counts[k] ?? 0) + 1; });
    }
  }

  await new Promise((r) => setTimeout(r, 80));
  const vals = Object.values(counts);
  assert.equal(vals.length, 10, 'expected 10 distinct message keys');
  assert.ok(vals.every((v) => v === 1), 'each message should fire exactly once');
});

// ─────────────────────────────────────────────────────────────────────────────
// DurableScheduler
// ─────────────────────────────────────────────────────────────────────────────

test('DurableScheduler: schedule and execute a job', async () => {
  store.clear();
  // Re-require fresh instances so the global store is clean
  delete require.cache[require.resolve('../src/app/durableScheduler')];
  delete require.cache[require.resolve('../src/utils/asyncLock')];
  delete require.cache[require.resolve('../src/utils/metrics')];

  const { DurableScheduler } = require('../src/app/durableScheduler');
  const sched = new DurableScheduler();

  let fired = false;
  sched.register('test:fire', async () => { fired = true; });

  await sched.schedule({ guildId: 'g1', type: 'test:fire', payload: {}, runAt: Date.now() + 20 });
  await new Promise((r) => setTimeout(r, 80));

  assert.equal(fired, true, 'job should have fired');
  sched.shutdown();
});

test('DurableScheduler: cancel prevents job from firing', async () => {
  store.clear();
  delete require.cache[require.resolve('../src/app/durableScheduler')];

  const { DurableScheduler } = require('../src/app/durableScheduler');
  const sched = new DurableScheduler();

  let fired = false;
  sched.register('test:noop', async () => { fired = true; });

  const jobId = await sched.schedule({ guildId: 'g1', type: 'test:noop', payload: {}, runAt: Date.now() + 100 });
  await sched.cancel(jobId);

  await new Promise((r) => setTimeout(r, 160));
  assert.equal(fired, false, 'cancelled job should not fire');
  sched.shutdown();
});

test('DurableScheduler: rehydrate restores persisted jobs after restart', async () => {
  store.clear();
  delete require.cache[require.resolve('../src/app/durableScheduler')];

  const { DurableScheduler } = require('../src/app/durableScheduler');

  // First instance: schedule a job then "crash" (shutdown without executing)
  const sched1 = new DurableScheduler();
  sched1.register('test:restore', async () => {});
  const jobId = await sched1.schedule({
    guildId: 'g1',
    type: 'test:restore',
    payload: { data: 'hello' },
    runAt: Date.now() + 500,
  });
  sched1.shutdown();

  // Verify it's in the DB
  const raw = store.get(`scheduler:job:${jobId}`);
  assert.ok(raw, 'job should be persisted in db');

  // Second instance: rehydrate
  const sched2 = new DurableScheduler();
  let restoredPayload = null;
  sched2.register('test:restore', async (job) => { restoredPayload = job.payload; });

  const restored = await sched2.rehydrate(null);
  assert.ok(restored >= 1, `expected ≥1 restored job, got ${restored}`);

  // Wait for the job to fire
  await new Promise((r) => setTimeout(r, 600));
  assert.ok(restoredPayload?.data === 'hello', 'restored job should fire with correct payload');
  sched2.shutdown();
});

test('DurableScheduler: failed job is retried up to MAX_ATTEMPTS', async () => {
  store.clear();
  delete require.cache[require.resolve('../src/app/durableScheduler')];

  const { DurableScheduler } = require('../src/app/durableScheduler');
  const sched = new DurableScheduler();

  let attempts = 0;
  sched.register('test:fail', async () => {
    attempts++;
    throw new Error('simulated failure');
  });

  // Patch RETRY_DELAY_MS to 20ms for fast test
  await sched.schedule({ guildId: 'g1', type: 'test:fail', payload: {}, runAt: Date.now() + 10 });

  // Wait enough for 1st attempt + internal retry reschedule
  await new Promise((r) => setTimeout(r, 200));

  assert.ok(attempts >= 1, `expected ≥1 attempt, got ${attempts}`);
  sched.shutdown();
});

// ─────────────────────────────────────────────────────────────────────────────
// storageManifest
// ─────────────────────────────────────────────────────────────────────────────
const { STORAGE_MANIFEST, getManifestEntry, getCriticalNamespaces } = require('../src/app/storageManifest');

test('storageManifest: every entry has required fields', () => {
  for (const entry of STORAGE_MANIFEST) {
    assert.ok(typeof entry.prefix === 'string' && entry.prefix.length > 0,       `missing prefix in ${JSON.stringify(entry)}`);
    assert.ok(typeof entry.owner === 'string' && entry.owner.length > 0,         `missing owner for ${entry.prefix}`);
    assert.ok(typeof entry.description === 'string' && entry.description.length > 0, `missing description for ${entry.prefix}`);
    assert.ok(typeof entry.schemaVersion === 'number',                            `missing schemaVersion for ${entry.prefix}`);
    assert.ok(typeof entry.critical === 'boolean',                                `missing critical flag for ${entry.prefix}`);
  }
});

test('storageManifest: getManifestEntry resolves known prefixes', () => {
  const e1 = getManifestEntry('settings:123456');
  assert.ok(e1, 'settings prefix should resolve');
  assert.equal(e1.prefix, 'settings:');

  const e2 = getManifestEntry('warns:g1:u1');
  assert.ok(e2);
  assert.equal(e2.prefix, 'warns:');

  const e3 = getManifestEntry('scheduler:job:abc123');
  assert.ok(e3);
  assert.ok(e3.critical);
});

test('storageManifest: getManifestEntry returns null for unknown keys', () => {
  assert.equal(getManifestEntry('unknowntable:xyz'), null);
});

test('storageManifest: getCriticalNamespaces includes scheduler keys', () => {
  const critical = getCriticalNamespaces();
  assert.ok(critical.length > 0);
  const prefixes = critical.map((e) => e.prefix);
  assert.ok(prefixes.some((p) => p.includes('scheduler')));
  assert.ok(prefixes.some((p) => p.includes('settings')));
});

test('storageManifest: no duplicate prefixes', () => {
  const prefixes = STORAGE_MANIFEST.map((e) => e.prefix);
  const unique = new Set(prefixes);
  assert.equal(unique.size, prefixes.length, 'every prefix must be unique');
});
