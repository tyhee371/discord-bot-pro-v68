const { MessageFlags } = require('discord.js');
const { getTicket, setTicket } = require('../../services/ticketService');

module.exports = {
  id: 'ticket:claim',
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const ticket = await getTicket(interaction.guildId, interaction.channelId);
    if (!ticket) return interaction.editReply('This channel is not a ticket.');

    ticket.claimedBy = interaction.user.id;
    await setTicket(interaction.guildId, interaction.channelId, ticket);

    await interaction.channel.send(`✅ Ticket claimed by ${interaction.user}.`);
    return interaction.editReply('Done.');
  },
};
