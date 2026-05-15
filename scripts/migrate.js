#!/usr/bin/env node
/**
 * scripts/migrate.js — PostgreSQL migration runner (Phase 4)
 *
 * Replaces running 001_initial_schema.sql by hand.  Each file in migrations/
 * is a numbered SQL file (001_..., 002_..., etc.).  The runner tracks which
 * files have been applied in a _migrations table and only runs new ones.
 *
 * Usage:
 *   node scripts/migrate.js           # run pending migrations
 *   node scripts/migrate.js --status  # list applied/pending migrations
 *   node scripts/migrate.js --dry-run # show pending SQL without executing
 *
 * Requires DATABASE_URL in environment (or .env file).
 *
 * This is intentionally simple — no framework dependency.  If you need
 * rollbacks, timestamps, or team-wide tooling, swap this for node-pg-migrate
 * or db-migrate.
 */

const fs   = require('node:fs');
const path = require('node:path');

// Load .env manually — no dotenv dependency needed (Node 22+ has --env-file,
// but scripts run directly with `node scripts/migrate.js` so we parse it here).
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[migrate] DATABASE_URL is not set. Skipping migration (SQLite mode).');
  process.exit(0);
}

// Pool is created inside main() after IPv4 DNS resolution

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');
const DRY_RUN  = process.argv.includes('--dry-run');
const STATUS   = process.argv.includes('--status');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         SERIAL PRIMARY KEY,
      filename   VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
}

async function getApplied(client) {
  const { rows } = await client.query('SELECT filename FROM _migrations ORDER BY id');
  return new Set(rows.map(r => r.filename));
}

function getMigrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d+.*\.sql$/.test(f))
    .sort();
}

async function autoMarkIfAlreadyApplied(client, applied, files) {
  // If the schema was auto-applied by Docker's /docker-entrypoint-initdb.d
  // mechanism, the _migrations table will be empty but tables already exist.
  // Detect this by checking for a known table and mark files as applied.
  if (applied.size > 0) return; // already has records — nothing to do
  try {
    const { rows } = await client.query(
      `SELECT to_regclass('public.guild_settings') AS t`
    );
    if (!rows[0]?.t) return; // tables don't exist — normal first run
    console.log('[migrate] Schema already exists (applied via Docker initdb). Marking migrations as applied...');
    for (const filename of files) {
      await client.query(
        'INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
        [filename]
      );
      console.log(`  ✓ Marked: ${filename}`);
    }
  } catch (_) {
    // ignore — just proceed normally
  }
}

async function main() {
  // Resolve DATABASE_URL hostname to IPv4 before creating the pool.
  // Pool must be created AFTER resolution — updating pool.options after
  // creation has no effect on already-queued connections.
  const { hostname } = new URL(DATABASE_URL.replace(/^postgresql/, 'http'));
  let resolvedUrl = DATABASE_URL;
  try {
    const dns = require('node:dns').promises;
    const result = await dns.lookup(hostname, { family: 4 });
    if (result?.address) {
      // Use URL object to replace hostname safely — naive string.replace()
      // corrupts 'postgresql://...' when hostname is 'postgres' because
      // 'postgres' appears inside 'postgresql' and gets replaced there too.
      const urlObj = new URL(DATABASE_URL.replace(/^postgresql/, 'http'));
      urlObj.hostname = result.address;
      resolvedUrl = urlObj.toString().replace(/^http/, 'postgresql');
      console.log(`[migrate] Resolved ${hostname} → ${result.address}`);
    }
  } catch (_) {}

  const pool = new Pool({
    connectionString: resolvedUrl,
    connectionTimeoutMillis: 10000,
    // Explicitly disable SSL for local/dev — pg defaults to attempting TLS
    // which Docker Postgres rejects with "Connection terminated unexpectedly"
    ssl: false,
  });

  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied  = await getApplied(client);
    const allFiles = getMigrationFiles();
    await autoMarkIfAlreadyApplied(client, applied, allFiles);
    const freshApplied = await getApplied(client);
    const pending  = allFiles.filter(f => !freshApplied.has(f));

    if (STATUS) {
      console.log('\n── Migration status ──────────────────────────────────');
      for (const f of allFiles) {
        console.log(`  ${freshApplied.has(f) ? '✓' : '○'} ${f}`);
      }
      console.log(`\n${freshApplied.size} applied, ${pending.length} pending\n`);
      return;
    }

    if (pending.length === 0) {
      console.log('[migrate] No pending migrations.');
      return;
    }

    console.log(`[migrate] ${pending.length} pending migration(s):`);
    for (const filename of pending) {
      const filepath = path.join(MIGRATIONS_DIR, filename);
      const sql = fs.readFileSync(filepath, 'utf8');

      console.log(`  → ${filename}`);

      if (DRY_RUN) {
        console.log('    [dry-run] SQL:\n', sql.slice(0, 200), sql.length > 200 ? '...' : '');
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO _migrations (filename) VALUES ($1)',
          [filename]
        );
        await client.query('COMMIT');
        console.log(`    ✓ Applied`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`    ✗ Failed: ${err.message}`);
        process.exit(1);
      }
    }

    if (!DRY_RUN) {
      console.log(`[migrate] Done — ${pending.length} migration(s) applied.`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

// Retry wrapper — PostgreSQL healthcheck passes before it fully accepts
// connections. Retry up to 5 times with a 3-second delay between attempts.
(async () => {
  const MAX = 5;
  for (let i = 1; i <= MAX; i++) {
    try {
      await main();
      return;
    } catch (err) {
      const msg = err.message || err.errors?.[0]?.message || String(err);
      if (i < MAX) {
        console.error(`[migrate] Attempt ${i}/${MAX} failed: ${msg} — retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
      } else {
        console.error('[migrate] Fatal:', msg);
        if (err.errors?.length) {
          for (const e of err.errors) console.error('  →', e.message ?? e);
        }
        process.exit(1);
      }
    }
  }
})();
