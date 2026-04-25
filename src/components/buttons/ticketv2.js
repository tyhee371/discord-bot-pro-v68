
const { PermissionFlagsBits, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGuildSettings } = require('../../utils/settings');
const { getTicket, setTicket, deleteTicket } = require('../../services/ticketService');
const { clearOpenTicketChannelId } = require('../../services/ticketService');
const { clearTimer } = require('../../services/ticketService');

function isStaff(member, settings) {
  const adminRoleId = settings?.tickets?.adminRoleId ?? null;
  const modRoleId = settings?.tickets?.modRoleId ?? settings?.tickets?.supportRoleId ?? null;

  if (adminRoleId && member.roles.cache.has(adminRoleId)) return true;
  if (modRoleId && member.roles.cache.has(modRoleId)) return true;

  // fallback perms
  return member.permissions.has(PermissionFlagsBits.ManageMessages) || member.permissions.has(PermissionFlagsBits.Administrator);
}

module.exports = {
  id: 'ticketv2',
  async execute(interaction) {
    const action = interaction.customId.split(':')[1];
    const settings = await getGuildSettings(interaction.guildId);

    const ticket = await getTicket(interaction.guildId, interaction.channelId);
    if (!ticket) {
      return interaction.reply({ content: 'This ticket is not tracked (maybe old/expired).', flags: MessageFlags.Ephemeral });
    }

    if (action === 'claim') {
      if (!isStaff(interaction.member, settings)) {
        return interaction.reply({ content: 'Staff only.', flags: MessageFlags.Ephemeral });
      }

      if (ticket.claimedBy) {
        return interaction.reply({ content: `Already claimed by <@${ticket.claimedBy}>.`, flags: MessageFlags.Ephemeral });
      }

      ticket.claimedBy = interaction.user.id;
      await setTicket(interaction.guildId, interaction.channelId, ticket);

      clearTimer(interaction.channelId);

      await interaction.reply({ content: `✅ Ticket claimed by ${interaction.user}` });
      return;
    }

    if (action === 'close') {
      // Allow staff or opener
      const isOpener = ticket.openerId === interaction.user.id;
      if (!isOpener && !isStaff(interaction.member, settings)) {
        return interaction.reply({ content: 'Only the ticket opener or staff can close.', flags: MessageFlags.Ephemeral });
      }

      // Lock user send messages
      await interaction.channel.permissionOverwrites.edit(ticket.openerId, { SendMessages: false }).catch(() => {});
      await interaction.reply({ content: '🔒 Ticket closed (user can no longer send messages). Use Delete to remove it.' });
      return;
    }

    if (action === 'delete') {
      if (!isStaff(interaction.member, settings)) {
        return interaction.reply({ content: 'Staff only.', flags: MessageFlags.Ephemeral });
      }

      const openerId = ticket.openerId;
      await deleteTicket(interaction.guildId, interaction.channelId);
      await clearOpenTicketChannelId(interaction.guildId, openerId).catch(() => {});
      clearTimer(interaction.channelId);

      await interaction.reply({ content: '🗑️ Deleting ticket in 3 seconds...' }).catch(() => {});
      setTimeout(() => interaction.channel.delete('Ticket deleted').catch(() => {}), 3000);
      return;
    }

    // Unknown action
    return interaction.reply({ content: 'Unknown ticket action.', flags: MessageFlags.Ephemeral });
  },
};
