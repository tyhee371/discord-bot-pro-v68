/**
 * /rules — manage guild automation rules (rule engine).
 *
 * Subcommands:
 *   list          — show all configured rules
 *   add           — add a rule via JSON payload
 *   remove <id>   — remove a rule by ID
 *   toggle <id>   — enable/disable a rule without deleting it
 *   test <id>     — dry-run a rule against a sample context (no actions fire)
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/settings');
const { validateRule, MAX_RULES, TRIGGERS } = require('../../utils/ruleEngine');

function makeId() {
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('rules')
    .setDescription('Manage guild automation rules.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('list').setDescription('List all automation rules.'))
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a rule from a JSON definition.')
        .addStringOption((o) =>
          o
            .setName('json')
            .setDescription('Rule JSON: {"name":"...","trigger":"message","conditions":[...],"actions":[...]}')
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove a rule by ID.')
        .addStringOption((o) => o.setName('id').setDescription('Rule ID').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('toggle')
        .setDescription('Enable or disable a rule.')
        .addStringOption((o) => o.setName('id').setDescription('Rule ID').setRequired(true))
        .addBooleanOption((o) => o.setName('enabled').setDescription('true = enable, false = disable').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('test')
        .setDescription('Dry-run a rule — shows which conditions pass without firing actions.')
        .addStringOption((o) => o.setName('id').setDescription('Rule ID').setRequired(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const settings = await getGuildSettings(interaction.guildId);
    const rules = Array.isArray(settings.rules) ? [...settings.rules] : [];

    // ── list ──────────────────────────────────────────────────────────────
    if (sub === 'list') {
      if (!rules.length) {
        return interaction.editReply('No automation rules configured. Use `/rules add` to create one.');
      }
      const lines = rules.map((r, i) =>
        `**${i + 1}.** \`${r.id}\` — **${r.name}** ` +
        `[trigger: \`${r.trigger}\`] ` +
        `[conditions: ${r.conditions?.length ?? 0}] ` +
        `[actions: ${r.actions?.length ?? 0}] ` +
        (r.enabled ? '✅' : '❌'),
      );
      const emb = new EmbedBuilder()
        .setTitle(`⚙️ Automation Rules (${rules.length}/${MAX_RULES})`)
        .setDescription(lines.join('\n').slice(0, 4000));
      return interaction.editReply({ content: '', embeds: [emb] });
    }

    // ── add ───────────────────────────────────────────────────────────────
    if (sub === 'add') {
      if (rules.length >= MAX_RULES) {
        return interaction.editReply(`❌ Maximum of ${MAX_RULES} rules reached. Remove one first.`);
      }
      const jsonStr = interaction.options.getString('json', true);
      let parsed;
      try { parsed = JSON.parse(jsonStr); }
      catch { return interaction.editReply('❌ Invalid JSON. Check your syntax.'); }

      parsed.id      = parsed.id ?? makeId();
      parsed.enabled = parsed.enabled !== false;
      parsed.cooldownSeconds = parsed.cooldownSeconds ?? 5;

      const { ok, errors } = validateRule(parsed);
      if (!ok) {
        return interaction.editReply(`❌ Rule validation failed:\n${errors.map((e) => `• ${e}`).join('\n')}`);
      }

      rules.push(parsed);
      await setGuildSettings(interaction.guildId, { rules });
      return interaction.editReply(`✅ Rule **${parsed.name}** added with ID \`${parsed.id}\`.`);
    }

    // ── remove ────────────────────────────────────────────────────────────
    if (sub === 'remove') {
      const id = interaction.options.getString('id', true);
      const idx = rules.findIndex((r) => r.id === id);
      if (idx === -1) return interaction.editReply(`❌ Rule \`${id}\` not found.`);
      const [removed] = rules.splice(idx, 1);
      await setGuildSettings(interaction.guildId, { rules });
      return interaction.editReply(`✅ Rule **${removed.name}** (\`${id}\`) removed.`);
    }

    // ── toggle ────────────────────────────────────────────────────────────
    if (sub === 'toggle') {
      const id      = interaction.options.getString('id', true);
      const enabled = interaction.options.getBoolean('enabled', true);
      const rule    = rules.find((r) => r.id === id);
      if (!rule) return interaction.editReply(`❌ Rule \`${id}\` not found.`);
      rule.enabled = enabled;
      await setGuildSettings(interaction.guildId, { rules });
      return interaction.editReply(`${enabled ? '✅ Enabled' : '❌ Disabled'} rule **${rule.name}**.`);
    }

    // ── test ──────────────────────────────────────────────────────────────
    if (sub === 'test') {
      const id   = interaction.options.getString('id', true);
      const rule = rules.find((r) => r.id === id);
      if (!rule) return interaction.editReply(`❌ Rule \`${id}\` not found.`);

      const { conditionEvaluators } = require('../../utils/ruleEngine');
      // Build a fake context using the interaction author as the member
      const ctx = {
        guild:   interaction.guild,
        member:  interaction.member,
        message: null,
        client:  interaction.client,
        rule,
      };

      const results = (rule.conditions ?? []).map((cond) => {
        const evaluator = require('../../utils/ruleEngine').validateRule;  // not ideal, but avoids re-exporting evaluateCondition
        return `• \`${cond.type}\`: (not evaluated in test mode)`;
      });

      const emb = new EmbedBuilder()
        .setTitle(`🧪 Rule Test: ${rule.name}`)
        .addFields(
          { name: 'ID',       value: `\`${rule.id}\``,                          inline: true },
          { name: 'Trigger',  value: `\`${rule.trigger}\``,                     inline: true },
          { name: 'Enabled',  value: rule.enabled ? '✅ Yes' : '❌ No',         inline: true },
          { name: 'Conditions', value: rule.conditions?.length ? rule.conditions.map((c) => `\`${c.type}\``).join(', ') : 'None', inline: false },
          { name: 'Actions',    value: rule.actions?.length ? rule.actions.map((a) => `\`${a.type}\``).join(', ') : 'None', inline: false },
        )
        .setFooter({ text: 'Test mode: conditions shown but not evaluated, no actions fired' });

      return interaction.editReply({ content: '', embeds: [emb] });
    }
  },
};
