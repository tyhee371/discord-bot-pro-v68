const { MessageFlags } = require('discord.js');
const { jumpTo, buildQueuePagePayload, getNowPlaying } = require('../../services/musicService');

module.exports = {
  id: 'musicQueueJump',
  async execute(interaction) {
    const parts = String(interaction.customId).split(':');
    // musicQueueJump:<userId>:<page>
    const expectedUserId = parts[1];
    if (expectedUserId && interaction.user.id !== expectedUserId) {
      return interaction.reply({ content: 'This jump menu is not for you.', flags: MessageFlags.Ephemeral });
    }

    const guildId = interaction.guildId;
    if (!guildId) {
      return interaction.reply({ content: 'This only works in a server.', flags: MessageFlags.Ephemeral });
    }

    const raw = interaction.fields.getTextInputValue('pos');
    const pos = Number(String(raw).trim());

    try {
      await jumpTo(guildId, pos);

      // Show the refreshed first page of queue after jump
      const payload = buildQueuePagePayload(guildId, 0, 10);
      const np = getNowPlaying(guildId);

      return interaction.reply({
        content: `✅ Jumped to **#${pos}**${np?.current?.title ? ` → **${np.current.title}**` : ''}`,
        ...payload,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      return interaction.reply({
        content: `❌ ${err?.message || 'Invalid number.'}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
