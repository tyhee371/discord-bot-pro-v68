const { MessageFlags } = require('discord.js');

/**
 * One-rule interaction helpers:
 * - You may call safeDefer / safeReply from anywhere, any time, without worrying about "already replied".
 * - If interaction is deferred/replied, safeReply will editReply.
 * - If not, safeReply will reply.
 */
async function safeDefer(interaction, opts = {}) {
  if (!interaction || interaction.deferred || interaction.replied) return false;

  const ephemeral = Boolean(opts.ephemeral);
  try {
    const deferOpts = ephemeral ? { flags: MessageFlags.Ephemeral } : {};
    await interaction.deferReply(deferOpts);
    return true;
  } catch {
    return false;
  }
}

function _cleanForEdit(payload) {
  const clean = { ...payload };
  // discord.js forbids changing ephemeral/flags after deferring
  delete clean.ephemeral;
  delete clean.flags;
  return clean;
}

async function safeReply(interaction, payload = {}) {
  if (!interaction) return null;

  const wantsEphemeral = Boolean(payload.ephemeral);
  const p = { ...payload };
  delete p.ephemeral;

  if (wantsEphemeral && !p.flags) p.flags = MessageFlags.Ephemeral;

  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(_cleanForEdit(p));
    }
    return await interaction.reply(p);
  } catch (err) {
    // fallback: try followUp if possible
    try {
      if (interaction.followUp) {
        const fp = interaction.deferred || interaction.replied ? _cleanForEdit(p) : p;
        return await interaction.followUp(fp);
      }
    } catch {}
    return null;
  }
}

async function safeUpdate(interaction, payload = {}) {
  // For buttons/menus: prefer update(); if that fails, deferUpdate() then editReply().
  // This is especially helpful for ephemeral component messages where update() can fail in some cases.
  if (!interaction) return null;

  try {
    if (!interaction.deferred && !interaction.replied) {
      return await interaction.update(payload);
    }
  } catch {}

  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }
  } catch {}

  // If this is a component interaction, editing the message directly is often the most reliable.
  // (Some ephemeral component interactions can fail with update()/editReply() depending on context.)
  try {
    if (interaction.message && typeof interaction.message.edit === 'function') {
      return await interaction.message.edit(_cleanForEdit(payload));
    }
  } catch {}

  try {
    return await interaction.editReply(_cleanForEdit(payload));
  } catch {}

  return null;
}
module.exports = { safeDefer, safeReply, safeUpdate };
