const { SlashCommandBuilder, EmbedBuilder, GatewayIntentBits } = require('discord.js');
const { safeReply, safeDefer } = require('../../utils/safeReply');

function formatPresenceStatus(status) {
  if (!status) return null;
  if (status === 'online') return 'Online';
  if (status === 'idle') return 'Idle';
  if (status === 'dnd') return 'Do Not Disturb';
  if (status === 'offline') return 'Offline';
  return String(status);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('user')
    .setDescription('Show user information (badges, avatars, join date, roles).')
    .addUserOption((o) => o.setName('target').setDescription('User to view').setRequired(false)),
  async execute(interaction) {
    const g = interaction.guild;
    if (!g) return safeReply(interaction, { content: 'This command can only be used in a server.', ephemeral: true });

    const replyOrEdit = async (payload) => {
      const clean = { ...payload };
      delete clean.ephemeral;
      delete clean.flags;
      if (interaction.deferred || interaction.replied) return interaction.editReply(clean);
      return safeReply(interaction, { ...payload, ephemeral: true });
    };

    if (!interaction.deferred && !interaction.replied) {
      try { await safeDefer(interaction, { ephemeral: true }); } catch {}
    }

    const targetUser = interaction.options.getUser('target') || interaction.user;

    let member = await g.members.fetch(targetUser.id).catch(() => null);

    const hasPresences = interaction.client?.options?.intents?.has?.(GatewayIntentBits.GuildPresences) || false;
    let status = member?.presence?.status ?? null;
    if (hasPresences && member && !status) {
      try {
        const freshMember = await g.members.fetch({ user: targetUser.id, withPresences: true });
        member = freshMember || member;
        status = member?.presence?.status ?? null;
      } catch {}
    }

    const created = Math.floor(targetUser.createdTimestamp / 1000);
    const joined = member?.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;

    let bannerUrl = null;
    let flagsText = null;
    try {
      const fresh = await targetUser.fetch(true);
      bannerUrl = fresh.bannerURL({ size: 2048, extension: 'png' });
      try {
        const flags = await fresh.fetchFlags();
        const arr = flags?.toArray?.() ?? [];
        flagsText = arr.length ? arr.map((f) => `\`${f}\``).join(' ') : null;
      } catch {
        flagsText = null;
      }
    } catch {
      bannerUrl = null;
      flagsText = null;
    }

    const serverAvatar = member
      ? member.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: false })
      : targetUser.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: false });

    const globalAvatar = targetUser.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: false });

    const voice = member?.voice?.channelId ? `<#${member.voice.channelId}>` : null;

    const emb = new EmbedBuilder()
      .setTitle(`👤 ${targetUser.tag}`)
      .setThumbnail(serverAvatar)
      .setDescription(`${targetUser} ${targetUser.bot ? '🤖' : ''}`)
      .addFields(
        { name: '🆔 User ID', value: `\`${targetUser.id}\``, inline: true },
        { name: '📅 Account Created', value: `<t:${created}:F>\n(<t:${created}:R>)`, inline: true },
        { name: '📌 Joined Server', value: joined ? `<t:${joined}:F>\n(<t:${joined}:R>)` : 'Not in server', inline: true },
      );

    if (member) {
      const roles = member.roles.cache
        .filter((r) => r.id !== g.id)
        .sort((a, b) => b.position - a.position)
        .map((r) => r.toString());

      emb.addFields(
        { name: '🏷️ Display Name', value: member.displayName || targetUser.username, inline: true },
        { name: '🎭 Top Role', value: member.roles.highest ? member.roles.highest.toString() : 'None', inline: true },
        { name: '📡 Status', value: status ? `**${formatPresenceStatus(status) || status}**` : (hasPresences ? '**Offline**' : 'Unknown (enable Presence Intent)'), inline: true },
      );

      if (voice) emb.addFields({ name: '🔊 Voice', value: voice, inline: true });

      if (member.premiumSinceTimestamp) {
        const boost = Math.floor(member.premiumSinceTimestamp / 1000);
        emb.addFields({ name: '✨ Boosting Since', value: `<t:${boost}:F>\n(<t:${boost}:R>)`, inline: true });
      }
      if (member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()) {
        const until = Math.floor(member.communicationDisabledUntilTimestamp / 1000);
        emb.addFields({ name: '⏳ Timeout Until', value: `<t:${until}:F>\n(<t:${until}:R>)`, inline: true });
      }

      emb.addFields({
        name: `🧩 Roles (${roles.length})`,
        value: roles.length ? `${roles.slice(0, 25).join(' ')}${roles.length > 25 ? `\n+${roles.length - 25} more` : ''}` : 'None',
        inline: false,
      });
    }

    if (flagsText) emb.addFields({ name: '🏅 Badges', value: flagsText.slice(0, 1024), inline: false });

    const sizes = [128, 256, 512, 1024, 2048, 4096];
    const links = (makeUrl) => sizes.map((s) => `[${s}](${makeUrl(s)})`).join(' • ');

    emb.addFields(
      { name: '🖼️ Server Avatar', value: links((s) => (member ? member.displayAvatarURL({ extension: 'png', size: s }) : globalAvatar)), inline: false },
      { name: '🌐 Global Avatar', value: links((s) => targetUser.displayAvatarURL({ extension: 'png', size: s })), inline: false },
    );

    if (bannerUrl) emb.setImage(bannerUrl);

    emb.setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL({ size: 64 }) }).setTimestamp();

    return replyOrEdit({ embeds: [emb] });
  },
};