const { MessageFlags } = require('discord.js');
const { getTicket, setTicket } = require('../../services/ticketService');
const { setOpenTicketChannelId } = require('../../services/ticketService');

module.exports = {
  id: 'ticket:reopen',
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const ticket = await getTicket(interaction.guildId, interaction.channelId);
    if (!ticket) return interaction.editReply('This channel is not a ticket.');
    if (ticket.status !== 'closed') return interaction.editReply('Ticket is not closed.');

    ticket.status = 'open';
    await setTicket(interaction.guildId, interaction.channelId, ticket);

    await interaction.channel.permissionOverwrites.edit(ticket.ownerId, {
      SendMessages: true,
    }).catch(() => {});

    await setOpenTicketChannelId(interaction.guildId, ticket.ownerId, interaction.channelId).catch(() => {});
    await interaction.channel.send('🔓 Ticket reopened.').catch(() => {});
    return interaction.editReply('Reopened.');
  },
};
