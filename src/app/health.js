const http = require('http');
const { logger } = require('../helpers/logger');
const { getHealthStatus, getReadinessStatus } = require('./lifecycle');
const { metrics } = require('../helpers/metrics');
const { buildAnalyticsSnapshot } = require('./analyticsService');
const { runCanaryChecks } = require('./diagnosticsSnapshot');

/**
 * Phase 3: Health Check Endpoints
 * Provides HTTP endpoints for health and readiness probes
 */

class HealthServer {
  constructor(port = 3000) {
    this.port = port;
    this.server = null;
    this.client = null;
  }

  /**
   * Start the health check server
   * @param {Client} client - Discord.js client instance
   */
  start(client) {
    this.client = client;

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.server.listen(this.port, () => {
      logger.info(`[HEALTH] Health check server listening on port ${this.port}`);
    });

    this.server.on('error', (error) => {
      logger.error(`[HEALTH] Health server error: ${error.message}`);
    });
  }

  /**
   * Stop the health check server
   */
  stop() {
    if (this.server) {
      this.server.close(() => {
        logger.info('[HEALTH] Health check server stopped');
      });
    }
  }

  /**
   * Handle HTTP requests
   */
  handleRequest(req, res) {
    const { method, url } = req;

    // Set CORS headers for easier debugging
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    try {
      switch (url) {
        case '/health':
          this.handleHealthCheck(res);
          break;
        case '/ready':
        case '/readiness':
          this.handleReadinessCheck(res);
          break;
        case '/':
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            service: 'discord-bot',
            endpoints: ['/health', '/ready', '/readiness', '/metrics', '/analytics', '/canary'],
            version: 'v68'
          }));
          break;
        case '/metrics':
          this.handleMetrics(res, req);
          break;
        case '/analytics':
          this.handleAnalytics(res);
          break;
        case '/canary':
          this.handleCanary(res);
          break;
        default:
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      logger.error(`[HEALTH] Error handling request: ${error.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  /**
   * Handle /health endpoint - basic health check
   */
  handleHealthCheck(res) {
    const health = getHealthStatus(this.client);

    // Health check always returns 200 if the service is running
    // It provides detailed status information but doesn't fail
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health));
  }

  /**
   * Handle /ready endpoint - readiness check for load balancers
   */
  handleReadinessCheck(res) {
    const readiness = getReadinessStatus(this.client);

    // Readiness check returns 200 if ready, 503 if not ready
    const statusCode = readiness.ready ? 200 : 503;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(readiness));
  }

  /**
   * Handle /metrics endpoint — in-process counters, gauges, and event rates.
   * Returns the current metrics snapshot as JSON.
   */
  async handleCanary(res) {
    try {
      const result = await runCanaryChecks(this.client);
      const statusCode = result.healthy ? 200 : 503;
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result, null, 2));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Canary checks failed' }));
    }
  }

  async handleAnalytics(res) {
    try {
      const snap = await buildAnalyticsSnapshot(this.client);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(snap, null, 2));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to build analytics snapshot' }));
    }
  }

  handleMetrics(res, req) {
    const accept = req?.headers?.accept ?? '';
    const wantsJson = accept.includes('application/json');
    const snapshot = metrics.snapshot();

    if (wantsJson) {
      // JSON format for browser/debug access
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(snapshot, null, 2));
      return;
    }

    // Default: Prometheus text exposition format (v0.0.4)
    // Prometheus scraper does not send Accept headers, so always default to this format.
    const lines = [];
    const ts = Date.now();

    lines.push('# HELP bot_uptime_seconds Seconds since bot process started');
    lines.push('# TYPE bot_uptime_seconds gauge');
    lines.push('bot_uptime_seconds ' + snapshot.uptimeSeconds + ' ' + ts);

    for (const [key, value] of Object.entries(snapshot.counters || {})) {
      const metricName = 'bot_' + key.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push('# TYPE ' + metricName + '_total counter');
      lines.push(metricName + '_total ' + value + ' ' + ts);
    }

    for (const [key, value] of Object.entries(snapshot.gauges || {})) {
      const metricName = 'bot_' + key.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push('# TYPE ' + metricName + ' gauge');
      lines.push(metricName + ' ' + value + ' ' + ts);
    }

    for (const [key, value] of Object.entries(snapshot.rates || {})) {
      const metricName = 'bot_' + key.replace(/[^a-zA-Z0-9_]/g, '_') + '_per_min';
      lines.push('# TYPE ' + metricName + ' gauge');
      lines.push(metricName + ' ' + value + ' ' + ts);
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
    res.end(lines.join('\n') + '\n');
  }
}

module.exports = {
  HealthServer,
};
