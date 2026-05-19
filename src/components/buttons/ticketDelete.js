const { MessageFlags } = require('discord.js');
const { getTicket, deleteTicket } = require('../../services/ticketService');
const { updateProgressMessage, sendAutoTranscript } = require('../../services/ticketProgressService');

module.exports = {
  id: 'ticket:delete',
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const ticket = await getTicket(interaction.guildId, interaction.channelId);
    if (!ticket) return interaction.editReply('This channel is not a ticket.');

    // Stamp close time for progress embed accuracy
    const closedTicket = { ...ticket, sla: { ...(ticket.sla ?? {}), closedAt: ticket.sla?.closedAt ?? Date.now() } };

    // Update progress channel embed: status → 'deleted' before channel disappears
    updateProgressMessage({
      guild: interaction.guild,
      channel: interaction.channel,
      ticket: closedTicket,
      status: 'deleted',
      claimedBy: closedTicket.claimedBy ?? null,
    }).catch(() => {});

    // Auto-send HTML transcript to transcript channel (if configured)
    sendAutoTranscript({
      guild: interaction.guild,
      channel: interaction.channel,
      ticket: closedTicket,
      closedBy: interaction.user.id,
    }).catch(() => {});

    await interaction.editReply('Deleting in 3 seconds...');
    setTimeout(async () => {
      await deleteTicket(interaction.guildId, interaction.channelId).catch(() => {});
      await interaction.channel.delete('Ticket deleted').catch(() => {});
    }, 3000);
  },
};
