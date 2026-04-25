const { MessageFlags, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { requireRoom, canManage } = require('../../utils/roomAuth');

const REGIONS = [
  { label: 'Auto', value: 'auto' },
  { label: 'US East', value: 'us-east' },
  { label: 'US West', value: 'us-west' },
  { label: 'US Central', value: 'us-central' },
  { label: 'Brazil', value: 'brazil' },
  { label: 'Europe', value: 'europe' },
  { label: 'Rotterdam', value: 'rotterdam' },
  { label: 'Singapore', value: 'singapore' },
  { label: 'Sydney', value: 'sydney' },
  { label: 'Japan', value: 'japan' },
  { label: 'Hong Kong', value: 'hongkong' },
  { label: 'India', value: 'india' },
  { label: 'South Africa', value: 'southafrica' },
];

module.exports = {
  id: 'room:region',
  async execute(interaction) {
    const res = await requireRoom(interaction);
    if (!res.ok) return interaction.reply({ content: res.reason, flags: MessageFlags.Ephemeral });

    const { room, voiceChannel } = res;
    if (!canManage(interaction, room)) {
      return interaction.reply({ content: 'Only the room owner (or staff) can do that.', flags: MessageFlags.Ephemeral });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`roomRegion:${voiceChannel.id}`)
      .setPlaceholder('Select a region override')
      .addOptions(REGIONS);

    const row = new ActionRowBuilder().addComponents(menu);

    return interaction.reply({
      content: 'Choose a region for this room:',
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  },
};
