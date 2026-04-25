/*
  Integration smoke test: Test bot functionality against running instance.
  Run: npm run smoke-test
*/

// Set dummy environment variables for testing
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'dummy_token_for_smoke_test';
process.env.CLIENT_ID = process.env.CLIENT_ID || 'dummy_client_id_for_smoke_test';
process.env.NODE_ENV = 'test';

const http = require('http');

const BASE_URL = process.env.SMOKE_TEST_URL || 'http://localhost:3000';

/**
 * Make HTTP request to health endpoint
 */
function checkHealth() {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE_URL}/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const health = JSON.parse(data);
          if (res.statusCode === 200 && health.status === 'ok') {
            resolve(health);
          } else {
            reject(new Error(`Health check failed: ${res.statusCode} - ${data}`));
          }
        } catch (error) {
          reject(new Error(`Invalid health response: ${error.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Health check timeout'));
    });
  });
}

/**
 * Check readiness endpoint
 */
function checkReadiness() {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE_URL}/ready`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const readiness = JSON.parse(data);
          if (res.statusCode === 200 && readiness.ready) {
            resolve(readiness);
          } else if (res.statusCode === 503) {
            reject(new Error(`Bot not ready: ${data}`));
          } else {
            reject(new Error(`Readiness check failed: ${res.statusCode} - ${data}`));
          }
        } catch (error) {
          reject(new Error(`Invalid readiness response: ${error.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Readiness check timeout'));
    });
  });
}

/**
 * Test basic functionality
 */
async function runSmokeTests() {
  console.log('[SMOKE-TEST] Starting integration smoke tests...');

  try {
    // Test 1: Health check
    console.log('[SMOKE-TEST] Testing health endpoint...');
    const health = await checkHealth();
    console.log(`[SMOKE-TEST] ✅ Health check passed - Uptime: ${health.uptimeSeconds}s`);

    // Test 2: Readiness check
    console.log('[SMOKE-TEST] Testing readiness endpoint...');
    const readiness = await checkReadiness();
    console.log(`[SMOKE-TEST] ✅ Readiness check passed - Guilds: ${readiness.discord?.guilds || 0}`);

    // Test 3: Basic metrics validation
    if (health.memory && typeof health.memory.rss === 'number') {
      console.log(`[SMOKE-TEST] ✅ Memory metrics available - RSS: ${health.memory.rss}MB`);
    } else {
      throw new Error('Memory metrics not available');
    }

    // Test 4: Active operations check
    if (typeof health.activeOperations === 'number') {
      console.log(`[SMOKE-TEST] ✅ Active operations tracking - Count: ${health.activeOperations}`);
    } else {
      throw new Error('Active operations tracking not working');
    }

    console.log('[SMOKE-TEST] All smoke tests passed! 🎉');

  } catch (error) {
    console.error(`[SMOKE-TEST] ❌ Smoke test failed: ${error.message}`);
    process.exit(1);
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  runSmokeTests();
}

module.exports = {
  checkHealth,
  checkReadiness,
  runSmokeTests,
};
