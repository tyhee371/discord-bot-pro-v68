/**
 * ruleEngine.js — configurable per-guild automation rule engine.
 *
 * Each guild can define rules stored in settings.rules[]. A rule has:
 *   { id, name, enabled, trigger, conditions[], actions[], cooldownSeconds }
 *
 * Triggers:    'message' | 'member_join' | 'member_leave' | 'reaction_add'
 * Conditions:  content_matches, author_is_bot, author_has_role, author_missing_role,
 *              channel_is, member_account_age_lt, member_has_no_roles
 * Actions:     send_message, add_role, remove_role, timeout_member,
 *              delete_message, create_mod_case, send_dm
 *
 * Guardrails:
 *   - Max 20 rules per guild
 *   - Max 5 actions per rule
 *   - Timeout action capped at 1 hour without ManageGuild
 *   - No rule can ban or kick (use /ban /kick directly — audit trail required)
 *   - Per-rule cooldown prevents spam loops
 *   - All rule firings are logged to metrics
 */

const { logger } = require('../utils/logger');
const { metrics } = require('../utils/metrics');
const { getGuildSettings } = require('../stores/settings');
const { AsyncLock } = require('../helpers/asyncLock');
const { createCase } = require('../stores/modCases');

const MAX_RULES   = 20;
const MAX_ACTIONS = 5;
const MAX_TIMEOUT_SEC_WITHOUT_MANAGE = 3600;  // 1 hour

const _cooldowns = new Map();   // `${guildId}:${ruleId}` → expiresAt
const _lock = new AsyncLock();

// ── Condition evaluators ──────────────────────────────────────────────────────

const conditionEvaluators = {
  content_matches(ctx, params) {
    const content = ctx.message?.content ?? '';
    const pattern = params.pattern ?? '';
    if (params.regex) {
      try { return new RegExp(pattern, 'i').test(content); } catch { return false; }
    }
    return content.toLowerCase().includes(pattern.toLowerCase());
  },

  author_is_bot(ctx) {
    return Boolean(ctx.message?.author?.bot ?? ctx.member?.user?.bot);
  },

  author_has_role(ctx, params) {
    const member = ctx.member;
    return Boolean(member?.roles?.cache?.has(params.roleId));
  },

  author_missing_role(ctx, params) {
    const member = ctx.member;
    if (!member) return false;
    return !member.roles?.cache?.has(params.roleId);
  },

  channel_is(ctx, params) {
    const chId = ctx.message?.channelId ?? ctx.channelId;
    return chId === params.channelId;
  },

  member_account_age_lt(ctx, params) {
    const user = ctx.member?.user ?? ctx.member;
    if (!user?.createdTimestamp) return false;
    const ageDays = (Date.now() - user.createdTimestamp) / 86_400_000;
    return ageDays < (params.days ?? 7);
  },

  member_has_no_roles(ctx) {
    const member = ctx.member;
    if (!member) return false;
    return member.roles.cache.size <= 1;  // @everyone only
  },
};

function evaluateCondition(ctx, condition) {
  const fn = conditionEvaluators[condition.type];
  if (!fn) {
    logger.warn({ type: condition.type }, '[ruleEngine] unknown condition type');
    return false;
  }
  try { return fn(ctx, condition.params ?? {}); }
  catch (e) { logger.warn({ err: e, type: condition.type }, '[ruleEngine] condition error'); return false; }
}

// ── Action executors ──────────────────────────────────────────────────────────

const actionExecutors = {
  async send_message(ctx, params) {
    const ch = ctx.message?.channel ?? (ctx.guild && await ctx.guild.channels.fetch(params.channelId).catch(() => null));
    if (!ch?.isTextBased?.()) return;
    const content = resolveTemplate(params.content ?? '', ctx);
    await ch.send({ content: content.slice(0, 2000) }).catch(() => {});
  },

  async add_role(ctx, params) {
    const member = ctx.member;
    if (!member || !params.roleId) return;
    await member.roles.add(params.roleId, `Rule: ${ctx.rule.name}`).catch(() => {});
  },

  async remove_role(ctx, params) {
    const member = ctx.member;
    if (!member || !params.roleId) return;
    await member.roles.remove(params.roleId, `Rule: ${ctx.rule.name}`).catch(() => {});
  },

  async timeout_member(ctx, params) {
    const member = ctx.member;
    if (!member) return;
    const seconds = Math.min(params.seconds ?? 300, MAX_TIMEOUT_SEC_WITHOUT_MANAGE);
    await member.timeout(seconds * 1000, `Rule: ${ctx.rule.name}`).catch(() => {});
  },

  async delete_message(ctx) {
    if (ctx.message?.deletable) {
      await ctx.message.delete().catch(() => {});
    }
  },

  async create_mod_case(ctx, params) {
    if (!ctx.guild || !ctx.member) return;
    await createCase(ctx.guild.id, {
      type:        params.caseType ?? 'auto_rule',
      targetId:    ctx.member.id,
      moderatorId: ctx.guild.members.me?.id ?? ctx.client?.user?.id,
      reason:      `Automated rule: ${ctx.rule.name}`,
    }).catch(() => {});
  },

  async send_dm(ctx, params) {
    const user = ctx.member?.user;
    if (!user) return;
    const content = resolveTemplate(params.content ?? '', ctx);
    await user.send({ content: content.slice(0, 2000) }).catch(() => {});
  },
};

function resolveTemplate(template, ctx) {
  return template
    .replace('{user}',    ctx.member?.toString() ?? ctx.member?.user?.tag ?? 'Unknown')
    .replace('{channel}', ctx.message?.channel?.toString() ?? '')
    .replace('{guild}',   ctx.guild?.name ?? '')
    .replace('{rule}',    ctx.rule?.name ?? '');
}

async function executeAction(ctx, action) {
  const fn = actionExecutors[action.type];
  if (!fn) {
    logger.warn({ type: action.type }, '[ruleEngine] unknown action type');
    return;
  }
  try { await fn(ctx, action.params ?? {}); }
  catch (e) { logger.warn({ err: e, type: action.type }, '[ruleEngine] action error'); }
}

// ── Rule runner ───────────────────────────────────────────────────────────────

/**
 * Evaluate all enabled rules for a given trigger + context.
 *
 * @param {string} guildId
 * @param {string} trigger   'message' | 'member_join' | 'reaction_add' | etc.
 * @param {object} ctx       { guild, member, message?, client }
 */
async function runRules(guildId, trigger, ctx) {
  try {
    const settings = await getGuildSettings(guildId);
    const rules = (settings.rules ?? [])
      .filter((r) => r.enabled && r.trigger === trigger)
      .slice(0, MAX_RULES);

    if (!rules.length) return;

    for (const rule of rules) {
      const cooldownKey = `${guildId}:${rule.id}`;
      const expiresAt   = _cooldowns.get(cooldownKey) ?? 0;
      if (Date.now() < expiresAt) continue;  // still in cooldown

      // All conditions must pass (AND logic)
      const ctxWithRule = { ...ctx, rule };
      const allPass = (rule.conditions ?? []).every((cond) => evaluateCondition(ctxWithRule, cond));
      if (!allPass) continue;

      // Arm cooldown before executing (prevents loop storms)
      const cdMs = (rule.cooldownSeconds ?? 5) * 1000;
      _cooldowns.set(cooldownKey, Date.now() + cdMs);

      metrics.increment('rules.fired', { trigger });
      logger.debug({ guildId, ruleId: rule.id, ruleName: rule.name, trigger }, '[ruleEngine] rule fired');

      // Execute actions (cap at MAX_ACTIONS)
      const actions = (rule.actions ?? []).slice(0, MAX_ACTIONS);
      for (const action of actions) {
        await executeAction(ctxWithRule, action);
      }
    }
  } catch (err) {
    logger.warn({ err, guildId, trigger }, '[ruleEngine] rule evaluation failed');
  }
}

// ── Settings helpers ──────────────────────────────────────────────────────────

/**
 * Validate and sanitise a rule object before saving.
 * Returns { ok: boolean, errors: string[], rule: object }
 */
function validateRule(rule) {
  const errors = [];
  if (!rule.id)     errors.push('Rule must have an id.');
  if (!rule.name)   errors.push('Rule must have a name.');
  if (!rule.trigger) errors.push('Rule must have a trigger.');
  if (!Array.isArray(rule.conditions)) errors.push('conditions must be an array.');
  if (!Array.isArray(rule.actions))    errors.push('actions must be an array.');
  if ((rule.actions ?? []).length > MAX_ACTIONS)
    errors.push(`Max ${MAX_ACTIONS} actions per rule.`);
  if (rule.actions?.some((a) => ['ban', 'kick'].includes(a.type)))
    errors.push('ban and kick actions are not permitted in automated rules.');
  return { ok: errors.length === 0, errors, rule };
}

module.exports = { runRules, validateRule, MAX_RULES, MAX_ACTIONS, TRIGGERS: ['message', 'member_join', 'member_leave', 'reaction_add'] };
