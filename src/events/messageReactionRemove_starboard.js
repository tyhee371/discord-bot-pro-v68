const { Events } = require('discord.js');
// Re-use the debouncer and process function from the add handler so both
// reaction-add and reaction-remove share the same 400 ms window per message.
const { _debouncer, _processStarboard } = require('./messageReactionAdd_starboard');

async function handleStar(reaction, user) {
  if (!reaction?.message?.guild) return;
  if (user?.bot) return;
  if (reaction.emoji?.name !== '⭐') return;

  const guild = reaction.message.guild;
  const debounceKey = `starboard:${guild.id}:${reaction.message.id}`;
  _debouncer.schedule(debounceKey, () => _processStarboard(reaction, guild));
}

module.exports = {
  name: Events.MessageReactionRemove,
  async execute(client, reaction, user) {
    try { await handleStar(reaction, user); } catch {}
  },
};
