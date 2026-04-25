const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { safeDefer } = require('../../utils/safeReply');
const { addWarn, listWarns, removeWarn, clearWarns, countWarns, getTimer, setTimer, clearTimer } = require('../../services/moderationService');
const { getGuildSettings, getPath } = require('../../utils/settings');
const { formatDuration } = require('../../utils/duration');
const { requireModLog, createAndSendCase } = require('../../utils/modLogService');

function pickWarnLevel(levels, count) {
  if (!Array.isArray(levels)) return null;
  const clean = levels
    .map((l) => ({
      threshold: Number(l.threshold),
      durationMs: Number(l.durationMs),
      roleId: typeof l.roleId === 'string' ? l.roleId : null,
    }))
    .filter((l) => Number.isFinite(l.threshold) && l.threshold > 0 && Number.isFinite(l.durationMs) && l.durationMs > 0)
    .sort((a, b) => a.threshold - b.threshold);

  let chosen = null;
  for (const l of clean) {
    if (count >= l.threshold) chosen = l;
  }
  return chosen;
}

async function reconcilePrisonRole({ guild, userId, warnCount, settings }) {
  const levels = getPath(settings, 'moderation.warnLevels', []);
  const chosen = pickWarnLevel(levels, warnCount);
  const prisonRoleId = chosen?.roleId || getPath(settings, 'moderation.prison.roleId', null);

  // If no rule applies, remove any active prison role/timer.
  if (!chosen || !prisonRoleId) {
    const existing = await getTimer(guild.id, userId);
    if (existing?.roleId) {
      try {
        const m = await guild.members.fetch(userId).catch(() => null);
        if (m && m.roles.cache.has(existing.roleId)) {
          await m.roles.remove(existing.roleId, 'Warn level cleared / below threshold').catch(() => {});
        }
      } catch {}
      await clearTimer(guild.id, userId);
    }
    return { applied: false };
  }

  // Apply / refresh prison role.
  const durationMs = chosen.durationMs;
  const removeAt = Date.now() + durationMs;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return { applied: false, error: 'Member not found' };

  try {
    if (!member.roles.cache.has(prisonRoleId)) {
      await member.roles.add(prisonRoleId, `Reached warn threshold ${chosen.threshold}`).catch(() => {});
    }
    await setTimer(guild.id, userId, { roleId: prisonRoleId, removeAt });
    return { applied: true, durationMs, roleId: prisonRoleId };
  } catch (e) {
    return { applied: false, error: 'Missing perms / hierarchy' };
  }
}

module.exports = {
  // We handle deferring manually so only `/warn add` is public while other subcommands stay ephemeral.
  defer: false,
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn system.')
    .addSubcommand(s =>
      s.setName('add')
        .setDescription('Add a warning.')
        .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason (optional)').setRequired(false)),
    )
    .addSubcommand(s =>
      s.setName('list')
        .setDescription('List warnings for a user.')
        .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
    )
    .addSubcommand(s =>
      s.setName('remove')
        .setDescription('Remove a warning by ID.')
        .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
        .addStringOption(o => o.setName('id').setDescription('Warning ID').setRequired(true)),
    )
    .addSubcommand(s =>
      s.setName('clear')
        .setDescription('Clear all warnings for a user.')
        .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user', true);

    // `/warn add` should be visible in-channel; other subcommands are mod-only utilities.
    await safeDefer(interaction, { ephemeral: sub !== 'add' });

    const modLogCh = await requireModLog(interaction);
    if (!modLogCh) return;

    // Read settings once for all subcommands.
    const settings = await getGuildSettings(interaction.guildId);

    if (sub === 'add') {
      const reason = interaction.options.getString('reason') ?? 'None';
      const w = await addWarn(interaction.guildId, user.id, interaction.user.id, reason);
      const count = await countWarns(interaction.guildId, user.id);

      const warnCase = await createAndSendCase({
        guild: interaction.guild,
        type: 'warn',
        title: '⚠️ Warn Added',
        moderator: interaction.user,
        target: user,
        reason,
        fields: [
          { name: 'Warn ID', value: `\`${w.id}\``, inline: true },
          { name: 'Total Warns', value: String(count), inline: true },
        ],
        dmTarget: false,
        extra: { warnId: w.id, totalWarns: count },
      });

      // Warn levels -> apply a (jail/prison) role for a duration, then auto-remove it.
      const levels = getPath(settings, 'moderation.warnLevels', []);
      const chosen = pickWarnLevel(levels, count);

      let autoNote = '';
      if (chosen && chosen.threshold && chosen.durationMs) {
        // Role can be stored on the level, or fallback to configured prison role.
        const roleId = chosen.roleId ?? getPath(settings, 'moderation.prison.roleId', null);
        if (roleId) {
          const member = await interaction.guild.members.fetch(user.id).catch(() => null);
          if (member) {
            // Apply role (if missing) and (re)start timer.
            if (!member.roles.cache.has(roleId)) {
              await member.roles.add(roleId, `Warn level reached (${count} warns, threshold ${chosen.threshold})`).catch(() => {});
            }

            const removeAt = Date.now() + chosen.durationMs;
            await setTimer(interaction.guildId, user.id, { roleId, removeAt }).catch(() => {});

            autoNote = `\n🔒 Applied <@&${roleId}> for **${formatDuration(chosen.durationMs)}** (warns **${count}**, threshold **${chosen.threshold}**).`;
          } else {
            autoNote = `\n⚠️ Reached warn threshold (**${chosen.threshold}**), but I couldn't fetch the member to apply the role.`;
          }
        } else {
          autoNote = `\n⚠️ Warn level reached (**${chosen.threshold}**), but no jail role is configured. Set one via **/modlogs prison-setup** or store a role on the warn level.`;
        }
      }

      return interaction.editReply(
        `⚠️ Warned **${user.tag}**. WarnID: \`${w.id}\`\nTotal warns: **${count}**. Reason: **${reason}**`
        + (warnCase ? ` Case: **#${warnCase.id}**.` : '')
        + autoNote
      );
    }

    if (sub === 'list') {
      const warns = await listWarns(interaction.guildId, user.id);
      if (!warns.length) return interaction.editReply(`No warnings for **${user.tag}**.`);

      const last = warns.slice(-10).reverse();
      const lines = last.map(w => {
        const when = new Date(w.createdAt).toLocaleString();
        return `• \`${w.id}\` — ${when} — <@${w.moderatorId}> — ${w.reason}`;
      });

      return interaction.editReply(`Warnings for **${user.tag}** (showing last ${last.length}/${warns.length}):\n${lines.join('\n')}`);
    }

    if (sub === 'remove') {
      const id = interaction.options.getString('id', true);
      const ok = await removeWarn(interaction.guildId, user.id, id);
      if (!ok) return interaction.editReply(`❌ Could not find warn ID \`${id}\` for **${user.tag}**.`);

      await createAndSendCase({
        guild: interaction.guild,
        type: 'warn_remove',
        title: '🧹 Warn Removed',
        moderator: interaction.user,
        target: user,
        reason: `Removed warn ID ${id}`,
        fields: [{ name: 'Warn ID', value: `\`${id}\``, inline: true }],
        dmTarget: false,
      });

      // If the user no longer matches any warn level, remove any active jail role + timer.
      const remaining = await countWarns(interaction.guildId, user.id);
      const levels = getPath(settings, 'moderation.warnLevels', []);
      const should = pickWarnLevel(levels, remaining);

      if (!should) {
        const timer = await getTimer(interaction.guildId, user.id).catch(() => null);
        if (timer?.roleId) {
          const member = await interaction.guild.members.fetch(user.id).catch(() => null);
          if (member && member.roles.cache.has(timer.roleId)) {
            await member.roles.remove(timer.roleId, `Warns no longer match a warn level (${remaining})`).catch(() => {});
          }
          await clearTimer(interaction.guildId, user.id).catch(() => {});
        }
      }

      return interaction.editReply(`✅ Removed warn \`${id}\` for **${user.tag}**.`);
    }

    if (sub === 'clear') {
      const cleared = await clearWarns(interaction.guildId, user.id);
      await createAndSendCase({
        guild: interaction.guild,
        type: 'warn_clear',
        title: '🧹 Warnings Cleared',
        moderator: interaction.user,
        target: user,
        reason: `Cleared ${cleared} warn(s).`,
        fields: [{ name: 'Count', value: String(cleared), inline: true }],
        dmTarget: false,
      });

      // Clear jail role + timer (because warn count is now 0).
      const timer = await getTimer(interaction.guildId, user.id).catch(() => null);
      if (timer?.roleId) {
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (member && member.roles.cache.has(timer.roleId)) {
          await member.roles.remove(timer.roleId, 'Warnings cleared (auto-remove jail role)').catch(() => {});
        }
        await clearTimer(interaction.guildId, user.id).catch(() => {});
      }

      return interaction.editReply(`✅ Cleared **${cleared}** warning(s) for **${user.tag}**.`);
    }

    return interaction.editReply('Unknown subcommand.');
  },
};
