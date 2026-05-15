/**
 * aiModeration.js — AI-assisted message screening with strict policy guardrails.
 *
 * Uses the bot's own internal rule-based pipeline as the primary check.
 * Optional Anthropic Claude API integration for nuanced cases when configured.
 *
 * GUARDRAILS (non-negotiable — never bypassed):
 *   - AI output is advisory only; no auto-bans without human confirmation
 *   - Confidence threshold gates: low-confidence = flag, never auto-act
 *   - Staff can always override any AI decision
 *   - All AI decisions are logged with full context for audit
 *   - AI is never shown user PII beyond message content + guild context
 *   - Rate-limited per guild to prevent abuse of the API budget
 *
 * Environment:
 *   AI_MODERATION_ENABLED=true          Enable AI screening (default: false)
 *   AI_MODERATION_API_KEY=sk-ant-...    Anthropic API key
 *   AI_MODERATION_MODEL=claude-haiku-4-5-20251001  Model to use (default: haiku for cost)
 *   AI_MODERATION_CONFIDENCE=0.75       Min confidence to flag (0–1, default 0.75)
 */

const { logger } = require('../utils/logger');
const { metrics } = require('../utils/metrics');
const { AsyncLock } = require('../utils/asyncLock');

const ENABLED       = process.env.AI_MODERATION_ENABLED === 'true';
const API_KEY       = process.env.AI_MODERATION_API_KEY ?? '';
const MODEL         = process.env.AI_MODERATION_MODEL ?? 'claude-haiku-4-5-20251001';
const MIN_CONF      = parseFloat(process.env.AI_MODERATION_CONFIDENCE ?? '0.75');
const RATE_LIMIT_MS = 2000;   // min ms between API calls per guild

const _lastCall  = new Map();  // guildId → lastCallTs
const _rateLock  = new AsyncLock();

// ── Violation categories with human-readable labels ──────────────────────────

const CATEGORIES = {
  hate_speech:     'Hate speech / slurs',
  harassment:      'Targeted harassment',
  self_harm:       'Self-harm promotion',
  dangerous_info:  'Dangerous information',
  spam:            'Spam / flooding',
  nsfw:            'NSFW content',
  doxxing:         'Personal information / doxxing',
};

/**
 * ScreenResult shape:
 *   { flagged: boolean, category: string|null, confidence: number,
 *     reason: string, advisory: boolean, source: 'rules'|'ai'|'disabled' }
 */

// ── Rule-based fast-path (no API call) ───────────────────────────────────────

const SPAM_REGEX   = /(.)\1{9,}|https?:\/\/\S+(\s+https?:\/\/\S+){3,}/i;
const INVITE_REGEX = /discord\.gg\/\S+|discord\.com\/invite\/\S+/i;

function ruleBasedScreen(content, guildConfig = {}) {
  if (!content || typeof content !== 'string') return null;
  const txt = content.toLowerCase();

  if (SPAM_REGEX.test(content))   return { flagged: true, category: 'spam',     confidence: 0.95, reason: 'Spam pattern detected (repeated chars or multiple URLs)' };
  if (guildConfig.blockInvites && INVITE_REGEX.test(content)) {
    return { flagged: true, category: 'spam', confidence: 0.99, reason: 'Discord invite link posted' };
  }
  if (content.length > 3000 && content.split('\n').length > 80) {
    return { flagged: true, category: 'spam', confidence: 0.85, reason: 'Extremely long message (possible flood)' };
  }

  return null;  // no rules matched
}

// ── Anthropic API call ────────────────────────────────────────────────────────

async function callAiScreen(content, guildId) {
  // Rate-gate per guild
  const now = Date.now();
  const last = _lastCall.get(guildId) ?? 0;
  if (now - last < RATE_LIMIT_MS) return null;  // skip, too soon
  _lastCall.set(guildId, now);

  const prompt = `You are a content moderation assistant. Analyse the following Discord message and respond ONLY with a JSON object — no markdown, no preamble.

Categories to check: ${Object.entries(CATEGORIES).map(([k, v]) => `${k} (${v})`).join(', ')}.

Respond with:
{"flagged": true/false, "category": "<category_key or null>", "confidence": <0.0–1.0>, "reason": "<one sentence>"}

If unsure, set confidence below 0.75 and flagged to false.

Message:
"""
${content.slice(0, 800)}
"""`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 200,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AI moderation API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text ?? '';

  try {
    return JSON.parse(text.trim());
  } catch {
    logger.warn({ text }, '[aiMod] Failed to parse AI response JSON');
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Screen a message for policy violations.
 *
 * @param {string}  content          Raw message content
 * @param {string}  guildId          For rate-limiting and logging
 * @param {object}  [guildConfig]    Per-guild AI moderation settings from settings.aiMod
 * @returns {Promise<ScreenResult>}
 */
async function screenMessage(content, guildId, guildConfig = {}) {
  // 0. Fast path: AI disabled entirely
  if (!ENABLED || !API_KEY) {
    const ruleResult = ruleBasedScreen(content, guildConfig);
    if (ruleResult) {
      metrics.increment('ai_mod.rules.flagged');
      return { ...ruleResult, advisory: true, source: 'rules' };
    }
    return { flagged: false, category: null, confidence: 0, reason: '', advisory: true, source: 'disabled' };
  }

  // 1. Rule-based fast-path — if a rule fires at high confidence, skip API
  const ruleResult = ruleBasedScreen(content, guildConfig);
  if (ruleResult && ruleResult.confidence >= 0.9) {
    metrics.increment('ai_mod.rules.flagged');
    return { ...ruleResult, advisory: true, source: 'rules' };
  }

  // 2. AI screening
  try {
    metrics.rate('ai_mod.api.calls');
    const aiResult = await callAiScreen(content, guildId);
    if (!aiResult) {
      // Rate-limited or parse failure — fall back to rule result if any
      if (ruleResult) return { ...ruleResult, advisory: true, source: 'rules' };
      return { flagged: false, category: null, confidence: 0, reason: '', advisory: true, source: 'ai' };
    }

    const flagged    = Boolean(aiResult.flagged) && (aiResult.confidence ?? 0) >= MIN_CONF;
    const confidence = Math.min(1, Math.max(0, Number(aiResult.confidence) || 0));

    metrics.increment(flagged ? 'ai_mod.ai.flagged' : 'ai_mod.ai.cleared');

    return {
      flagged,
      category:   flagged ? (aiResult.category ?? null) : null,
      confidence,
      reason:     String(aiResult.reason ?? '').slice(0, 300),
      advisory:   true,   // GUARDRAIL: always advisory — staff must confirm action
      source:     'ai',
    };
  } catch (err) {
    logger.warn({ err, guildId }, '[aiMod] API call failed — falling back to rule-based');
    metrics.increment('ai_mod.api.errors');
    if (ruleResult) return { ...ruleResult, advisory: true, source: 'rules' };
    return { flagged: false, category: null, confidence: 0, reason: '', advisory: true, source: 'ai' };
  }
}

/**
 * Build a Discord-ready flag alert embed for staff.
 * @param {object} result  ScreenResult
 * @param {object} message Discord message object
 */
function buildFlagEmbed(result, message) {
  const { EmbedBuilder } = require('discord.js');
  const label = result.category ? (CATEGORIES[result.category] ?? result.category) : 'Unknown';
  const pct   = Math.round(result.confidence * 100);
  const src   = result.source === 'ai' ? '🤖 AI' : '📋 Rules';

  return new EmbedBuilder()
    .setTitle('🚩 Content Flag — Advisory')
    .setColor(0xf97316)
    .setDescription(
      `A message was flagged for review by ${src}.\n` +
      `> ⚠️ This is **advisory only** — no action has been taken automatically.`,
    )
    .addFields(
      { name: '👤 Author',     value: `${message.author?.tag ?? 'unknown'} (<@${message.author?.id}>)`, inline: true },
      { name: '📍 Channel',    value: `<#${message.channelId}>`, inline: true },
      { name: '🏷️ Category',   value: label, inline: true },
      { name: '📊 Confidence', value: `**${pct}%** (source: ${src})`, inline: true },
      { name: '💬 Reason',     value: result.reason || 'No reason provided.', inline: false },
      { name: '📝 Content',    value: ('```\n' + (message.content ?? '').slice(0, 900) + '\n```'), inline: false },
    )
    .setFooter({ text: `Message ID: ${message.id} • Staff action required to act on this flag` })
    .setTimestamp();
}

module.exports = { screenMessage, buildFlagEmbed, ruleBasedScreen, CATEGORIES };
