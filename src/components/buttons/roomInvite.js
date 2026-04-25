const { MessageFlags } = require('discord.js');
const { requireRoom, canManage } = require('../../utils/roomAuth');

module.exports = {
  id: 'room:invite',
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const res = await requireRoom(interaction);
    if (!res.ok) return interaction.editReply(res.reason);

    const { room, voiceChannel } = res;
    if (!canManage(interaction, room)) return interaction.editReply('Only the room owner (or staff) can do that.');

    const invite = await voiceChannel.createInvite({
      maxAge: 60 * 60,
      maxUses: 0,
      unique: true,
      reason: `Room invite by ${interaction.user.tag}`,
    }).catch(() => null);

    if (!invite) return interaction.editReply('Could not create an invite (missing permission?).');

    return interaction.editReply(`✅ Invite: ${invite.url}`);
  },
};
