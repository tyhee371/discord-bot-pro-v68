const { MessageFlags } = require('discord.js');
const { safeDefer, safeReply } = require('../../utils/safeReply');
const { runInteractionGuards } = require('../../shared/guards/guardPipeline');
const { getPublicMessage } = require('../../shared/errors');
const { handlePrefixMessage: handlePrefixRoute } = require('../prefix/prefixRouter');
const { reportInteractionError, reportSafeModeDisabled } = require('../../utils/errorReporter');
const { recordFailure } = require('../../utils/safeMode');
const { metrics } = require('../../utils/metrics');

async function handleInteraction(client, interaction) {
  if (!interaction?.isChatInputCommand?.()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  const guard = await runInteractionGuards({ interaction, command, client });
  if (!guard.ok) return;

  const shouldDefer = command.defer !== false && command.usesModal !== true;
  if (shouldDefer) {
    await safeDefer(interaction, { ephemeral: Boolean(command.ephemeral) });
  }

  try {
    await command.execute(interaction, client);
    metrics.increment('commands.executed', { command: interaction.commandName });
    metrics.rate('commands.slash');
  } catch (err) {
    const guildId = interaction.guildId;
    try {
      if (guildId) {
        const name = interaction.commandName;
        const safeRes = await recordFailure(guildId, 'slash', name);
        if (safeRes.enabled && safeRes.disabledNow && safeRes.disabledUntil) {
          await reportSafeModeDisabled(interaction, 'slash', name, safeRes.disabledUntil, err);
        }
      }
    } catch (_) {
      // ignore safe mode record failures
    }

    await reportInteractionError(interaction, err, interaction.commandName).catch(() => {});

    const safeMessage = getPublicMessage(err);
    if (interaction.isRepliable?.()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: safeMessage, flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        await safeReply(interaction, { content: safeMessage, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  }
}

async function handlePrefixMessage(client, message) {
  return handlePrefixRoute({ client, message });
}

module.exports = {
  handleInteraction,
  handlePrefixMessage,
};