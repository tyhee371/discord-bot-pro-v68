
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildSettings } = require('../../utils/settings');
const { isStaff } = require('../../utils/isStaff');
const {
  connectOnly,
  enqueueAndMaybePlay,
  getNowPlaying,
  skip,
  jumpTo,
  stop,
  pause,
  resume,
  set247,
  leave,
  setLoopMode,
  cycleLoopMode,
  getConnectedChannelId,
  buildNowPlayingPayload,
  buildQueuePagePayload,
} = require('../../services/musicService');


function missingVoicePerms(voiceChannel, me) {
  try {
    const perms = voiceChannel.permissionsFor(me);
    const need = ['ViewChannel', 'Connect', 'Speak'];
    const missing = need.filter((p) => !perms?.has?.(p));
    return missing;
  } catch {
    return ['ViewChannel', 'Connect', 'Speak'];
  }
}

function formatDuration(sec) {
  if (!sec || !Number.isFinite(sec)) return '??';
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Music player')
    .addSubcommand((s) =>
      s
        .setName('play')
        .setDescription('Play or queue a song (YouTube search/URL)')
        .addStringOption((o) => o.setName('query').setDescription('Song name or URL').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('now').setDescription('Show what is playing'))
    .addSubcommand((s) => s.setName('queue').setDescription('Show the queue')
        .addIntegerOption(o => o.setName('page').setDescription('Page number').setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName('loop')
        .setDescription('Set or view loop mode')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('Loop mode')
            .setRequired(false)
            .addChoices(
              { name: 'Off', value: 'off' },
              { name: 'Track', value: 'track' },
              { name: 'Queue', value: 'queue' },
            ),
        ),
    )
    .addSubcommand((s) => s.setName('skip').setDescription('Skip current track or jump to a position in the queue')
        .addIntegerOption(o => o.setName('position').setDescription('Queue position (1 = next track)').setRequired(false))
    )
    .addSubcommand((s) => s.setName('pause').setDescription('Pause playback'))
    .addSubcommand((s) => s.setName('resume').setDescription('Resume playback'))
    .addSubcommand((s) => s.setName('stop').setDescription('Stop and clear the queue'))
    .addSubcommand((s) =>
      s
        .setName('247')
        .setDescription('Toggle 24/7 mode (stay connected even when alone)')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('on/off')
            .setRequired(true)
            .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }),
        ),
    )
    .addSubcommand((s) => s.setName('join').setDescription('Join your voice channel'))
    .addSubcommand((s) => s.setName('leave').setDescription('Disconnect the bot from voice')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (!guild) return interaction.editReply('This command can only be used in a server.');

    const settings = await getGuildSettings(guild.id);

    if (sub === 'now') {
  const payload = buildNowPlayingPayload(guild.id);
  if (!payload) return interaction.editReply('Nothing is playing right now.');
  return interaction.editReply(payload);
}

    if (sub === 'queue') {
  const pageInput = interaction.options.getInteger('page') ?? 1;
  const page0 = Math.max(0, Number(pageInput) - 1);
  const payload = buildQueuePagePayload(guild.id, page0, 10);
  return interaction.editReply(payload);
}


    // Voice-required actions
    const memberVc = interaction.member?.voice?.channel ?? null;

    if (sub === 'play') {
      if (!memberVc) {
        return interaction.editReply('❌ You are not in a voice channel. Join one first, then try again.');
      }

      const inUse = getConnectedChannelId(guild.id);
      if (inUse && inUse !== memberVc.id) {
        return interaction.editReply(`🔒 Already in use in <#${inUse}>.`);
      }

      const me = await guild.members.fetchMe().catch(() => guild.members.me);
      const missing = missingVoicePerms(memberVc, me);
      if (missing.length) {
        return interaction.editReply(
          `❌ I can’t join ${memberVc}. Missing permissions: **${missing.join(', ')}**.
Please allow **View Channel / Connect / Speak** for me in that channel.`,
        );
      }

      const query = interaction.options.getString('query', true);

      try {
        const { firstTrack, tracksAdded, state } = await enqueueAndMaybePlay({
          client: interaction.client,

          guild,
          voiceChannel: memberVc,
          textChannelId: (interaction.channel?.id ?? interaction.channelId),
          setAnnounceChannel: true,
          query,
          requestedBy: { id: interaction.user.id, tag: interaction.user.tag },
        });

        const title =
          tracksAdded > 1
            ? `Added ${tracksAdded} tracks`
            : state.current && firstTrack && state.current.url === firstTrack.url
              ? 'Now Playing'
              : 'Added to Queue';

        const emb = new EmbedBuilder()
          .setTitle(title)
          .setDescription(firstTrack ? `[${firstTrack.title}](${firstTrack.url})` : 'Queued.')
          .setFooter({ text: `24/7: ${state.stay247 ? 'On' : 'Off'} | Volume: ${state.volume}` });

        const meAfter = await guild.members.fetchMe().catch(() => guild.members.me);
        const flags = [];
        if (meAfter?.voice?.serverMute) flags.push('server-muted');
        if (meAfter?.voice?.serverDeaf) flags.push('server-deafened');
        if (meAfter?.voice?.suppress) flags.push('suppressed');
        if (flags.length) {
          emb.addFields({
            name: 'Voice Output Warning',
            value: `I am currently **${flags.join(', ')}**, so audio may be silent. Please unsuppress/unmute the bot in voice channel settings.`,
          });
        }

        return interaction.editReply({ embeds: [emb] });
      } catch (e) {
        console.error('[MUSIC] play error:', e);
        const msg = e?.message || String(e);
        // Truncate long error messages (yt-dlp can produce verbose output)
        const short = msg.length > 300 ? msg.slice(0, 300) + '...' : msg;
        return interaction.editReply(`❌ Could not play that track.\n\`\`\`${short}\`\`\``);
      }
    }

    if (sub === 'skip') {
  const pos = interaction.options.getInteger('position');
  if (pos && pos > 0) {
    try {
      await jumpTo(guild.id, pos);
      return interaction.editReply(`⏭️ Jumped to queue position **${pos}**.`);
    } catch (e) {
      return interaction.editReply(`Could not jump. ${e?.message ? `(${e.message})` : ''}`);
    }
  }
  const ok = await skip(guild.id);
  return interaction.editReply(ok ? '⏭️ Skipped.' : 'Nothing to skip.');
}


    if (sub === 'pause') {
      const ok = pause(guild.id);
      return interaction.editReply(ok ? '⏸️ Paused.' : 'Nothing is playing.');
    }

    if (sub === 'resume') {
      const ok = resume(guild.id);
      return interaction.editReply(ok ? '▶️ Resumed.' : 'Nothing is playing.');
    }
if (sub === 'loop') {
  const mode = interaction.options.getString('mode');
  try {
    const next = mode ? setLoopMode(guild.id, mode) : cycleLoopMode(guild.id);
    return interaction.editReply(`🔁 Loop mode: **${next}**.`);
  } catch (e) {
    return interaction.editReply(`Could not set loop mode. ${e?.message ? `(${e.message})` : ''}`);
  }
}



    if (sub === 'stop') {
      const ok = await stop(guild.id);
      return interaction.editReply(ok ? '⏹️ Stopped and cleared queue.' : 'Nothing to stop.');
    }

    if (sub === '247') {
      // Staff-only toggle (recommended)
      if (!isStaff(interaction.member, settings)) {
        return interaction.editReply('Only Admin/Mods can toggle 24/7 mode.');
      }
      if (!memberVc) return interaction.editReply('Join the voice channel you want the bot to stay in, then run this.');

      const mode = interaction.options.getString('mode', true);
      const enabled = mode === 'on';

      const { connectOnly } = require('../../services/musicService');
      await connectOnly({ guild, voiceChannel: memberVc, textChannelId: interaction.channelId, setAnnounceChannel: false });
      await set247(guild.id, enabled);

      return interaction.editReply(
        enabled
          ? '✅ 24/7 mode enabled. Bot will stay in voice until kicked or the channel is deleted.'
          : '✅ 24/7 mode disabled. Bot may leave when idle.',
      );
    }

if (sub === 'join') {
  if (!memberVc) {
    return interaction.editReply('❌ You are not in a voice channel. Join one first, then run this again.');
  }

  const inUse = getConnectedChannelId(guild.id);
  if (inUse && inUse !== memberVc.id) {
    return interaction.editReply(`🔒 Already in use in <#${inUse}>.`);
  }

  const me = await guild.members.fetchMe().catch(() => guild.members.me);
  const missing = missingVoicePerms(memberVc, me);
  if (missing.length) {
    return interaction.editReply(
      `❌ I can’t join ${memberVc}. Missing permissions: **${missing.join(', ')}**.\nPlease allow **View Channel / Connect / Speak** for me in that channel.`,
    );
  }

  await connectOnly({
    client: interaction.client,
    guild,
    voiceChannel: memberVc,
    textChannelId: (interaction.channel?.id ?? interaction.channelId),
    setAnnounceChannel: true,
  });

  return interaction.editReply(`✅ Joined ${memberVc}.`);
}

    if (sub === 'leave') {
      // Staff-only leave (recommended)
      if (!isStaff(interaction.member, settings)) {
        return interaction.editReply('Only Admin/Mods can disconnect the bot.');
      }
      await leave(guild.id, 'Manual leave');
      return interaction.editReply('👋 Disconnected.');
    }

    return interaction.editReply('Unknown subcommand.');
  },
};
