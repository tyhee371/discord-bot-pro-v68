const { stampOpened } = require('../../utils/ticketSla');

const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');

const { getGuildSettings } = require('../../utils/settings');
const { getOpenTicketChannelId, setOpenTicketChannelId, clearOpenTicketChannelId } = require('../../services/ticketService');
const { getTicket, setTicket } = require('../../services/ticketService');
const { nextSerial, getCategoryIdForType, setCategoryIdForType, markTempCategory } = require('../../utils/ticketV2Store');
const { attemptClaim } = require('../../services/ticketService');

module.exports = {
  id: 'ticketv2',
  async execute(interaction) {
    const parts = interaction.customId.split(':');
    const action = parts[1];
    const builderId = parts[2] || null;
    if (action !== 'select') return;

    // Ticket creation can involve API + DB calls (category/channel creation). Acknowledge ASAP
    // so Discord doesn't show "This interaction failed" even if the ticket is created.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const settings = await getGuildSettings(interaction.guildId);
    const adminRoleId = settings?.tickets?.adminRoleId ?? null;
    const modRoleId = settings?.tickets?.modRoleId ?? settings?.tickets?.supportRoleId ?? null;

    const botId = interaction.guild.members.me?.id ?? interaction.client.user.id;


    if (!adminRoleId || !modRoleId) {
      return interaction.editReply('⚠️ Ticket roles are not set. Run `/ticket setup` first (admin_role + mod_role).');
    }

    const typeValue = interaction.values?.[0];
    if (!typeValue) {
      return interaction.editReply('Invalid selection.');
    }

    // Determine which builder this panel belongs to (customId includes builderId)
    const builders = (settings?.tickets?.builders && typeof settings.tickets.builders === 'object' && !Array.isArray(settings.tickets.builders))
      ? settings.tickets.builders
      : {};
    const legacyOptions = settings?.tickets?.panel?.options ?? [];

    const builder = builderId ? builders[builderId] : null;
    const panelOptions = builder?.options ?? legacyOptions;
    const selected = (Array.isArray(panelOptions) ? panelOptions : []).find(o => o.value === typeValue);
    const typeLabel = selected?.label ?? typeValue;

    // One open ticket per user (safe default)
    const existingId = await getOpenTicketChannelId(interaction.guildId, interaction.user.id);
    if (existingId) {
      const existingCh = await interaction.guild.channels.fetch(existingId).catch(() => null);
      if (existingCh) {
        return interaction.editReply(`You already have an open ticket: ${existingCh}`);
      }
      await clearOpenTicketChannelId(interaction.guildId, interaction.user.id);
    }

    // Find/create temp category for this type
    let categoryId = await getCategoryIdForType(interaction.guildId, typeValue);
    let category = categoryId ? await interaction.guild.channels.fetch(categoryId).catch(() => null) : null;

    if (!category || category.type !== ChannelType.GuildCategory) {
      category = await interaction.guild.channels.create({
        name: typeLabel,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
        { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
          { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: adminRoleId, allow: [PermissionFlagsBits.ViewChannel] },
          { id: modRoleId, allow: [PermissionFlagsBits.ViewChannel] },
          { id: botId, allow: [PermissionFlagsBits.ViewChannel] },
        ],
      });

      await setCategoryIdForType(interaction.guildId, typeValue, category.id);
      await markTempCategory(interaction.guildId, category.id);
    }


    // Ensure bot can always view/manage ticket channels even without Administrator
    await category.permissionOverwrites.edit(botId, { ViewChannel: true }).catch(() => {});
    const serial = await nextSerial(interaction.guildId);

    const channel = await interaction.guild.channels.create({
      name: `ticket-${serial}`,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: adminRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
        { id: modRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
      ],
      topic: `Ticket for ${interaction.user.tag} (${interaction.user.id}) | Type: ${typeLabel}`,
      reason: 'Ticket created',
    });

    await setOpenTicketChannelId(interaction.guildId, interaction.user.id, channel.id);

    const now = Date.now();
    await setTicket(interaction.guildId, channel.id, {
      openerId: interaction.user.id,
      messageId: null,
      typeLabel,
      typeValue,
      categoryId: category.id,
      createdAt: now,
      claimedBy: null,
      sla: { openedAt: now },
    });

    const embed = new EmbedBuilder()
      .setTitle(`Ticket: ${typeLabel}`)
      .setDescription(
        'A staff member will claim your ticket soon. Please describe your issue.\n\n' +
        'When the ticket is resolved, staff should run `/ticket-done` to post close/delete controls.',
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticketv2:claim').setLabel('Claim Ticket').setStyle(ButtonStyle.Success),
    );

    const ticketMsg = await channel.send({ content: `${interaction.user}`, embeds: [embed], components: [row] });

    // Persist the first ticket message id so we can edit it for claim attempts
    try {
      const t = await getTicket(interaction.guildId, channel.id);
      await setTicket(interaction.guildId, channel.id, { ...t, messageId: ticketMsg.id });
    } catch {}


    // Auto-claim rotation: ping staff up to 3 times (edits the FIRST ticket message).
    attemptClaim({ guild: interaction.guild, channel, settings, openerId: interaction.user.id, attempt: 1, attemptedIds: [] })
      .catch(() => {});

    return interaction.editReply(`✅ Ticket created: ${channel}`);
  },
};
