const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const { getCase } = require('../../utils/modCases');
const { getModLogConfig } = require('../../utils/modLogService');
const { safeReply } = require('../../utils/safeReply');

module.exports = {
  id: 'appeal',

  async execute(interaction) {
    const parts = String(interaction.customId || '').split(':');
    // appeal:open:<guildId>:<caseId>
    const action = parts[1];
    const guildId = parts[2];
    const caseId = Number(parts[3]);

    if (action !== 'open' || !guildId || !Number.isFinite(caseId)) {
      return safeReply(interaction, { flags: MessageFlags.Ephemeral, content: '❌ Invalid appeal button.' });
    }

    const cfg = await getModLogConfig(guildId);
    if (!cfg.appeals?.enabled || !cfg.appeals?.channelId) {
      return safeReply(interaction, { flags: MessageFlags.Ephemeral, content: '❌ Appeals are not enabled for this server.' });
    }

    const c = await getCase(guildId, caseId);
    if (!c) return safeReply(interaction, { flags: MessageFlags.Ephemeral, content: '❌ That case no longer exists.' });

    if (c.targetId && c.targetId !== interaction.user.id) {
      return safeReply(interaction, { flags: MessageFlags.Ephemeral, content: '❌ You can only appeal actions taken against your account.' });
    }

    const modal = new ModalBuilder()
      .setCustomId(`appealSubmit:${guildId}:${caseId}`)
      .setTitle(`Appeal Case #${caseId}`);

    const input = new TextInputBuilder()
      .setCustomId('message')
      .setLabel('Explain your appeal')
      .setPlaceholder('Why should this action be reviewed? Provide context, screenshots links, etc.')
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(10)
      .setMaxLength(1000)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));

    return interaction.showModal(modal);
  },
};
