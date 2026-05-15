-- Phase 5: AI Moderation audit log
-- Stores every flag raised by aiModeration.js for staff review and model tuning.

CREATE TABLE IF NOT EXISTS ai_moderation_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id        BIGINT NOT NULL,
    channel_id      BIGINT,
    message_id      BIGINT,
    author_id       BIGINT NOT NULL,
    flagged         BOOLEAN NOT NULL DEFAULT false,
    category        VARCHAR(50),
    confidence      NUMERIC(4, 3),        -- 0.000 – 1.000
    reason          TEXT,
    source          VARCHAR(10) NOT NULL DEFAULT 'rules',  -- 'ai' | 'rules'
    content_hash    VARCHAR(64),          -- SHA-256 of message content (not stored raw)
    staff_reviewed  BOOLEAN NOT NULL DEFAULT false,
    staff_action    VARCHAR(50),          -- 'dismissed' | 'warned' | 'timeout' | 'ban'
    reviewed_by     BIGINT,
    reviewed_at     TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aimod_guild       ON ai_moderation_log (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aimod_author      ON ai_moderation_log (author_id);
CREATE INDEX IF NOT EXISTS idx_aimod_flagged     ON ai_moderation_log (flagged, staff_reviewed);
CREATE INDEX IF NOT EXISTS idx_aimod_category    ON ai_moderation_log (category);

-- Phase 5: Rule engine execution log (for debugging + audit)
CREATE TABLE IF NOT EXISTS rule_engine_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id        BIGINT NOT NULL,
    rule_id         VARCHAR(100) NOT NULL,
    rule_name       VARCHAR(255),
    trigger         VARCHAR(50) NOT NULL,
    conditions_met  BOOLEAN NOT NULL DEFAULT true,
    actions_fired   INTEGER NOT NULL DEFAULT 0,
    context_summary JSONB DEFAULT '{}',
    fired_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rulelog_guild ON rule_engine_log (guild_id, fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_rulelog_rule  ON rule_engine_log (rule_id);
