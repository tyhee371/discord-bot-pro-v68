/**
 * Music command handler (prefix)
 * Handles: play/p, join/j, now/np, queue/q, skip, pause, resume, stop, loop, 247, leave, music <sub>
 */

const { isStaff } = require('../../../utils/isStaff');
const {
  enqueueAndMaybePlay,
  connectOnly,
  getConnectedChannelId,
  skip,
  pause,
  resume,
  stop,
  buildNowPlayingPayload,
  buildQueuePagePayload,
  setLoopMode,
  cycleLoopMode,
  jumpTo,
  set247,
  leave,
} = require('../../../services/musicService');

const musicDirectAliases = new Map([
  ['play', 'play'], ['p', 'play'],
  ['join', 'join'], ['j', 'join'],
  ['now', 'now'], ['np', 'now'],
  ['queue', 'queue'], ['q', 'queue'],
  ['skip', 'skip'],
  ['pause', 'pause'],
  ['resume', 'resume'],
  ['stop', 'stop'],
  ['loop', 'loop'],
  ['247', '247'],
  ['leave', 'leave'],
]);

const musicDirectCommands = new Set(Array.from(musicDirectAliases.keys()));

async function handleMusicCommand(message, rawAction, args, settings) {
  const command = musicDirectAliases.get(rawAction) ?? rawAction;

  const voiceChannel = message.member?.voice?.channel;
  const inUse = getConnectedChannelId(message.guild.id);
  const me = await message.guild.members.fetchMe().catch(() => message.guild.members.me);
  const needed = ['ViewChannel', 'Connect', 'Speak'];
  const missingPerms = voiceChannel
    ? needed.filter((p) => !voiceChannel.permissionsFor(me)?.has(p))
    : needed;

  if (command === 'join') {
    if (!voiceChannel) {
      await message.reply('❌ You are not in a voice channel. Join one first.').catch(() => {});
      return true;
    }
    if (inUse && inUse !== voiceChannel.id) {
      await message.reply(`🔒 Already in use in <#${inUse}>.`).catch(() => {});
      return true;
    }
    if (missingPerms.length) {
      await message
        .reply(
          `❌ I can't join ${voiceChannel}. Missing: **${missingPerms.join(', ')}**. Please allow **View Channel / Connect / Speak** for me in that channel.`,
        )
        .catch(() => {});
      return true;
    }
    try {
      await connectOnly({
        client: message.client,
        guild: message.guild,
        voiceChannel,
        textChannelId: message.channel?.id ?? message.channelId,
        setAnnounceChannel: true,
      });
      await message.reply(`✅ Joined ${voiceChannel}.`).catch(() => {});
    } catch {
      await message.reply('Could not join that voice channel.').catch(() => {});
    }
    return true;
  }

  if (command === 'play') {
    const query = args.join(' ');
    if (!query) {
      await message.reply('Please provide a song name or URL.').catch(() => {});
      return true;
    }
    if (!voiceChannel) {
      await message.reply('❌ You are not in a voice channel. Join one first, then try again.').catch(() => {});
      return true;
    }
    if (inUse && inUse !== voiceChannel.id) {
      await message.reply(`🔒 Already in use in <#${inUse}>.`).catch(() => {});
      return true;
    }
    if (missingPerms.length) {
      await message
        .reply(
          `❌ I can't join ${voiceChannel}. Missing: **${missingPerms.join(', ')}**. Please allow **View Channel / Connect / Speak** for me in that channel.`,
        )
        .catch(() => {});
      return true;
    }
    try {
      const { tracksAdded } = await enqueueAndMaybePlay({
        client: message.client,
        guild: message.guild,
        voiceChannel,
        textChannelId: message.channel?.id ?? message.channelId,
        setAnnounceChannel: true,
        query,
        requestedBy: { id: message.author.id, tag: message.author.tag },
      });
      await message.reply(`✅ Added **${tracksAdded}** track(s) to the queue.`).catch(() => {});
    } catch {
      await message.reply('Could not play that. Try a different link or search.').catch(() => {});
    }
    return true;
  }

  if (command === 'now') {
    const payload = buildNowPlayingPayload(message.guild.id);
    await message.channel.send(payload).catch(() => {});
    return true;
  }

  if (command === 'queue') {
    const page = args[0] ? Math.max(0, Number(args[0]) - 1) : 0;
    const payload = buildQueuePagePayload(message.guild.id, page, 10);
    await message.channel.send(payload).catch(() => {});
    return true;
  }

  if (command === 'skip') {
    const n = args[0] ? Number(args[0]) : null;
    if (n && Number.isFinite(n) && n > 0) {
      try {
        await jumpTo(message.guild.id, n);
        await message.reply(`⏭️ Jumped to queue position **${n}**.`).catch(() => {});
      } catch (e) {
        await message.reply(`Could not jump. ${e?.message ? `(${e.message})` : ''}`).catch(() => {});
      }
      return true;
    }
    const ok = await skip(message.guild.id);
    await message.reply(ok ? '⏭️ Skipped.' : 'Nothing to skip.').catch(() => {});
    return true;
  }

  if (command === 'pause') {
    const ok = pause(message.guild.id);
    await message.reply(ok ? '⏸️ Paused.' : 'Nothing to pause.').catch(() => {});
    return true;
  }

  if (command === 'resume') {
    const ok = resume(message.guild.id);
    await message.reply(ok ? '▶️ Resumed.' : 'Nothing to resume.').catch(() => {});
    return true;
  }

  if (command === 'stop') {
    await stop(message.guild.id);
    await message.reply('🛑 Stopped.').catch(() => {});
    return true;
  }

  if (command === 'loop') {
    const mode = (args[0] || '').toLowerCase();
    try {
      const next = mode ? setLoopMode(message.guild.id, mode) : cycleLoopMode(message.guild.id);
      await message.reply(`🔁 Loop mode: **${next}**`).catch(() => {});
    } catch (e) {
      await message
        .reply(`Could not set loop mode. ${e?.message ? `(${e.message})` : ''}`)
        .catch(() => {});
    }
    return true;
  }

  if (command === '247') {
    // Match slash command behaviour exactly
    if (!isStaff(message.guild, message.member, settings)) {
      await message.reply('Only Admin/Mods can toggle 24/7 mode.').catch(() => {});
      return true;
    }

    const memberVc = message.member?.voice?.channel;
    if (!memberVc) {
      await message.reply('Join the voice channel you want the bot to stay in, then run this.').catch(() => {});
      return true;
    }

    const mode = (args[0] || '').toLowerCase();
    let enabled;
    if (mode === 'on' || mode === 'true' || mode === 'yes') enabled = true;
    else if (mode === 'off' || mode === 'false' || mode === 'no') enabled = false;
    else enabled = true;

    // Connect the bot to the voice channel (same as slash command)
    await connectOnly({ guild: message.guild, voiceChannel: memberVc, textChannelId: message.channelId, setAnnounceChannel: false }).catch(() => {});
    await set247(message.guild.id, enabled);

    await message.reply(
      enabled
        ? '✅ 24/7 mode enabled. Bot will stay in voice until kicked or the channel is deleted.'
        : '✅ 24/7 mode disabled. Bot may leave when idle.'
    ).catch(() => {});
    return true;
  }

  if (command === 'leave') {
    if (!isStaff(message.guild, message.member, settings)) {
      await message.reply('❌ Only Admin/Mods can disconnect the bot.').catch(() => {});
      return true;
    }
    await leave(message.guild.id, 'Leave (prefix command)');
    await message.reply('👋 Left the voice channel.').catch(() => {});
    return true;
  }

  return false;
}

/**
 * Handle `!music <subcommand> [args]` — legacy fallback form
 */
async function handleMusicSubcommand(message, args, prefix, settings) {
  const sub = (args.shift() || '').toLowerCase();
  if (!sub) {
    await message
      .reply(
        `Usage: \`${prefix}play <query>\`, \`${prefix}skip [number]\`, \`${prefix}queue [page]\`, \`${prefix}now\`, \`${prefix}pause\`, \`${prefix}resume\`, \`${prefix}stop\`, \`${prefix}loop [off|track|queue]\`, \`${prefix}247 on|off\`, \`${prefix}leave\``,
      )
      .catch(() => {});
    return true;
  }
  return handleMusicCommand(message, sub, args, settings);
}

module.exports = {
  musicDirectCommands,
  musicDirectAliases,
  handleMusicCommand,
  handleMusicSubcommand,
};
