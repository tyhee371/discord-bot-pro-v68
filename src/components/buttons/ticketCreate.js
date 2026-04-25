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
const { getOpenTicketChannelId, setOpenTicketChannelId, safeChannelName } = require('../../services/ticketService');
const { setTicket } = require('../../services/ticketService');

module.exports = {
  id: 'ticket:create',

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const settings = await getGuildSettings(interaction.guildId);
    const cfg = settings?.tickets;

    if (!cfg?.categoryId || !cfg?.supportRoleId) {
      return interaction.editReply('Ticket system isn’t configured. Run `/ticket setup`.');
    }

    const existingChannelId = await getOpenTicketChannelId(interaction.guildId, interaction.user.id);
    if (existingChannelId) {
      const ch = await interaction.guild.channels.fetch(existingChannelId).catch(() => null);
      if (ch) return interaction.editReply(`You already have an open ticket: ${ch}`);
    }

    const category = await interaction.guild.channels.fetch(cfg.categoryId);
    const supportRoleId = cfg.supportRoleId;

    const channel = await interaction.guild.channels.create({
      name: safeChannelName(interaction.user.username),
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Ticket | ownerId=${interaction.user.id}`,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: supportRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
          ],
        },
      ],
      reason: `Ticket created by ${interaction.user.tag}`,
    });

    await setOpenTicketChannelId(interaction.guildId, interaction.user.id, channel.id);

    await setTicket(interaction.guildId, channel.id, {
      ownerId: interaction.user.id,
      supportRoleId,
      status: 'open',
      createdAt: Date.now(),
    });

    const embed = new EmbedBuilder()
      .setTitle('Ticket Created')
      .setDescription(`Hello ${interaction.user}!\nDescribe your issue and a supporter will help you soon.`);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:claim').setLabel('Claim').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setStyle(ButtonStyle.Danger),
    );

    await channel.send({
      content: `<@&${supportRoleId}> ${interaction.user}`,
      embeds: [embed],
      components: [row],
    });

    return interaction.editReply(`✅ Ticket created: ${channel}`);
  },
};
