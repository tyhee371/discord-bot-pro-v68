const http = require('http');
const { logger } = require('../utils/logger');
const { getHealthStatus, getReadinessStatus } = require('./lifecycle');

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
            endpoints: ['/health', '/ready', '/readiness'],
            version: 'v68'
          }));
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
}

module.exports = {
  HealthServer,
};
