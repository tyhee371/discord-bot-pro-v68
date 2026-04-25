const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { requireModLog, updateCaseLogReason } = require('../../utils/modLogService');
const { getCase, listCasesForUser } = require('../../utils/modCases');
const { formatDuration } = require('../../utils/duration');
const { safeReply } = require('../../utils/safeReply');

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

    return safeReply(interaction, { ephemeral: true, content: 'Unknown subcommand.' });
  },
};
