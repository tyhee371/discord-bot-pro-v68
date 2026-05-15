const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

function regionLabel(rtcRegion) {
  if (!rtcRegion) return 'Auto';
  return rtcRegion;
}

function buildRoomEmbed({ channel, room }) {
  return new EmbedBuilder()
    .setTitle('Room Controls')
    .setDescription(
      [
        `**Channel:** ${channel}`,
        `**Owner:** <@${room.ownerId}>`,
        `**Private (locked):** ${room.isLocked ? 'Yes' : 'No'}`,
        `**Ghost (hidden):** ${room.isHidden ? 'Yes' : 'No'}`,
        `**Region:** ${regionLabel(room.rtcRegion)}`,
        `**User limit:** ${room.userLimit || 0}`,
        `**Bitrate:** ${channel.bitrate ?? 'default'}`,
      ].join('\n'),
    )
    .setFooter({ text: 'Use the buttons below to manage this room.' });
}

function buildRoomButtons() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('room:lock').setLabel('Private / Unlock').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('room:ghost').setLabel('Ghost / Show').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('room:edit').setLabel('Edit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('room:region').setLabel('Region').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('room:invite').setLabel('Invite').setStyle(ButtonStyle.Success),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('room:kick').setLabel('Kick').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('room:ban').setLabel('Ban').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('room:permit').setLabel('Permit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('room:transfer').setLabel('Change Owner').setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2];
}

module.exports = { buildRoomEmbed, buildRoomButtons };
