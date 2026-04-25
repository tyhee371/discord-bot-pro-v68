-- Discord Bot Database Schema
-- Phase 5: PostgreSQL migrations for persistent data

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Guild Settings Table
-- Stores persistent guild configuration
CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id BIGINT PRIMARY KEY,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User Data Table
-- Stores user-specific persistent data
CREATE TABLE IF NOT EXISTS user_data (
    user_id BIGINT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit Log Table
-- Stores moderation actions and bot events
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id BIGINT NOT NULL,
    user_id BIGINT,
    action VARCHAR(100) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    INDEX idx_audit_guild_time (guild_id, timestamp),
    INDEX idx_audit_user (user_id)
);

-- Ticket History Table
-- Stores ticket lifecycle events
CREATE TABLE IF NOT EXISTS ticket_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id VARCHAR(50) NOT NULL,
    guild_id BIGINT NOT NULL,
    channel_id BIGINT,
    creator_id BIGINT NOT NULL,
    assignee_id BIGINT,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    category VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    closed_at TIMESTAMP WITH TIME ZONE,
    transcript TEXT,
    INDEX idx_ticket_guild (guild_id),
    INDEX idx_ticket_creator (creator_id),
    INDEX idx_ticket_status (status)
);

-- Music Statistics Table
-- Stores music playback statistics
CREATE TABLE IF NOT EXISTS music_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    track_url TEXT NOT NULL,
    track_title VARCHAR(500),
    duration_seconds INTEGER,
    played_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    INDEX idx_music_guild (guild_id),
    INDEX idx_music_user (user_id),
    INDEX idx_music_played (played_at)
);

-- Command Usage Table
-- Tracks command usage for analytics
CREATE TABLE IF NOT EXISTS command_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id BIGINT,
    user_id BIGINT NOT NULL,
    command VARCHAR(100) NOT NULL,
    args TEXT,
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT,
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    INDEX idx_command_guild (guild_id),
    INDEX idx_command_user (user_id),
    INDEX idx_command_name (command),
    INDEX idx_command_executed (executed_at)
);

-- Rate Limit Violations Table
-- Tracks rate limit violations for monitoring
CREATE TABLE IF NOT EXISTS rate_limit_violations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identifier VARCHAR(200) NOT NULL,
    action VARCHAR(100) NOT NULL,
    violations INTEGER NOT NULL DEFAULT 1,
    first_violation TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_violation TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    INDEX idx_rate_identifier (identifier),
    INDEX idx_rate_action (action)
);

-- Background Job Status Table
-- Tracks long-running background jobs
CREATE TABLE IF NOT EXISTS background_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_type VARCHAR(100) NOT NULL,
    job_id VARCHAR(200) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    progress JSONB DEFAULT '{}',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    INDEX idx_job_type (job_type),
    INDEX idx_job_status (status)
);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add updated_at triggers
CREATE TRIGGER update_guild_settings_updated_at
    BEFORE UPDATE ON guild_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_data_updated_at
    BEFORE UPDATE ON user_data
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
