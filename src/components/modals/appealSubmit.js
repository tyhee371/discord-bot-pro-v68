const { EmbedBuilder, MessageFlags } = require('discord.js');
const { resolveAppealChannel } = require('../../utils/modLogService');
const { getCase, addAppeal } = require('../../utils/modCases');
const { safeReply } = require('../../utils/safeReply');

module.exports = {
  id: 'appealSubmit',

  async execute(interaction) {
    // Must acknowledge quickly
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const parts = String(interaction.customId || '').split(':');
    // appealSubmit:<guildId>:<caseId>
    const guildId = parts[1];
    const caseId = Number(parts[2]);
    if (!guildId || !Number.isFinite(caseId)) {
      return interaction.editReply({ content: '❌ Invalid appeal submit.' }).catch(() => {});
    }

    const c = await getCase(guildId, caseId);
    if (!c) return interaction.editReply({ content: '❌ That case no longer exists.' }).catch(() => {});

    if (c.targetId && c.targetId !== interaction.user.id) {
      return interaction.editReply({ content: '❌ You can only appeal actions taken against your account.' }).catch(() => {});
    }

    const msg = interaction.fields.getTextInputValue('message')?.trim();
    if (!msg || msg.length < 10) {
      return interaction.editReply({ content: '❌ Please provide a more detailed appeal (min 10 chars).' }).catch(() => {});
    }

    const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      return interaction.editReply({ content: '❌ Could not find the server for this appeal.' }).catch(() => {});
    }

    const appealCh = await resolveAppealChannel(guild);
    if (!appealCh) {
      return interaction.editReply({ content: '❌ Appeals channel is not configured for this server.' }).catch(() => {});
    }

    const updated = await addAppeal(guildId, caseId, { userId: interaction.user.id, message: msg });

    const emb = new EmbedBuilder()
      .setTitle(`📨 Appeal Submitted • Case #${caseId}`)
      .setTimestamp()
      .addFields(
        { name: 'User', value: `<@${interaction.user.id}> (${interaction.user.id})`, inline: false },
        { name: 'Case Type', value: String(c.type).toUpperCase(), inline: true },
        { name: 'Original Reason', value: String(c.reason ?? '—').slice(0, 1024), inline: false },
        { name: 'Appeal', value: msg.slice(0, 1024), inline: false },
      )
      .setFooter({ text: `Case #${caseId}` });

    await appealCh.send({ embeds: [emb] }).catch(() => {});

    return interaction.editReply({ content: '✅ Your appeal was submitted. A moderator will review it.' }).catch(() => {});
  },
};
