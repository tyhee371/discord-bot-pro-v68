const { Pool } = require('pg');
const { logger } = require('../helpers/logger');

/**
 * Phase 5: PostgreSQL Database Client
 * Provides persistent data storage for operational data
 */

/**
 * DATA DOMAIN CONTRACT
 * ====================
 * PostgreSQL (this file) = analytics & history only:
 *   audit_log, ticket_history, music_stats, command_usage,
 *   ai_moderation_log, rule_engine_log, rate_limit_violations, background_jobs
 *
 * SQLite/Keyv (src/db.js) = operational state:
 *   guild settings, tickets, rooms, warns, giveaways, prison timers, sticky messages
 *
 * Do NOT add guild_settings or user_data queries here — those live in Keyv.
 */
class DatabaseClient {
  constructor() {
    this.pool = null;
    this.isConnected = false;
  }

  /**
   * Initialize database connection
   */
  async connect() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      logger.info('[DATABASE] DATABASE_URL not set — skipping PostgreSQL connection. Phase 5 analytics disabled.');
      return;
    }

    // Retry up to 3 times with a delay — on Windows/Docker the port is reachable
    // but pg's IPv6-first resolution can cause the first attempt to time out.
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this._tryConnect(connectionString);
        if (this.isConnected) return;
      } catch (err) {
        const msg = err.message || err.errors?.[0]?.message || String(err);
        if (attempt < MAX_RETRIES) {
          logger.warn(`[DATABASE] Connect attempt ${attempt}/${MAX_RETRIES} failed: ${msg} — retrying in 3s`);
          await new Promise(r => setTimeout(r, 3000));
        } else {
          logger.warn(`[DATABASE] Could not connect to PostgreSQL after ${MAX_RETRIES} attempts: ${msg}. Phase 5 analytics disabled — bot will continue with SQLite.`);
          await this.pool?.end().catch(() => {});
          this.pool = null;
        }
      }
    }
  }

  async _tryConnect(connectionString) {
    try {
      // Parse the connection string to extract host, then resolve it to an
      // explicit IPv4 address. On Windows + Docker Desktop, pg's default DNS
      // resolution tries IPv6 first (::1) which Docker doesn't forward,
      // causing every connection to time out before the IPv4 fallback.
      const { hostname } = new URL(connectionString.replace(/^postgresql/, 'http'));
      let resolvedHost = hostname;
      try {
        const dns = require('node:dns').promises;
        // Use lookup() not resolve4() — on Windows, resolve4() queries the DNS server
        // directly (which Docker doesn't support for host.docker.internal), while
        // lookup() uses the OS hosts file where Docker Desktop registers the entry.
        const result = await dns.lookup(hostname, { family: 4 });
        if (result?.address) {
          resolvedHost = result.address;
          logger.info(`[DATABASE] Resolved ${hostname} → ${resolvedHost} (IPv4 forced)`);
        }
      } catch (_) {
        // hostname is already an IP or lookup failed — use as-is
      }

      // Use URL object to replace hostname safely — avoid naive string.replace()
      // which would corrupt 'postgresql://...' when hostname is 'postgres'
      // (it would replace the 'postgres' in 'postgresql' too).
      const urlObj = new URL(connectionString.replace(/^postgresql/, 'http'));
      urlObj.hostname = resolvedHost;
      const resolvedUrl = urlObj.toString().replace(/^http/, 'postgresql');

      this.pool = new Pool({
        connectionString: resolvedUrl,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 15000,
        // statement_timeout kills any query that hangs longer than 10s.
        // Without this, one slow query holds a pool connection for up to 15s.
        // With max:20 connections, 20 simultaneous slow queries deadlock the pool.
        options: '--statement_timeout=10000',
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: process.env.PG_REJECT_UNAUTHORIZED !== 'false' } : false,
      });

      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      this.isConnected = true;
      logger.info('[DATABASE] PostgreSQL connected successfully');

      // Handle pool events
      this.pool.on('error', (err) => {
        logger.error(`[DATABASE] Unexpected pool error: ${err.message}`);
        this.isConnected = false;
      });

      this.pool.on('connect', () => {
        logger.debug('[DATABASE] New client connected to pool');
      });

      this.pool.on('remove', () => {
        logger.debug('[DATABASE] Client removed from pool');
      });

    } catch (error) {
      await this.pool?.end().catch(() => {});
      this.pool = null;
      throw error;
    }
  }

  /**
   * Check if database is available
   */
  isAvailable() {
    return this.pool && this.isConnected;
  }

  /**
   * Execute a query
   */
  async query(text, params = []) {
    if (!this.isAvailable()) {
      throw new Error('Database not connected');
    }

    const start = Date.now();
    try {
      const res = await this.pool.query(text, params);
      const duration = Date.now() - start;
      logger.debug(`[DATABASE] Query executed in ${duration}ms: ${text.substring(0, 100)}...`);
      return res;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error(`[DATABASE] Query failed after ${duration}ms: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute a transaction
   */
  async transaction(callback) {
    if (!this.isAvailable()) {
      throw new Error('Database not connected');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get user data
   */
  async getUserData(userId) {
    try {
      const result = await this.query(
        'SELECT data FROM user_data WHERE user_id = $1',
        [userId]
      );
      return result.rows[0]?.data || {};
    } catch (error) {
      logger.warn(`[DATABASE] Failed to get user data for ${userId}: ${error.message}`);
      return {};
    }
  }

  /**
   * Save user data
   */
  async saveUserData(userId, data) {
    try {
      await this.query(
        `INSERT INTO user_data (user_id, data)
         VALUES ($1, $2)
         ON CONFLICT (user_id)
         DO UPDATE SET data = $2, updated_at = NOW()`,
        [userId, JSON.stringify(data)]
      );
      return true;
    } catch (error) {
      logger.warn(`[DATABASE] Failed to save user data for ${userId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Log audit event
   */
  async logAuditEvent(guildId, userId, action, details = {}) {
    try {
      await this.query(
        'INSERT INTO audit_log (guild_id, user_id, action, details) VALUES ($1, $2, $3, $4)',
        [guildId, userId, action, JSON.stringify(details)]
      );
      return true;
    } catch (error) {
      logger.warn(`[DATABASE] Failed to log audit event: ${error.message}`);
      return false;
    }
  }

  /**
   * Log command usage
   */
  async logCommandUsage(guildId, userId, command, args = null, success = true, errorMessage = null) {
    try {
      await this.query(
        `INSERT INTO command_usage
         (guild_id, user_id, command, args, success, error_message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [guildId, userId, command, args, success, errorMessage]
      );
      return true;
    } catch (error) {
      logger.warn(`[DATABASE] Failed to log command usage: ${error.message}`);
      return false;
    }
  }

  /**
   * Log music playback
   */
  async logMusicPlayback(guildId, userId, trackUrl, trackTitle = null, durationSeconds = null) {
    try {
      await this.query(
        `INSERT INTO music_stats
         (guild_id, user_id, track_url, track_title, duration_seconds)
         VALUES ($1, $2, $3, $4, $5)`,
        [guildId, userId, trackUrl, trackTitle, durationSeconds]
      );
      return true;
    } catch (error) {
      logger.warn(`[DATABASE] Failed to log music playback: ${error.message}`);
      return false;
    }
  }

  /**
   * Create ticket record
   */
  async createTicket(ticketId, guildId, channelId, creatorId, category = null) {
    try {
      await this.query(
        `INSERT INTO ticket_history
         (ticket_id, guild_id, channel_id, creator_id, category)
         VALUES ($1, $2, $3, $4, $5)`,
        [ticketId, guildId, channelId, creatorId, category]
      );
      return true;
    } catch (error) {
      logger.warn(`[DATABASE] Failed to create ticket record: ${error.message}`);
      return false;
    }
  }

  /**
   * Update ticket status
   */
  async updateTicketStatus(ticketId, status, assigneeId = null, transcript = null) {
    try {
      const updates = [];
      const params = [ticketId];
      let paramCount = 1;

      if (assigneeId !== undefined) {
        updates.push(`assignee_id = $${++paramCount}`);
        params.push(assigneeId);
      }

      if (status) {
        updates.push(`status = $${++paramCount}`);
        params.push(status);
      }

      if (status === 'closed') {
        updates.push('closed_at = NOW()');
      }

      if (transcript) {
        updates.push(`transcript = $${++paramCount}`);
        params.push(transcript);
      }

      if (updates.length > 0) {
        const query = `UPDATE ticket_history SET ${updates.join(', ')} WHERE ticket_id = $1`;
        await this.query(query, params);
      }

      return true;
    } catch (error) {
      logger.warn(`[DATABASE] Failed to update ticket status: ${error.message}`);
      return false;
    }
  }

  /**
   * Get database statistics
   */
  async getStats() {
    try {
      const results = await Promise.all([
        this.query('SELECT COUNT(*) as guilds FROM guild_settings'),
        this.query('SELECT COUNT(*) as users FROM user_data'),
        this.query('SELECT COUNT(*) as audit_events FROM audit_log'),
        this.query('SELECT COUNT(*) as commands FROM command_usage'),
        this.query('SELECT COUNT(*) as tracks FROM music_stats'),
        this.query('SELECT COUNT(*) as tickets FROM ticket_history'),
      ]);

      return {
        guilds: parseInt(results[0].rows[0].guilds),
        users: parseInt(results[1].rows[0].users),
        auditEvents: parseInt(results[2].rows[0].audit_events),
        commands: parseInt(results[3].rows[0].commands),
        tracks: parseInt(results[4].rows[0].tracks),
        tickets: parseInt(results[5].rows[0].tickets),
      };
    } catch (error) {
      logger.warn(`[DATABASE] Failed to get stats: ${error.message}`);
      return null;
    }
  }

  /**
   * Close database connection
   */
  async disconnect() {
    if (this.pool) {
      try {
        await this.pool.end();
        logger.info('[DATABASE] PostgreSQL connection closed');
      } catch (error) {
        logger.warn(`[DATABASE] Error closing database connection: ${error.message}`);
      }
    }
    this.isConnected = false;
  }
}

// Global database client instance
const databaseClient = new DatabaseClient();

module.exports = {
  DatabaseClient,
  databaseClient,
};
