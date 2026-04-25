/*
  Voice / DAVE dependency doctor (CLI)
  - Prints @discordjs/voice dependency report
  - Verifies @snazzah/davey can actually be required (this fails if npm optional deps were omitted)

  Run:
    npm run doctor
*/

const { generateDependencyReport } = require('@discordjs/voice');

console.log('=== @discordjs/voice dependency report ===');
try {
  console.log(generateDependencyReport());
} catch (e) {
  console.error('Failed to generate dependency report:', e);
}

console.log('\n=== DAVEY load test ===');
try {
  require('@snazzah/davey');
  console.log('OK: @snazzah/davey loaded successfully.');
} catch (e) {
  console.error('FAIL: @snazzah/davey failed to load.');
  console.error('Original error:', e);

  console.error('\nFix (Windows / PowerShell):');
  console.error('  Remove-Item -Recurse -Force .\\node_modules -ErrorAction SilentlyContinue');
  console.error('  Remove-Item -Force .\\package-lock.json -ErrorAction SilentlyContinue');
  console.error('  npm install --include=optional --legacy-peer-deps');
}
