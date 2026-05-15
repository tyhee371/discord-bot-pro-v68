/**
 * logsGuildMemberAdd.js
 *
 * Sends a structured member-join log embed to the configured log channel.
 * Matches the Carl-bot style: shows username, join order, account age, and roles.
 *
 * Fires alongside guildMemberAdd.js (greet) and persistMemberAdd.js (role restore).
 */

const { Events, EmbedBuilder } = require('discord.js');
const { getLogConfig, resolveLogChannel } = require('../services/logService');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(client, member) {
    try {
      const cfg = await getLogConfig(member.guild.id);
      if (!cfg.enabled || !cfg.channelId) return;

      // Respect member log toggle (default enabled if logs are on)
      if (cfg.events.member === false) return;
      if (cfg.ignoreBots && member.user?.bot) return;

      const ch = await resolveLogChannel(member.guild, cfg.channelId);
      if (!ch) return;

      const user = member.user;
      const createdAt = Math.floor(user.createdTimestamp / 1000);
      const memberCount = member.guild.memberCount;

      const embed = new EmbedBuilder()
        .setAuthor({ name: `${user.tag}`, iconURL: user.displayAvatarURL({ size: 256 }) })
        .setTitle('Member joined')
        .setColor(0x2ecc71) // green
        .setDescription(`${user}`)
        .addFields(
          { name: 'Account created', value: `<t:${createdAt}:R> (<t:${createdAt}:D>)`, inline: false },
          { name: 'Join position', value: `${memberCount.toLocaleString()}`, inline: true },
          { name: 'ID', value: `\`${user.id}\``, inline: true },
        )
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .setTimestamp();

      await ch.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      // Non-fatal — log silently
    }
  },
};
