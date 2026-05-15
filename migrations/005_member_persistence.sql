-- Migration 005: Member Persistence feature flag
--
-- The actual member data (roles + nickname) is stored in Keyv (SQLite)
-- under keys "memberPersist:<guildId>:<userId>", consistent with the
-- data domain contract (operational state lives in Keyv, not PostgreSQL).
--
-- This migration is intentionally a no-op SQL migration — it exists only
-- to document the new Keyv key namespace and to record that the feature
-- ships with a guild-level opt-in flag inside guild_settings (Keyv):
--
--   settings.memberPersistence = {
--     restoreRoles:    boolean  (default: false)
--     restoreNickname: boolean  (default: false)
--   }
--
-- No PostgreSQL schema changes are required.
-- The guild settings schema migration is handled in-process by
-- stores/settings.js (see migrateSettings / CURRENT_SCHEMA_VERSION bump).

SELECT 1; -- placeholder so the migration runner does not error on an empty file
