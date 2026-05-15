/**
 * logsGuildMemberRemove.js
 *
 * Sends a structured member-leave log embed to the configured log channel.
 * Shows username, roles held, time in server, and account age — Carl-bot style.
 *
 * Fires alongside guildMemberRemove.js (leave message) and persistMemberRemove.js.
 */

const { Events, EmbedBuilder } = require('discord.js');
const { getLogConfig, resolveLogChannel } = require('../services/logService');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(client, member) {
    try {
      const cfg = await getLogConfig(member.guild.id);
      if (!cfg.enabled || !cfg.channelId) return;

      if (cfg.events.member === false) return;
      if (cfg.ignoreBots && member.user?.bot) return;

      const ch = await resolveLogChannel(member.guild, cfg.channelId);
      if (!ch) return;

      const user = member.user;
      const createdAt = Math.floor(user.createdTimestamp / 1000);
      const joinedAt = member.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;

      // Roles — exclude @everyone
      const roles = [...member.roles.cache.values()]
        .filter(r => r.id !== member.guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => `${r}`)
        .slice(0, 20); // cap at 20 to avoid embed limit

      const embed = new EmbedBuilder()
        .setAuthor({ name: `${user.tag}`, iconURL: user.displayAvatarURL({ size: 256 }) })
        .setTitle('Member left')
        .setColor(0xe74c3c) // red
        .setDescription(`${user}`)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .setTimestamp();

      if (joinedAt) {
        embed.addFields({ name: 'Joined', value: `<t:${joinedAt}:R> (<t:${joinedAt}:D>)`, inline: false });
      }

      embed.addFields({ name: 'Account created', value: `<t:${createdAt}:R>`, inline: true });
      embed.addFields({ name: 'ID', value: `\`${user.id}\``, inline: true });

      if (roles.length > 0) {
        embed.addFields({
          name: `Roles (${roles.length})`,
          value: roles.join(' ').slice(0, 1024),
          inline: false,
        });
      }

      await ch.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      // Non-fatal
    }
  },
};
