const { MessageFlags } = require('discord.js');
const {
  pause,
  resume,
  skip,
  stop,
  buildQueuePagePayload,
  buildNowPlayingPayload,
  cycleLoopMode,
  getNowPlaying,
} = require('../../services/musicService');

module.exports = {
  id: 'music',
  async execute(interaction) {
    const parts = String(interaction.customId).split(':');
    // customId formats:
    // music:toggle
    // music:skip
    // music:stop
    // music:loop
    // music:queue:page:<n>
    // music:queue:close
    const action = parts[1] ?? '';

    const guildId = interaction.guildId;
    if (!guildId) {
      return interaction.reply({ content: 'This only works in a server.', flags: MessageFlags.Ephemeral });
    }

    try {
      if (action === 'toggle') {
        const state = getNowPlaying(guildId);
        const isPaused = Boolean(state?.paused);
        if (isPaused) {
          const ok = resume(guildId);
          return interaction.reply({ content: ok ? '▶️ Resumed.' : 'Nothing to resume.', flags: MessageFlags.Ephemeral });
        }
        const ok = pause(guildId);
        return interaction.reply({ content: ok ? '⏸️ Paused.' : 'Nothing to pause.', flags: MessageFlags.Ephemeral });
      }

      if (action === 'skip') {
        const ok = await skip(guildId);
        return interaction.reply({ content: ok ? '⏭️ Skipped.' : 'Nothing to skip.', flags: MessageFlags.Ephemeral });
      }

      if (action === 'stop') {
        await stop(guildId);
        return interaction.reply({ content: '🛑 Stopped.', flags: MessageFlags.Ephemeral });
      }

      if (action === 'loop') {
        const mode = cycleLoopMode(guildId);
        return interaction.reply({ content: `🔁 Loop mode: **${mode}**`, flags: MessageFlags.Ephemeral });
      }

      if (action === 'queue') {
        const sub = parts[2] ?? '';
        if (sub === 'close') {
          // close the queue message (if possible)
          if (interaction.message) {
            return interaction.update({ content: 'Closed.', embeds: [], components: [] }).catch(() =>
              interaction.reply({ content: 'Closed.', flags: MessageFlags.Ephemeral }),
            );
          }
          return interaction.reply({ content: 'Closed.', flags: MessageFlags.Ephemeral });
        }

        
if (sub === 'jump') {
  const page = Number(parts[3] ?? 0);
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

  const modal = new ModalBuilder()
    .setCustomId(`musicQueueJump:${interaction.user.id}:${page}`)
    .setTitle('Jump to song number');

  const input = new TextInputBuilder()
    .setCustomId('pos')
    .setLabel('Song number in queue')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Example: 15')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

if (sub === 'page') {
          const page = Number(parts[3] ?? 0);
          const payload = buildQueuePagePayload(guildId, page, 10);

          const isQueueMsg = interaction.message?.embeds?.[0]?.title === 'Queue';
          if (isQueueMsg) {
            return interaction.update(payload).catch(() =>
              interaction.reply({ content: 'Could not update queue.', flags: MessageFlags.Ephemeral }),
            );
          }

          // Open queue view as ephemeral (do NOT edit now playing message)
          return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
        }
      }

      // fallback: update now playing panel
      const payload = buildNowPlayingPayload(guildId);
      if (!payload) return interaction.reply({ content: 'Nothing is playing right now.', flags: MessageFlags.Ephemeral });
      return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    } catch (err) {
      console.error('[MUSIC BUTTON] error:', err);
      return interaction.reply({ content: 'Something went wrong.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  },
};
