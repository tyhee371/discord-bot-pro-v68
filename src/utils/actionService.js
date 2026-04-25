const { EmbedBuilder } = require('discord.js');
const { logger } = require('./logger');

// SFW only. Primary source: waifu.pics (simple: { url: "..." })
async function fetchFromWaifuPics(action) {
  const url = `https://waifu.pics/api/sfw/${encodeURIComponent(action)}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`waifu.pics ${res.status}`);
  const data = await res.json();
  if (!data?.url) throw new Error('waifu.pics missing url');
  return { imageUrl: data.url, source: 'waifu.pics' };
}

// Fallback source: nekos.best v2 (results[0].url)
async function fetchFromNekosBest(action) {
  const url = `https://nekos.best/api/v2/${encodeURIComponent(action)}?amount=1`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`nekos.best ${res.status}`);
  const data = await res.json();
  const first = data?.results?.[0];
  const imageUrl = first?.url;
  if (!imageUrl) throw new Error('nekos.best missing url');
  return { imageUrl, source: 'nekos.best', artist: first?.artist_name, artistUrl: first?.artist_href };
}

async function fetchActionImage(action) {
  // Some actions may not exist on one API; try both.
  try {
    return await fetchFromWaifuPics(action);
  } catch (e) {
    logger.warn({ err: e, action }, '[ACTION] waifu.pics failed; trying nekos.best');
  }
  return await fetchFromNekosBest(action);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const ACTION_TEXT = {
  hug: [
    '💞 {actor} hugs {target} warmly!',
    '🤗 {actor} gives {target} a big hug!',
    '🫂 {actor} pulls {target} into a comfy hug!',
  ],
  kiss: [
    '💋 {actor} kisses {target}!',
    '😘 {actor} gives {target} a sweet kiss!',
    '💞 {actor} kisses {target} softly…',
  ],
  slap: [
    '👋 {actor} slaps {target}!',
    '💥 {actor} delivers a dramatic slap to {target}!',
    '😤 {actor} slaps {target} (oops).',
  ],
  pat: [
    '🐾 {actor} pats {target} gently!',
    '😊 {actor} gives {target} headpats!',
    '✨ {actor} pats {target} and smiles!',
  ],
  cuddle: [
    '🧸 {actor} cuddles {target}!',
    '💖 {actor} snuggles up with {target}!',
    '🥺 {actor} gives {target} a cozy cuddle!',
  ],
  poke: [
    '👉 {actor} pokes {target}!',
    '😅 {actor} pokes {target} to get attention!',
    '🫵 {actor} pokes {target} (poke poke).',
  ],
  bite: [
    '🦷 {actor} bites {target}! (playfully)',
    '😼 {actor} gives {target} a tiny bite!',
    '😳 {actor} nibbles {target}…',
  ],
  tickle: [
    '😂 {actor} tickles {target}!',
    '😆 {actor} tickles {target} until they laugh!',
    '🤣 {actor} attacks {target} with tickles!',
  ],
  wave: [
    '👋 {actor} waves at {target}!',
    '🌟 {actor} says hi to {target}!',
    '😊 {actor} waves happily to {target}!',
  ],
  dance: [
    '💃 {actor} dances with {target}!',
    '🕺 {actor} invites {target} to dance!',
    '🎶 {actor} dances like nobody’s watching (with {target})!',
  ],
  blush: [
    '😳 {actor} blushes at {target}!',
    '🥰 {actor} gets shy around {target}!',
    '😳 {actor} can’t stop blushing at {target}…',
  ],
  cry: [
    '😭 {actor} cries with {target}…',
    '😢 {actor} is crying… {target} pls help!',
    '🥺 {actor} tears up…',
  ],
  smile: [
    '😊 {actor} smiles at {target}!',
    '😁 {actor} gives {target} a big smile!',
    '✨ {actor} smiles brightly!',
  ],
};

function displayName(user) {
  return user?.username ? `**${user.username}**` : '**Someone**';
}

function resolveTargets(actorUser, targetUser) {
  const actor = displayName(actorUser);
  let target = displayName(targetUser);
  if (!targetUser) target = `${actor}self…`;
  if (targetUser?.id === actorUser?.id) target = `${actor}self…`;
  return { actor, target };
}

async function buildActionEmbed({ action, actorUser, targetUser, guild }) {
  const { actor, target } = resolveTargets(actorUser, targetUser);
  const lines = ACTION_TEXT[action] || ['✨ {actor} does something to {target}!'];
  const text = pick(lines).replace('{actor}', actor).replace('{target}', target);

  const fetched = await fetchActionImage(action).catch((e) => {
    logger.warn({ err: e, action }, '[ACTION] fetchActionImage failed');
    return null;
  });

  const emb = new EmbedBuilder()
    .setDescription(text)
    .setFooter({ text: guild?.name || 'Action' });

  if (fetched?.imageUrl) emb.setImage(fetched.imageUrl);
  if (fetched?.artist) {
    emb.addFields({ name: 'Credit', value: fetched.artistUrl ? `[${fetched.artist}](${fetched.artistUrl})` : fetched.artist, inline: true });
  }

  return emb;
}

module.exports = { buildActionEmbed };
