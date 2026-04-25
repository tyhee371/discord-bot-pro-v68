/**
 * Modal handler for /giveaway create
 * customId: giveaway_create:<channelId>:<roleId>
 */
const { MessageFlags } = require('discord.js');
const { parseDuration, buildActiveEmbed, buildEntryButton } = require('../../utils/giveawayHelpers');
const { saveGiveaway, addToIndex } = require('../../utils/giveawayStore');
const { schedulEnd } = require('../../utils/giveawayTimer');
const { endGiveaway } = require('../../utils/giveawayEnd');

module.exports = {
  id: 'giveaway_create',
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Parse customId: giveaway_create:<channelId>:<roleId>
    const parts = interaction.customId.split(':');
    const channelId = parts[1];
    const roleId = parts[2] === 'none' ? null : parts[2];

    // Read modal fields
    const prize = interaction.fields.getTextInputValue('prize')?.trim();
    const description = interaction.fields.getTextInputValue('description')?.trim() || '';
    const durationRaw = interaction.fields.getTextInputValue('duration')?.trim();
    const winnersRaw = interaction.fields.getTextInputValue('winners')?.trim();

    // Validate prize
    if (!prize) {
      return interaction.editReply('❌ Prize cannot be empty.');
    }

    // Validate duration
    const durationMs = parseDuration(durationRaw);
    if (!durationMs) {
      return interaction.editReply(
        '❌ Invalid duration format. Use: `10s`, `10m`, `1h`, `1d`, or combinations like `1h30m`.'
      );
    }
    if (durationMs < 5000) {
      return interaction.editReply('❌ Duration must be at least 5 seconds.');
    }
    if (durationMs > 30 * 86400000) {
      return interaction.editReply('❌ Duration cannot exceed 30 days.');
    }

    // Validate winner count
    const winnerCount = parseInt(winnersRaw, 10);
    if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 20) {
      return interaction.editReply('❌ Winners must be a number between 1 and 20.');
    }

    // Find target channel
    const channel = interaction.guild.channels.cache.get(channelId) ||
      await interaction.guild.channels.fetch(channelId).catch(() => null);

    if (!channel) {
      return interaction.editReply('❌ Target channel not found.');
    }

    if (!channel.permissionsFor(interaction.guild.members.me)?.has(['SendMessages', 'EmbedLinks'])) {
      return interaction.editReply(`❌ I don't have permission to send messages in ${channel}.`);
    }

    const endTime = Date.now() + durationMs;

    // Build temp giveaway object (id assigned after message sent)
    const giveawayData = {
      prize,
      description,
      hostId: interaction.user.id,
      entries: [],
      winnerCount,
      requiredRoleId: roleId,
      endTime,
      ended: false,
      channelId: channel.id,
      guildId: interaction.guildId,
    };

    // Build embed + button
    const embed = buildActiveEmbed({ ...giveawayData, id: 'pending', entries: [] });
    const row = buildEntryButton('pending');

    // Send to channel, then update with real message ID
    const msg = await channel.send({ embeds: [embed], components: [row] });

    // Now we have the real ID — update everything
    giveawayData.id = msg.id;
    const embed2 = buildActiveEmbed(giveawayData);
    const row2 = buildEntryButton(msg.id);
    await msg.edit({ embeds: [embed2], components: [row2] });

    // Persist
    await saveGiveaway(giveawayData);
    await addToIndex(interaction.guildId, msg.id);

    // Schedule end
    schedulEnd(msg.id, durationMs, () =>
      endGiveaway(interaction.client, msg.id, channel.id, interaction.guildId)
    );

    return interaction.editReply(
      `✅ Giveaway created in ${channel}!\n📌 Message ID: \`${msg.id}\`\n🔗 [Jump to giveaway](${msg.url})`
    );
  },
};
