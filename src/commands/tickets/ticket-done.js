
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { getTicket } = require('../../services/ticketService');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('ticket-done')
    .setDescription('Post the ticket done/close buttons.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const ticket = await getTicket(interaction.guildId, interaction.channelId);
    if (!ticket) {
      return interaction.editReply('This command can only be used inside a ticket channel.');
    }

    const embed = new EmbedBuilder()
      .setTitle('Ticket Controls')
      .setDescription('Use the buttons below to close or delete this ticket.');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticketv2:close').setLabel('Close').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticketv2:delete').setLabel('Delete').setStyle(ButtonStyle.Danger),
    );

    await interaction.channel.send({ embeds: [embed], components: [row] }).catch(() => null);
    return interaction.editReply('✅ Posted controls.');
  },
};
