const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  AttachmentBuilder,
} = require('discord.js');
const { Buffer } = require('node:buffer');

const { getGuildSettings } = require('../../utils/settings');
const { getTicket, setTicket } = require('../../services/ticketService');
const { clearOpenTicketChannelId } = require('../../services/ticketService');
const { buildTicketReceiptEmbed, sendTicketReceiptDM } = require('../../utils/ticketReceipt');

async function makeTranscript(channel) {
  const allMessages = [];
  let lastId = null;

  // Paginate through ALL messages — Discord limits to 100 per fetch
  while (true) {
    const opts = { limit: 100 };
    if (lastId) opts.before = lastId;
    const batch = await channel.messages.fetch(opts).catch(() => null);
    if (!batch || batch.size === 0) break;
    allMessages.push(...batch.values());
    lastId = batch.last()?.id;
    if (batch.size < 100) break;
  }

  if (allMessages.length === 0) return null;

  // Sort oldest first
  allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const lines = allMessages.map(m => {
    const ts = new Date(m.createdTimestamp).toISOString();
    const author = m.author?.tag ?? 'Unknown';
    let line = `[${ts}] ${author}: ${m.content || ''}`;

    // Include embed titles
    if (m.embeds?.length > 0) {
      const embedTitles = m.embeds.map(e => e.title || e.description || '[embed]').join(', ');
      line += ` [Embed: ${embedTitles}]`;
    }

    // Include attachment URLs
    if (m.attachments?.size > 0) {
      const urls = [...m.attachments.values()].map(a => a.url).join(', ');
      line += ` [Attachment: ${urls}]`;
    }

    return line;
  });

  const header = [
    `=== Ticket Transcript ===`,
    `Channel: #${channel.name} (${channel.id})`,
    `Messages: ${allMessages.length}`,
    `Generated: ${new Date().toISOString()}`,
    `========================`,
    '',
  ].join('\n');

  return Buffer.from(header + lines.join('\n'), 'utf-8');
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

    const openerId = ticket.ownerId || ticket.openerId;
    if (openerId) {
      const receiptEmbed = buildTicketReceiptEmbed({
        guildName: interaction.guild?.name || 'this server',
        channelId: interaction.channelId,
        closerId: interaction.user.id,
        openerId,
        claimedBy: ticket.claimedBy || null,
        typeLabel: ticket.typeLabel || 'General',
        openedAt: ticket.createdAt || Date.now(),
        closedAt: ticket.closedAt,
      });
      await sendTicketReceiptDM({
        client: interaction.client,
        openerId,
        embed: receiptEmbed,
      });
    }

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
    if (openerId) {
      await clearOpenTicketChannelId(interaction.guildId, openerId).catch(() => {});
    }

    // Add reopen/delete buttons
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:reopen').setLabel('Reopen').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ticket:delete').setLabel('Delete').setStyle(ButtonStyle.Danger),
    );

    await interaction.channel.send({ content: '🔒 Ticket closed.', components: [row] }).catch(() => {});
    return interaction.editReply('Closed.');
  },
};
