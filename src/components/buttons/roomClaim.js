const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { getRoom, setRoom } = require('../../services/tempRoomService');
const { refreshRoomPanel } = require('../../utils/roomPanelService');

module.exports = {
  id: 'room:claim',
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const parts = String(interaction.customId).split(':');
    const voiceId = parts[2];
    if (!voiceId) return interaction.editReply('Room not found (expired).');

    const room = await getRoom(interaction.guildId, voiceId);
    if (!room) return interaction.editReply('Room not found (expired).');

    const voiceChannel = await interaction.guild.channels.fetch(voiceId).catch(() => null);
    if (!voiceChannel) return interaction.editReply('Room channel no longer exists.');

    // Must be inside the room to claim
    const member = interaction.member;
    if (!member?.voice?.channelId || member.voice.channelId !== voiceId) {
      return interaction.editReply('You must be inside this room to claim ownership.');
    }

    const ownerId = room.ownerId;
    const ownerIsInRoom = voiceChannel.members?.has(ownerId);

    // If owner is connected, don't allow claim
    if (ownerIsInRoom) {
      // Also update the claim message (if any) to show owner is back
      try {
        if (room.ownerClaimMessageId) {
          const embed = {
            title: 'Room owner reconnected',
            description: `Owner: <@${ownerId}>\nRoom: <#${voiceId}>\n\nOwner is back in the room. Claim is not available right now.`,
          };

          const payload = { embeds: [embed], components: interaction.message?.components ?? [] };
          await interaction.message.edit(payload).catch(() => {});
        }
      } catch {}
      return interaction.editReply('Owner is connected again. You cannot claim this room right now.');
    }

    // Transfer ownership to claimer
    const newOwnerId = interaction.user.id;

    // Ensure new owner can manage
    await voiceChannel.permissionOverwrites.edit(newOwnerId, {
      ViewChannel: true,
      Connect: true,
      Speak: true,
      ManageChannels: true,
      MoveMembers: true,
      MuteMembers: true,
      DeafenMembers: true,
    }).catch(() => {});

    // Reduce old owner's manage perms (keep access)
    if (ownerId && ownerId !== newOwnerId) {
      await voiceChannel.permissionOverwrites.edit(ownerId, {
        ManageChannels: false,
        MoveMembers: false,
        MuteMembers: false,
        DeafenMembers: false,
      }).catch(() => {});
    }

    room.ownerId = newOwnerId;
    room.ownerDisconnectedAt = null;

    // Mark claim message as resolved by editing it and removing the button
    try {
      if (room.ownerClaimMessageId && interaction.message?.id === room.ownerClaimMessageId) {
        await interaction.message.edit({
          embeds: [
            {
              title: 'Ownership claimed',
              description: `New owner: <@${newOwnerId}>\nRoom: <#${voiceId}>`,
            },
          ],
          components: [],
        }).catch(() => {});
      }
    } catch {}

    room.ownerClaimMessageId = null;
    await setRoom(interaction.guildId, voiceId, room);

    // Refresh control panel (owner perms, etc.)
    await refreshRoomPanel(interaction.guild, voiceChannel, room).catch(() => {});

    return interaction.editReply(`👑 You are now the owner of <#${voiceId}>.`);
  },
};
