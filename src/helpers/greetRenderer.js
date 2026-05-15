const { EmbedBuilder } = require('discord.js');
const { applyPlaceholders } = require('./placeholders');

function parseColor(input) {
  if (!input) return null;
  // allow "ff0000" or "#ff0000"
  const hex = input.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return parseInt(hex, 16);
}

/**
 * settings.greet example:
 * {
 *   enabled: true,
 *   channelId: "123",
 *   message: "Welcome {user} ...",
 *   embed: {
 *     enabled: true,
 *     title: "...",
 *     description: "...",
 *     color: "#5865F2",
 *     thumbnail: "url",
 *     image: "url"
 *   }
 * }
 */
function renderGreetPayload(settings, member) {
  const greet = settings?.greet;
  if (!greet?.enabled) return null;

  const content = greet.message
    ? applyPlaceholders(greet.message, member)
    : null;

  const embeds = [];

  const e = greet.embed;
  if (e?.enabled) {
    const embed = new EmbedBuilder();

    if (e.title) embed.setTitle(applyPlaceholders(e.title, member));
    if (e.description) embed.setDescription(applyPlaceholders(e.description, member));

    const color = parseColor(e.color);
    if (color !== null) embed.setColor(color);

    if (e.thumbnail) embed.setThumbnail(applyPlaceholders(e.thumbnail, member));
    if (e.image) embed.setImage(applyPlaceholders(e.image, member));

    embeds.push(embed);
  }

  // If both are empty, return null
  if (!content && embeds.length === 0) return null;

  return { content: content ?? undefined, embeds };
}

module.exports = { renderGreetPayload };
