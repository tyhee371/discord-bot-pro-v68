/*
  Smoke test: require every command/component/event file to catch syntax/import errors.
  Run: npm run smoke
*/
const fs = require('node:fs');
const path = require('node:path');

// Set dummy environment variables for smoke testing
process.env.DISCORD_TOKEN = 'dummy_token_for_smoke_test';
process.env.CLIENT_ID = 'dummy_client_id_for_smoke_test';
process.env.NODE_ENV = 'test';

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function requireAll(label, dir) {
  if (!fs.existsSync(dir)) return;
  const files = walk(dir);
  let ok = 0;
  for (const f of files) {
    try {
      require(f);
      ok++;
    } catch (e) {
      console.error(`[SMOKE] Failed to load ${label}: ${f}`);
      console.error(e);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`[SMOKE] Loaded ${ok} ${label} modules OK.`);
}

const root = path.join(__dirname, '..', 'src');
requireAll('commands', path.join(root, 'commands'));
requireAll('components', path.join(root, 'components'));
requireAll('events', path.join(root, 'events'));
requireAll('handlers', path.join(root, 'handlers'));

if (!process.exitCode) console.log('[SMOKE] All good ✅');
