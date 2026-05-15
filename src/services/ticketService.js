const {
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { getTicket, setTicket, deleteTicket } = require('../utils/ticketData');
const { getOpenTicketChannelId, setOpenTicketChannelId, clearOpenTicketChannelId, safeChannelName } = require('../utils/tickets');
const { nextSerial, getCategoryIdForType, setCategoryIdForType, markTempCategory } = require('../utils/ticketV2Store');
const { attemptClaim, clearTimer } = require('../utils/ticketClaim');

async function ensureCategoryForType(guild, typeValue, typeLabel, botId) {
  let categoryId = await getCategoryIdForType(guild.id, typeValue);
  let category = categoryId ? await guild.channels.fetch(categoryId).catch(() => null) : null;

  if (!category || category.type !== ChannelType.GuildCategory) {
    category = await guild.channels.create({
      name: typeLabel,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: botId, allow: [PermissionFlagsBits.ViewChannel] },
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      ],
    });

    await setCategoryIdForType(guild.id, typeValue, category.id);
    await markTempCategory(guild.id, category.id);
  }

  await category.permissionOverwrites.edit(botId, { ViewChannel: true }).catch(() => {});
  return category;
}

async function createTicket({ guild, openerId, typeValue, typeLabel, settings }) {
  const adminRoleId = settings?.tickets?.adminRoleId ?? null;
  const modRoleId = settings?.tickets?.modRoleId ?? settings?.tickets?.supportRoleId ?? null;
  if (!adminRoleId || !modRoleId) {
    throw new Error('Ticket roles are not configured. Run /ticket setup first.');
  }

  const existingId = await getOpenTicketChannelId(guild.id, openerId);
  if (existingId) {
    const existingCh = await guild.channels.fetch(existingId).catch(() => null);
    if (existingCh) {
      return { existingChannel: existingCh };
    }
    await clearOpenTicketChannelId(guild.id, openerId);
  }

  const botId = guild.members.me?.id ?? guild.client.user?.id;
  const category = await ensureCategoryForType(guild, typeValue, typeLabel, botId);

  const serial = await nextSerial(guild.id);
  const channel = await guild.channels.create({
    name: `ticket-${serial}`,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: [
      { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: openerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: adminRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
      { id: modRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
    ],
    topic: `Ticket for ${openerId} | Type: ${typeLabel}`,
    reason: 'Ticket created',
  });

  await setOpenTicketChannelId(guild.id, openerId, channel.id);

  const ticket = {
    openerId,
    messageId: null,
    typeLabel,
    typeValue,
    categoryId: category.id,
    createdAt: Date.now(),
    claimedBy: null,
  };
  await setTicket(guild.id, channel.id, ticket);

  const embed = new EmbedBuilder()
    .setTitle(`Ticket: ${typeLabel}`)
    .setDescription(
      'A staff member will claim your ticket soon. Please describe your issue.\n\n' +
      'When the ticket is resolved, staff should run `/ticket-done` to post close/delete controls.',
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticketv2:claim').setLabel('Claim Ticket').setStyle(ButtonStyle.Success),
  );

  const ticketMsg = await channel.send({ content: `<@${openerId}>`, embeds: [embed], components: [row] });
  const persistedTicket = { ...ticket, messageId: ticketMsg.id };
  await setTicket(guild.id, channel.id, persistedTicket);

  attemptClaim({ guild, channel, settings, openerId, attempt: 1, attemptedIds: [] }).catch(() => {});

  return { channel, ticket: persistedTicket };
}

module.exports = {
  getTicket,
  setTicket,
  deleteTicket,
  getOpenTicketChannelId,
  setOpenTicketChannelId,
  clearOpenTicketChannelId,
  safeChannelName,
  createTicket,
  attemptClaim,
  clearTimer,
};
