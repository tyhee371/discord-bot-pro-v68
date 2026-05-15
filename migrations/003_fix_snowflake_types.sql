-- Migration 003: Fix Discord Snowflake ID column types
-- Discord snowflakes are 64-bit unsigned integers (up to 18446744073709551615).
-- PostgreSQL BIGINT is signed 64-bit (max 9223372036854775807) — too small.
-- VARCHAR(20) handles all current and future Discord snowflakes safely.

-- guild_settings
ALTER TABLE guild_settings
  ALTER COLUMN guild_id TYPE VARCHAR(20);

-- user_data
ALTER TABLE user_data
  ALTER COLUMN user_id TYPE VARCHAR(20);

-- audit_log
ALTER TABLE audit_log
  ALTER COLUMN guild_id TYPE VARCHAR(20),
  ALTER COLUMN user_id TYPE VARCHAR(20);

-- ticket_history
ALTER TABLE ticket_history
  ALTER COLUMN guild_id  TYPE VARCHAR(20),
  ALTER COLUMN channel_id TYPE VARCHAR(20),
  ALTER COLUMN creator_id TYPE VARCHAR(20),
  ALTER COLUMN assignee_id TYPE VARCHAR(20);

-- music_stats
ALTER TABLE music_stats
  ALTER COLUMN guild_id TYPE VARCHAR(20),
  ALTER COLUMN user_id  TYPE VARCHAR(20);

-- command_usage
ALTER TABLE command_usage
  ALTER COLUMN guild_id TYPE VARCHAR(20),
  ALTER COLUMN user_id  TYPE VARCHAR(20);

-- ai_moderation_log
ALTER TABLE ai_moderation_log
  ALTER COLUMN guild_id   TYPE VARCHAR(20),
  ALTER COLUMN channel_id TYPE VARCHAR(20),
  ALTER COLUMN message_id TYPE VARCHAR(20),
  ALTER COLUMN author_id  TYPE VARCHAR(20),
  ALTER COLUMN reviewed_by TYPE VARCHAR(20);

-- rule_engine_log
ALTER TABLE rule_engine_log
  ALTER COLUMN guild_id TYPE VARCHAR(20);
