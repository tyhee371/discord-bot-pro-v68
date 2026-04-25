const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { safeReply, safeDefer } = require('../../utils/safeReply');
const { requireModLog, createAndSendCase } = require('../../utils/modLogService');


async function replyOrEdit(interaction, payload) {
  // Works whether interaction was deferred by the global handler or not.
  if (interaction.deferred || interaction.replied) {
    // editReply doesn't accept flags/ephemeral — strip them.
    const { flags, ephemeral, ...rest } = payload || {};
    return interaction.editReply(rest);
  }
  return safeReply(interaction, payload);
}

async function clearAllRecent(channel) {
  // Discord bulk delete limitations:
  // - max 100 per bulkDelete
  // - cannot delete messages older than 14 days (API will skip/throw)
  let total = 0;

  // Loop fetch 100 at a time
  while (true) {
    const msgs = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!msgs || msgs.size === 0) break;

    // bulkDelete auto-filters >14d if filterOld = true
    const deleted = await channel.bulkDelete(msgs, true).catch(() => null);
    const count = deleted ? deleted.size : 0;

    total += count;

    // If nothing deleted, either all remaining are too old, or perms issue
    if (count === 0) break;

    // Small safety: avoid infinite loops if API returns same set
    if (msgs.size < 100) break;
  }

  return total;
}

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear messages in a channel (mod only).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((o) =>
      o
        .setName('amount')
        .setDescription('Number of messages to delete, or type "all" to clear as many recent messages as possible.')
        .setRequired(true),
    )
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel to clear (default: current channel)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread)
        .setRequired(false),
    ),

  async execute(interaction) {
    const modLogCh = await requireModLog(interaction);
    if (!modLogCh) return;

    const raw = String(interaction.options.getString('amount', true)).trim().toLowerCase();
    const target = interaction.options.getChannel('channel') || interaction.channel;

    if (!target || !target.isTextBased?.()) {
      return replyOrEdit(interaction, { content: '❌ Invalid channel.', flags: MessageFlags.Ephemeral });
    }

    // Permission check (extra safety)
    const me = await interaction.guild.members.fetchMe().catch(() => interaction.guild.members.me);
    const perms = target.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.ManageMessages)) {
      return replyOrEdit(interaction, { content: '❌ I need **View Channel** + **Manage Messages** in that channel to clear messages.', flags: MessageFlags.Ephemeral });
    }

    // Also check user perms in that channel (not just command default)
    const userPerms = target.permissionsFor(interaction.member);
    if (!userPerms?.has(PermissionFlagsBits.ManageMessages)) {
      return replyOrEdit(interaction, { content: '❌ You need **Manage Messages** to use this command.', flags: MessageFlags.Ephemeral });
    }
// For "all", ask for confirmation (handled by buttons component: src/components/buttons/clear.js)
if (raw === 'all') {
  const created = Math.floor(Date.now() / 1000);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`clear:confirm:${interaction.user.id}:${target.id}:${created}`)
      .setLabel('Confirm')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`clear:cancel:${interaction.user.id}:${created}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  return replyOrEdit(interaction, {
    content: `⚠️ Are you sure you want to clear **ALL recent messages** in ${target}?\n(Discord can’t bulk delete messages older than 14 days.)\n\nThis will expire in **60 seconds**.`,
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}


    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) {
      return replyOrEdit(interaction, { content: '❌ Invalid amount. Use a number (1-100) or "all".', flags: MessageFlags.Ephemeral });
    }

    const amount = Math.min(100, Math.floor(n));
    const deleted = await target.bulkDelete(amount, true).catch(() => null);
    const count = deleted ? deleted.size : 0;

    const resultText =
      count > 0
        ? `✅ Deleted **${count}** message(s) in ${target}. (Messages older than 14 days are skipped.)`
        : `⚠️ Nothing deleted (messages may be older than 14 days).`;

    // Mod log
    const c = await createAndSendCase({
      guild: interaction.guild,
      type: 'clear',
      title: '🧹 Clear Messages',
      moderator: interaction.user,
      target: null,
      reason: `Channel: #${target.name}`,
      fields: [{ name: 'Deleted', value: String(count), inline: true }],
      dmTarget: false,
      extra: { channelId: target.id, deleted: count },
    });
return replyOrEdit(interaction, { content: resultText, flags: MessageFlags.Ephemeral });
  },
};