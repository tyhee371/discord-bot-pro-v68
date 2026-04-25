const { PermissionFlagsBits } = require('discord.js');
const { getModLogConfig, resolveModLogChannel, sendModLogEmbed, buildModActionEmbed } = require('../../utils/modLogService');

async function clearAllRecent(channel) {
  let total = 0;

  while (true) {
    const msgs = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!msgs || msgs.size === 0) break;

    const deleted = await channel.bulkDelete(msgs, true).catch(() => null);
    const count = deleted ? deleted.size : 0;

    total += count;

    if (count === 0) break;
    if (msgs.size < 100) break;
  }

  return total;
}

module.exports = {
  id: 'clear',
  async execute(interaction) {
    const parts = interaction.customId.split(':'); // clear:confirm:uid:channelId:created | clear:cancel:uid:created
    const action = parts[1];

    if (!interaction.guild) {
      return interaction.reply({ content: '❌ This can only be used in a server.', ephemeral: true }).catch(() => {});
    }

    // Validate user
    const ownerId = parts[2];
    if (ownerId && interaction.user.id !== ownerId) {
      return interaction.reply({ content: '❌ Only the command user can click these buttons.', ephemeral: true }).catch(() => {});
    }

    // Expiry
    const created = Number(action === 'confirm' ? parts[4] : parts[3]);
    if (!Number.isFinite(created) || Math.floor(Date.now() / 1000) - created > 60) {
      return interaction.update({ content: '⌛ This confirmation expired.', components: [] }).catch(() => {});
    }

    if (action === 'cancel') {
      return interaction.update({ content: '✅ Cancelled.', components: [] }).catch(() => {});
    }

    // confirm
    // Require mod logs channel (moderation commands depend on it)
    const cfg = await getModLogConfig(interaction.guildId);
    if (!cfg.enabled || !cfg.channelId) {
      return interaction.update({ content: '❌ Mod logs channel is not configured. Run `/modlogs setup` first.', components: [] }).catch(() => {});
    }
    const channelId = parts[3];
    const target = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!target || !target.isTextBased?.()) {
      return interaction.update({ content: '❌ Invalid channel.', components: [] }).catch(() => {});
    }

    // Permission checks
    const me = await interaction.guild.members.fetchMe().catch(() => interaction.guild.members.me);
    const botPerms = target.permissionsFor(me);
    if (!botPerms?.has(PermissionFlagsBits.ViewChannel) || !botPerms?.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.update({
        content: '❌ I need **View Channel** + **Manage Messages** in that channel to clear messages.',
        components: [],
      }).catch(() => {});
    }

    const userPerms = target.permissionsFor(interaction.member);
    if (!userPerms?.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.update({ content: '❌ You need **Manage Messages** to do this.', components: [] }).catch(() => {});
    }

    // Acknowledge quickly to avoid "Unknown interaction"
    await interaction.update({ content: '🧹 Clearing messages…', components: [] }).catch(() => {});

    const total = await clearAllRecent(target);

    const result =
      total > 0
        ? `✅ Cleared **${total}** recent messages in ${target}. (Messages older than 14 days cannot be bulk deleted.)`
        : `⚠️ Nothing to delete in ${target} (or messages are older than 14 days).`;

    // Send mod log
    const emb = buildModActionEmbed({
      title: '🧹 Clear Messages (All)',
      moderator: interaction.user,
      reason: `Channel: #${target.name}`,
      fields: [{ name: 'Deleted', value: String(total), inline: true }],
    });
    await sendModLogEmbed(interaction.guild, emb);

    return interaction.editReply({ content: result, components: [] }).catch(() => {});
  },
};
