const { safeReply, safeUpdate } = require('../../utils/safeReply');

// This bot previously shipped an interactive /help UI (select menu + paging buttons).
// The help system has been simplified to non-interactive, multi-embed output.
// This component remains only to gracefully handle interactions on old messages.

module.exports = {
  id: 'help',
  async execute(interaction) {
    const msg = 'This help menu has been updated. Please run **/help** again.';

    // Try to replace the old interactive message if possible.
    if (interaction.isMessageComponent?.()) {
      try {
        await safeUpdate(interaction, { content: msg, embeds: [], components: [] });
        return;
      } catch {
        // fall through to ephemeral reply
      }
    }

    return safeReply(interaction, { ephemeral: true, content: msg });
  },
};
