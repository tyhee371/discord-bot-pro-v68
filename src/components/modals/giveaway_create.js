/**
 * Modal handler for /giveaway create
 * customId: giveaway_create:<channelId>:<roleId>
 *
 * The 5th modal field 'extras' accepts optional key=value lines:
 *   color=#FF5733          (hex color or preset name)
 *   image=https://...      (image URL shown at the bottom of the embed)
 *
 * This mirrors the /embed command pattern so no slash options are needed.
 */
'use strict';

const { MessageFlags } = require('discord.js');
const { parseDuration, buildActiveEmbed, buildEntryButton, resolveColor } = require('../../utils/giveawayHelpers');
const { saveGiveaway, addToIndex } = require('../../utils/giveawayStore');
const { schedulEnd } = require('../../utils/giveawayTimer');
const { endGiveaway } = require('../../utils/giveawayEnd');

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseKeyValue(raw) {
  const out = {};
  if (!raw) return out;
  for (const line of raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const val = line.slice(eq + 1).trim();
    if (key && val) out[key] = val;
  }
  return out;
}

function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch { return false; }
}

// ── Handler ───────────────────────────────────────────────────────────────────

module.exports = {
  id: 'giveaway_create',
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // customId: giveaway_create:<channelId>:<roleId>
    const parts     = interaction.customId.split(':');
    const channelId = parts[1];
    const roleId    = (parts[2] && parts[2] !== 'none') ? parts[2] : null;

    // Read modal fields
    const prize       = interaction.fields.getTextInputValue('prize')?.trim();
    const description = interaction.fields.getTextInputValue('description')?.trim() || '';
    const durationRaw = interaction.fields.getTextInputValue('duration')?.trim();
    const winnersRaw  = interaction.fields.getTextInputValue('winners')?.trim() || '1';
    const extrasRaw   = interaction.fields.getTextInputValue('extras')?.trim() || '';

    // Parse extras field (color and image)
    const extras   = parseKeyValue(extrasRaw);
    const colorRaw = extras.color ?? extras.colour ?? null;
    const imageRaw = extras.image ?? extras.image_url ?? extras.img ?? null;

    // Validate prize
    if (!prize) return interaction.editReply('❌ Prize cannot be empty.');

    // Validate duration
    const durationMs = parseDuration(durationRaw);
    if (!durationMs)
      return interaction.editReply('❌ Invalid duration format. Use: `10s`, `10m`, `1h`, `1d`, or combinations like `1h30m`.');
    if (durationMs < 5000)
      return interaction.editReply('❌ Duration must be at least 5 seconds.');
    if (durationMs > 30 * 86400000)
      return interaction.editReply('❌ Duration cannot exceed 30 days.');

    // Validate winner count
    const winnerCount = Math.max(1, parseInt(winnersRaw, 10) || 1);
    if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 20)
      return interaction.editReply('❌ Winners must be a number between 1 and 20.');

    // Validate image URL if provided
    const imageUrl = imageRaw && isHttpUrl(imageRaw) ? imageRaw : null;
    if (imageRaw && !imageUrl)
      return interaction.editReply('❌ Image URL must be a valid https:// URL.\nExample: `image=https://example.com/banner.png`');

    // Resolve color (preset name or hex — null falls back to default gold in embed builder)
    const color = colorRaw || null;

    // Find target channel
    const channel = interaction.guild.channels.cache.get(channelId) ||
      await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel)
      return interaction.editReply('❌ Target channel not found.');
    if (!channel.permissionsFor(interaction.guild.members.me)?.has(['SendMessages', 'EmbedLinks']))
      return interaction.editReply(`❌ I don't have permission to send messages in ${channel}.`);

    const endTime = Date.now() + durationMs;

    const giveawayData = {
      prize,
      description,
      hostId:         interaction.user.id,
      entries:        [],
      winnerCount,
      requiredRoleId: roleId,
      endTime,
      ended:          false,
      channelId:      channel.id,
      guildId:        interaction.guildId,
      color,
      imageUrl,
    };

    // Build embed + button, send, update with real message ID
    const embed  = buildActiveEmbed({ ...giveawayData, id: 'pending', entries: [] });
    const row    = buildEntryButton('pending');
    const msg    = await channel.send({ embeds: [embed], components: [row] });

    giveawayData.id = msg.id;
    const embed2    = buildActiveEmbed(giveawayData);
    const row2      = buildEntryButton(msg.id);
    await msg.edit({ embeds: [embed2], components: [row2] });

    await saveGiveaway(giveawayData);
    await addToIndex(interaction.guildId, msg.id);

    schedulEnd(msg.id, durationMs, () =>
      endGiveaway(interaction.client, msg.id, channel.id, interaction.guildId)
    );

    return interaction.editReply(
      `✅ Giveaway created in ${channel}!\n📌 Message ID: \`${msg.id}\`\n🔗 [Jump to giveaway](${msg.url})`
    );
  },
};
