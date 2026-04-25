const { Pool } = require('pg');
const { logger } = require('../utils/logger');

/**
 * Phase 5: PostgreSQL Database Client
 * Provides persistent data storage for operational data
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
    try {
      const connectionString = process.env.DATABASE_URL || 'postgresql://bot_user:bot_password@localhost:5432/bot_db';

      this.pool = new Pool({
        connectionString,
        max: 20, // Maximum number of clients in the pool
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
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
      logger.error(`[DATABASE] Failed to connect to PostgreSQL: ${error.message}`);
      // Don't throw - allow fallback to file-based storage
      this.pool = null;
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
   * Get guild settings
   */
  async getGuildSettings(guildId) {
    try {
      const result = await this.query(
        'SELECT settings FROM guild_settings WHERE guild_id = $1',
        [guildId]
      );
      return result.rows[0]?.settings || {};
    } catch (error) {
      logger.warn(`[DATABASE] Failed to get guild settings for ${guildId}: ${error.message}`);
      return {};
    }
  }

  /**
   * Save guild settings
   */
  async saveGuildSettings(guildId, settings) {
    try {
      await this.query(
        `INSERT INTO guild_settings (guild_id, settings)
         VALUES ($1, $2)
         ON CONFLICT (guild_id)
         DO UPDATE SET settings = $2, updated_at = NOW()`,
        [guildId, JSON.stringify(settings)]
      );
      return true;
    } catch (error) {
      logger.warn(`[DATABASE] Failed to save guild settings for ${guildId}: ${error.message}`);
      return false;
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
