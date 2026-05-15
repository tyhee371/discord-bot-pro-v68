const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { requireModLog, updateCaseLogReason } = require('../../utils/modLogService');
const { getCase, listCasesForUser, addAppeal } = require('../../utils/modCases');
const { formatDuration } = require('../../utils/duration');
const { safeReply } = require('../../utils/safeReply');
const { getGuildModStats, getUserModStats } = require('../../utils/modStats');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('modcase')
    .setDescription('View and manage moderation cases.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('View a case by ID.')
        .addIntegerOption((o) => o.setName('id').setDescription('Case ID').setMinValue(1).setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('List recent cases for a user.')
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
        .addIntegerOption((o) => o.setName('limit').setDescription('How many (max 20)').setMinValue(1).setMaxValue(20).setRequired(false)),
    )
    .addSubcommand((s) =>
      s
        .setName('stats')
        .setDescription('Show moderation action statistics for this server or a user.')
        .addUserOption((o) => o.setName('user').setDescription('Show stats for a specific user (optional)').setRequired(false))
        .addIntegerOption((o) => o.setName('days').setDescription('Look back N days (default 30)').setMinValue(1).setMaxValue(365).setRequired(false)),
    )
    .addSubcommand((s) =>
      s
        .setName('appeal')
        .setDescription('Record an appeal note on a case.')
        .addIntegerOption((o) => o.setName('id').setDescription('Case ID').setMinValue(1).setRequired(true))
        .addStringOption((o) => o.setName('message').setDescription('Appeal message').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('edit-reason')
        .setDescription('Edit a case reason (also updates the mod-log message).')
        .addIntegerOption((o) => o.setName('id').setDescription('Case ID').setMinValue(1).setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('New reason').setRequired(true)),
    ),

  async execute(interaction) {
    const modLogCh = await requireModLog(interaction);
    if (!modLogCh) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      const id = interaction.options.getInteger('id', true);
      const c = await getCase(interaction.guildId, id);
      if (!c) return interaction.editReply(`❌ Case **#${id}** not found.`);

      const emb = new EmbedBuilder()
        .setTitle(`Case #${c.id}`)
        .setTimestamp(new Date(c.createdAt))
        .addFields(
          { name: 'Type', value: String(c.type).toUpperCase(), inline: true },
          { name: 'Moderator', value: c.moderatorId ? `<@${c.moderatorId}>` : 'Unknown', inline: true },
          { name: 'Target', value: c.targetId ? `<@${c.targetId}>` : 'N/A', inline: true },
          { name: 'Reason', value: String(c.reason ?? '').slice(0, 1024) || '—', inline: false },
        );

      if (c.durationMs) {
        emb.addFields({ name: 'Duration', value: formatDuration(c.durationMs), inline: true });
      }
      if (c.appeals?.length) {
        emb.addFields({ name: 'Appeals', value: String(c.appeals.length), inline: true });
      }
      if (c.logChannelId && c.logMessageId) {
        emb.addFields({ name: 'Log Message', value: `<#${c.logChannelId}> / \`${c.logMessageId}\``, inline: false });
      }

      return interaction.editReply({ embeds: [emb] });
    }

    if (sub === 'list') {
      const user = interaction.options.getUser('user', true);
      const limit = interaction.options.getInteger('limit') ?? 10;

      const cases = await listCasesForUser(interaction.guildId, user.id, limit);
      if (!cases.length) return interaction.editReply(`No cases found for **${user.tag}**.`);

      const lines = cases.map((c) => {
        const when = new Date(c.createdAt).toLocaleString();
        const reason = String(c.reason ?? '').replace(/\s+/g, ' ').slice(0, 60);
        return `• **#${c.id}** \`${String(c.type).toUpperCase()}\` — ${when} — ${reason || '—'}`;
      });

      return interaction.editReply(`Recent cases for **${user.tag}**:\n${lines.join('\n')}`);
    }

    if (sub === 'edit-reason') {
      const id = interaction.options.getInteger('id', true);
      const reason = interaction.options.getString('reason', true);

      const c = await getCase(interaction.guildId, id);
      if (!c) return interaction.editReply(`❌ Case **#${id}** not found.`);

      await updateCaseLogReason(interaction.client, interaction.guildId, id, reason, interaction.user);

      return interaction.editReply(`✅ Updated reason for case **#${id}**.`);
    }

    if (sub === 'stats') {
      const targetUser = interaction.options.getUser('user');
      const days = interaction.options.getInteger('days') ?? 30;

      if (targetUser) {
        const stats = await getUserModStats(interaction.guildId, targetUser.id);
        const lines = Object.entries(stats.counts).map(([type, n]) => `• **${type.toUpperCase()}**: ${n}`);
        const emb = new EmbedBuilder()
          .setTitle(`📊 Mod History: ${targetUser.tag}`)
          .addFields(
            { name: 'Total Cases', value: String(stats.totalCases), inline: true },
            { name: 'Appeals Filed', value: String(stats.appealCount), inline: true },
            { name: 'Last Action', value: stats.latestCase ? `<t:${Math.floor(stats.latestCase.createdAt / 1000)}:R>` : 'None', inline: true },
            { name: 'Breakdown', value: lines.length ? lines.join('\n') : 'No cases.', inline: false },
          );
        return interaction.editReply({ embeds: [emb] });
      }

      // Guild-wide stats
      await interaction.editReply({ content: `📊 Calculating stats for the last **${days}** days…` });
      const stats = await getGuildModStats(interaction.guildId, { days });
      const typeLine = Object.entries(stats.counts).map(([t, n]) => `• **${t.toUpperCase()}**: ${n}`).join('\n') || 'None';
      const modLine = stats.topMods.map((m, i) => `${i + 1}. <@${m.id}> (${m.count})`).join('\n') || 'None';
      const targetLine = stats.topTargets.map((t, i) => `${i + 1}. <@${t.id}> (${t.count})`).join('\n') || 'None';

      const emb = new EmbedBuilder()
        .setTitle(`📊 Server Mod Stats — Last ${days} Days`)
        .addFields(
          { name: 'Total Actions', value: String(stats.total), inline: true },
          { name: 'Unique Action Types', value: String(Object.keys(stats.counts).length), inline: true },
          { name: '​', value: '​', inline: true },
          { name: 'By Type', value: typeLine, inline: false },
          { name: 'Top Moderators', value: modLine, inline: true },
          { name: 'Most Actioned Users', value: targetLine, inline: true },
        )
        .setFooter({ text: `Based on indexed cases in the last ${days} days` })
        .setTimestamp();

      return interaction.editReply({ content: '', embeds: [emb] });
    }

    if (sub === 'appeal') {
      const id = interaction.options.getInteger('id', true);
      const message = interaction.options.getString('message', true);

      const appealCase = await getCase(interaction.guildId, id);
      if (!appealCase) return interaction.editReply(`❌ Case **#${id}** not found.`);

      await addAppeal(interaction.guildId, id, {
        userId: interaction.user.id,
        message: message.slice(0, 1800),
      });

      return interaction.editReply(`✅ Appeal recorded on case **#${id}**.`);
    }

    return safeReply(interaction, { ephemeral: true, content: 'Unknown subcommand.' });
  },
};
