const { MessageFlags } = require('discord.js');

/**
 * Safely replies to interactions in this project where InteractionCreate auto-defers.
 * - If already deferred/replied: uses editReply (and strips flags/ephemeral which are not allowed there)
 * - Otherwise: replies (ephemeral by default)
 */
async function replyOrEdit(interaction, payload = {}, { defaultEphemeral = true } = {}) {
  const clean = { ...payload };
  // editReply cannot change ephemeral/flags, so strip them
  delete clean.ephemeral;
  delete clean.flags;

  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(clean);
    }
    const eph = payload.ephemeral ?? defaultEphemeral;
    if (eph) {
      return await interaction.reply({ ...clean, flags: MessageFlags.Ephemeral });
    }
    return await interaction.reply(clean);
  } catch (e) {
    // best-effort fallback so Discord stops "thinking"
    try {
      if (interaction.deferred) return await interaction.editReply({ content: clean.content ?? '✅ Done.' });
      if (interaction.followUp) return await interaction.followUp({ ...clean, flags: MessageFlags.Ephemeral }).catch(() => {});
    } catch {}
  }
}

module.exports = { replyOrEdit };
