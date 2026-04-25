const {
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  AttachmentBuilder,
} = require('discord.js');

const { getGuildSettings } = require('../../utils/settings');
const { getTicket, setTicket } = require('../../services/ticketService');
const { clearOpenTicketChannelId } = require('../../services/ticketService');

async function makeTranscript(channel) {
  const msgs = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!msgs) return null;
  const lines = [...msgs.values()]
    .reverse()
    .map(m => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content}`);
  const text = lines.join('\n');
  return Buffer.from(text, 'utf-8');
}

module.exports = {
  id: 'ticket:close',
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const ticket = await getTicket(interaction.guildId, interaction.channelId);
    if (!ticket) return interaction.editReply('This channel is not a ticket.');

    if (ticket.status === 'closed') return interaction.editReply('Ticket already closed.');

    ticket.status = 'closed';
    ticket.closedAt = Date.now();
    await setTicket(interaction.guildId, interaction.channelId, ticket);

    // Lock the ticket for the owner
    await interaction.channel.permissionOverwrites.edit(ticket.ownerId, {
      SendMessages: false,
    }).catch(() => {});

    // Post transcript to transcript channel (optional)
    const settings = await getGuildSettings(interaction.guildId);
    const transcriptChannelId = settings?.tickets?.transcriptChannelId;

    if (transcriptChannelId) {
      const transcriptChannel = await interaction.guild.channels.fetch(transcriptChannelId).catch(() => null);
      if (transcriptChannel) {
        const buf = await makeTranscript(interaction.channel);
        if (buf) {
          const file = new AttachmentBuilder(buf, { name: `ticket-${interaction.channelId}.txt` });
          await transcriptChannel.send({
            content: `📄 Transcript for ${interaction.channel} (owner <@${ticket.ownerId}>)`,
            files: [file],
          }).catch(() => {});
        }
      }
    }

    // clear "open ticket" mapping
    await clearOpenTicketChannelId(interaction.guildId, ticket.ownerId).catch(() => {});

    // Add reopen/delete buttons
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:reopen').setLabel('Reopen').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ticket:delete').setLabel('Delete').setStyle(ButtonStyle.Danger),
    );

    await interaction.channel.send({ content: '🔒 Ticket closed.', components: [row] }).catch(() => {});
    return interaction.editReply('Closed.');
  },
};
