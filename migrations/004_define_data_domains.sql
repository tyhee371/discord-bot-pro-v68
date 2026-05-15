-- Migration 004: Define single source of truth per data domain
--
-- DATA DOMAIN CONTRACT (enforced from this migration forward):
--
--   SQLite / Keyv  = operational state (guild settings, tickets, rooms, warns,
--                    giveaways, prison timers, sticky messages, prefix store)
--                    Reason: low-latency KV reads on every interaction,
--                    no cross-guild transactions needed.
--
--   PostgreSQL     = analytics & history (audit log, command usage, ticket history,
--                    music stats, moderation log, rule engine log)
--                    Reason: queryable history, complex aggregations, retention.
--
-- The guild_settings table in PostgreSQL was created in migration 001 but is
-- NOT used by application code — stores/settings.js reads/writes Keyv only.
-- Keeping it creates a false impression of a dual-write system and wastes space.
-- Drop it here to enforce the domain contract.

DROP TABLE IF EXISTS guild_settings CASCADE;

-- user_data is similarly unused — operational user data lives in Keyv.
DROP TABLE IF EXISTS user_data CASCADE;

-- Confirm the analytics tables remain intact (belt-and-suspenders comment):
-- audit_log, ticket_history, music_stats, command_usage,
-- ai_moderation_log, rule_engine_log, rate_limit_violations,
-- background_jobs all remain and are the canonical PG tables.
