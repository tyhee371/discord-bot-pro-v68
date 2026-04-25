const { Events, EmbedBuilder } = require('discord.js');
const { getLogConfig, sendLogEmbed } = require('../utils/logService');

function diffRoles(oldRoles, newRoles) {
  const oldSet = new Set(oldRoles.map(r => r.id));
  const newSet = new Set(newRoles.map(r => r.id));

  const added = [];
  const removed = [];

  for (const r of newRoles.values()) if (!oldSet.has(r.id)) added.push(r);
  for (const r of oldRoles.values()) if (!newSet.has(r.id)) removed.push(r);

  return { added, removed };
}

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(client, oldMember, newMember) {
    try {
      const guild = newMember.guild;
      if (!guild) return;

      const cfg = await getLogConfig(guild.id);
      if (!cfg.enabled || !cfg.events.role) return;
      if (cfg.ignoreBots && newMember.user?.bot) return;

      const { added, removed } = diffRoles(oldMember.roles.cache, newMember.roles.cache);
      if (!added.length && !removed.length) return;

      const user = newMember.user;
      const avatar = user.displayAvatarURL?.({ size: 256 });

      for (const role of added) {
        const emb = new EmbedBuilder()
          .setAuthor({ name: `${user.tag}`, iconURL: avatar })
          .setTitle('Role added')
          .setColor(0x2ecc71)
          .setDescription(`${user}`)
          .addFields({ name: '\u200b', value: `${role}`, inline: false })
          .setFooter({ text: `User ID: ${user.id}` })
          .setTimestamp();

        await sendLogEmbed(guild, emb);
      }

      for (const role of removed) {
        const emb = new EmbedBuilder()
          .setAuthor({ name: `${user.tag}`, iconURL: avatar })
          .setTitle('Role removed')
          .setColor(0xe74c3c)
          .setDescription(`${user}`)
          .addFields({ name: '\u200b', value: `${role}`, inline: false })
          .setFooter({ text: `User ID: ${user.id}` })
          .setTimestamp();

        await sendLogEmbed(guild, emb);
      }
    } catch {}
  },
};
