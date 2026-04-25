const { MessageFlags } = require('discord.js');
const { getTicket, deleteTicket } = require('../../services/ticketService');

module.exports = {
  id: 'ticket:delete',
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const ticket = await getTicket(interaction.guildId, interaction.channelId);
    if (!ticket) return interaction.editReply('This channel is not a ticket.');

    await interaction.editReply('Deleting in 3 seconds...');
    setTimeout(async () => {
      await deleteTicket(interaction.guildId, interaction.channelId).catch(() => {});
      await interaction.channel.delete('Ticket deleted').catch(() => {});
    }, 3000);
  },
};
