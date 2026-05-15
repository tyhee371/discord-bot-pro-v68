/**
 * Fun action command handler (prefix)
 * Handles: hug, kiss, slap, pat, cuddle, poke, bite, tickle, wave, dance, blush, cry, smile
 */

const { buildActionEmbed } = require('../../../utils/actionService');

const actionAliases = new Map([
  ['hug', 'hug'], ['h', 'hug'],
  ['kiss', 'kiss'], ['k', 'kiss'],
  ['slap', 'slap'],
  ['pat', 'pat'],
  ['cuddle', 'cuddle'],
  ['poke', 'poke'],
  ['bite', 'bite'],
  ['tickle', 'tickle'],
  ['wave', 'wave'],
  ['dance', 'dance'],
  ['blush', 'blush'],
  ['cry', 'cry'],
  ['smile', 'smile'],
]);

const actionCommands = new Set(Array.from(actionAliases.keys()));

async function handleFunAction(message, cmd, args) {
  const action = actionAliases.get(cmd);
  if (!action) return false;

  let targetUser = message.mentions.users.first() || null;
  const maybeId = args.find((a) => /^\d{15,20}$/.test(a));
  if (!targetUser && maybeId) {
    targetUser = await message.client.users.fetch(maybeId).catch(() => null);
  }

  const emb = await buildActionEmbed({
    action,
    actorUser: message.author,
    targetUser,
    guild: message.guild,
  });

  await message.reply({ embeds: [emb] }).catch(() => {});
  return true;
}

module.exports = {
  actionCommands,
  actionAliases,
  handleFunAction,
};
