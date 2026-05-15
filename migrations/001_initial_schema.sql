-- Discord Bot Database Schema
-- PostgreSQL-compatible migration

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Guild Settings
CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id BIGINT PRIMARY KEY,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User Data
CREATE TABLE IF NOT EXISTS user_data (
    user_id BIGINT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id BIGINT NOT NULL,
    user_id BIGINT,
    action VARCHAR(100) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_guild_time ON audit_log (guild_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log (user_id);

-- Ticket History
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
    transcript TEXT
);
CREATE INDEX IF NOT EXISTS idx_ticket_guild ON ticket_history (guild_id);
CREATE INDEX IF NOT EXISTS idx_ticket_creator ON ticket_history (creator_id);
CREATE INDEX IF NOT EXISTS idx_ticket_status ON ticket_history (status);

-- Music Statistics
CREATE TABLE IF NOT EXISTS music_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    track_url TEXT NOT NULL,
    track_title VARCHAR(500),
    duration_seconds INTEGER,
    played_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_music_guild ON music_stats (guild_id);
CREATE INDEX IF NOT EXISTS idx_music_user ON music_stats (user_id);
CREATE INDEX IF NOT EXISTS idx_music_played ON music_stats (played_at);

-- Command Usage
CREATE TABLE IF NOT EXISTS command_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id BIGINT,
    user_id BIGINT NOT NULL,
    command VARCHAR(100) NOT NULL,
    args TEXT,
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT,
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_command_guild ON command_usage (guild_id);
CREATE INDEX IF NOT EXISTS idx_command_user ON command_usage (user_id);
CREATE INDEX IF NOT EXISTS idx_command_name ON command_usage (command);
CREATE INDEX IF NOT EXISTS idx_command_executed ON command_usage (executed_at);

-- Rate Limit Violations
CREATE TABLE IF NOT EXISTS rate_limit_violations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identifier VARCHAR(200) NOT NULL,
    action VARCHAR(100) NOT NULL,
    violations INTEGER NOT NULL DEFAULT 1,
    first_violation TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_violation TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_identifier ON rate_limit_violations (identifier);
CREATE INDEX IF NOT EXISTS idx_rate_action ON rate_limit_violations (action);

-- Background Jobs
CREATE TABLE IF NOT EXISTS background_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_type VARCHAR(100) NOT NULL,
    job_id VARCHAR(200) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    progress JSONB DEFAULT '{}',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_type ON background_jobs (job_type);
CREATE INDEX IF NOT EXISTS idx_job_status ON background_jobs (status);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_guild_settings_updated_at ON guild_settings;
CREATE TRIGGER update_guild_settings_updated_at
    BEFORE UPDATE ON guild_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_data_updated_at ON user_data;
CREATE TRIGGER update_user_data_updated_at
    BEFORE UPDATE ON user_data
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
