const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');

const { getGiveaway, saveGiveaway, addToIndex, deleteGiveaway, removeFromIndex, getGuildGiveawayIds } = require('../../utils/giveawayStore');
const { schedulEnd, hasTimer } = require('../../utils/giveawayTimer');
const { endGiveaway } = require('../../utils/giveawayEnd');
const {
  parseDuration,
  buildActiveEmbed,
  buildEndedEmbed,
  buildEntryButton,
  pickWinners,
  formatTimestampFull,
  formatTimestamp,
} = require('../../utils/giveawayHelpers');

// ── Restore timers on bot restart ─────────────────────────────────────────────
async function restoreTimers(client) {
  try {
    for (const [guildId] of client.guilds.cache) {
      const ids = await getGuildGiveawayIds(guildId);
      for (const messageId of ids) {
        const g = await getGiveaway(messageId);
        if (!g || g.ended) continue;
        const delay = g.endTime - Date.now();
        if (delay <= 0) {
          await endGiveaway(client, messageId, g.channelId, guildId);
        } else if (!hasTimer(messageId)) {
          schedulEnd(messageId, delay, () =>
            endGiveaway(client, messageId, g.channelId, guildId),
          );
        }
      }
    }
  } catch (err) {
    console.error('[GIVEAWAY] restoreTimers error:', err);
  }
}

module.exports = {
  restoreTimers,
  defer: false,
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Giveaway system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    // /giveaway create  -  opens modal builder
    .addSubcommand(s =>
      s.setName('create')
        .setDescription('Create a new giveaway via interactive builder.')
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription('Channel to post the giveaway in (defaults to current channel)')
            .setRequired(false)
        )
        .addRoleOption(o =>
          o.setName('required_role')
            .setDescription('Optional: only users with this role can enter')
            .setRequired(false)
        )
    )

    // /giveaway reroll
    .addSubcommand(s =>
      s.setName('reroll')
        .setDescription('Reroll winners for an ended giveaway.')
        .addStringOption(o =>
          o.setName('message_id')
            .setDescription('Message ID of the giveaway')
            .setRequired(true)
        )
    )

    // /giveaway summary
    .addSubcommand(s =>
      s.setName('summary')
        .setDescription('Show a summary of a giveaway.')
        .addStringOption(o =>
          o.setName('message_id')
            .setDescription('Message ID of the giveaway')
            .setRequired(true)
        )
    )

    // /giveaway end (manual early end)
    .addSubcommand(s =>
      s.setName('end')
        .setDescription('End a giveaway immediately.')
        .addStringOption(o =>
          o.setName('message_id')
            .setDescription('Message ID of the giveaway')
            .setRequired(true)
        )
    )

    // /giveaway list
    .addSubcommand(s =>
      s.setName('list')
        .setDescription('List all giveaways in this server with End / Edit / Delete buttons.')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── /giveaway create ──────────────────────────────────────────────────────
    if (sub === 'create') {
      const targetChannel = interaction.options.getChannel('channel') ?? interaction.channel;
      const requiredRole  = interaction.options.getRole('required_role');

      const roleId = requiredRole?.id ?? 'none';
      const chanId = targetChannel.id;

      const modal = new ModalBuilder()
        .setCustomId(`giveaway_create:${chanId}:${roleId}`)
        .setTitle('🎉 Create Giveaway');

      const prize = new TextInputBuilder()
        .setCustomId('prize')
        .setLabel('Prize')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('e.g. Discord Nitro, $50 Steam Gift Card')
        .setMaxLength(100);

      const description = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder('Extra details about the giveaway...')
        .setMaxLength(500);

      const duration = new TextInputBuilder()
        .setCustomId('duration')
        .setLabel('Duration (e.g. 10m, 1h, 1d, 2h30m)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('10m');

      const winners = new TextInputBuilder()
        .setCustomId('winners')
        .setLabel('Number of winners (optional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder('1')
        .setMaxLength(2);

      // 5th row: color + image URL in key=value format (same pattern as /embed command)
      const extras = new TextInputBuilder()
        .setCustomId('extras')
        .setLabel('Color & Image (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder('color=#FF5733\nimage=https://example.com/banner.png')
        .setMaxLength(500);

      modal.addComponents(
        new ActionRowBuilder().addComponents(prize),
        new ActionRowBuilder().addComponents(description),
        new ActionRowBuilder().addComponents(duration),
        new ActionRowBuilder().addComponents(winners),
        new ActionRowBuilder().addComponents(extras),
      );

      return interaction.showModal(modal);
    }

    // All other subcommands defer
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    // ── /giveaway reroll ──────────────────────────────────────────────────────
    if (sub === 'reroll') {
      const messageId = interaction.options.getString('message_id').trim();
      const g = await getGiveaway(messageId);

      if (!g) return interaction.editReply('❌ Giveaway not found. Check the message ID.');
      if (!g.ended) return interaction.editReply('❌ This giveaway has not ended yet. Use `/giveaway end` first.');
      if (!g.entries.length) return interaction.editReply('❌ No entries to reroll from.');

      const result = await endGiveaway(interaction.client, messageId, g.channelId, interaction.guildId, { reroll: true });
      if (result.error) return interaction.editReply(`❌ Reroll failed: ${result.error}`);

      const winnerText = result.winners.map(id => `<@${id}>`).join(', ');
      return interaction.editReply(`✅ Rerolled! New winner(s): ${winnerText}`);
    }

    // ── /giveaway end ─────────────────────────────────────────────────────────
    if (sub === 'end') {
      const messageId = interaction.options.getString('message_id').trim();
      const g = await getGiveaway(messageId);

      if (!g) return interaction.editReply('❌ Giveaway not found. Check the message ID.');
      if (g.ended) return interaction.editReply('❌ This giveaway has already ended.');

      const result = await endGiveaway(interaction.client, messageId, g.channelId, interaction.guildId);
      if (result.error) return interaction.editReply(`❌ Could not end giveaway: ${result.error}`);

      return interaction.editReply(`✅ Giveaway ended. Winner(s): ${result.winners.map(id => `<@${id}>`).join(', ') || 'No valid entries'}`);
    }

    // ── /giveaway summary ─────────────────────────────────────────────────────
    if (sub === 'summary') {
      const messageId = interaction.options.getString('message_id').trim();
      const g = await getGiveaway(messageId);

      if (!g) return interaction.editReply('❌ Giveaway not found. Check the message ID.');

      const status = g.ended ? '🔴 Ended' : '🟢 Active';
      const embed = new EmbedBuilder()
        .setColor(g.ended ? 0x95A5A6 : 0xF1C40F)
        .setTitle(`📊 Giveaway Summary  -  ${g.prize}`)
        .addFields(
          { name: 'Status',        value: status,                        inline: true },
          { name: 'Total Entries', value: String(g.entries.length),      inline: true },
          { name: 'Winners',       value: String(g.winnerCount),         inline: true },
          { name: 'Hosted by',     value: `<@${g.hostId}>`,             inline: true },
          { name: 'End Time',      value: formatTimestampFull(g.endTime), inline: true },
          { name: 'Channel',       value: `<#${g.channelId}>`,           inline: true },
        );

      if (g.requiredRoleId) {
        embed.addFields({ name: 'Required Role', value: `<@&${g.requiredRoleId}>`, inline: true });
      }
      if (g.ended && g.winners?.length) {
        embed.addFields({ name: 'Actual Winners', value: g.winners.map(id => `<@${id}>`).join(', ') });
      }
      if (g.description) embed.setDescription(g.description);
      if (g.imageUrl)    embed.setImage(g.imageUrl);
      embed.setFooter({ text: `Message ID: ${messageId}` });

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /giveaway list ────────────────────────────────────────────────────────
    if (sub === 'list') {
      const ids = await getGuildGiveawayIds(interaction.guildId);
      const giveaways = (
        await Promise.all(ids.map(id => getGiveaway(id)))
      ).filter(Boolean);

      if (!giveaways.length) {
        return interaction.editReply('📭 No giveaways found for this server. Use `/giveaway create` to start one.');
      }

      giveaways.sort((a, b) => {
        if (a.ended !== b.ended) return a.ended ? 1 : -1;
        return b.endTime - a.endTime;
      });

      const shown = giveaways.slice(0, 10);
      const lines = shown.map((g, idx) => {
        const status  = g.ended ? '🔴' : '🟢';
        const entries = g.entries.length;
        const timeStr = g.ended ? `ended ${formatTimestamp(g.endTime)}` : `ends ${formatTimestamp(g.endTime)}`;
        return [
          `${idx + 1}. ${status} **${g.prize}**`,
          `   \`${g.id}\` • ${timeStr} • ${entries} entr${entries === 1 ? 'y' : 'ies'} • ${g.winnerCount} winner${g.winnerCount > 1 ? 's' : ''} • <@${g.hostId}>`,
        ].join('\n');
      });

      if (giveaways.length > 10) lines.push(`\n*...and ${giveaways.length - 10} more.*`);

      const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('🎉 Giveaways  -  This Server')
        .setDescription(lines.join('\n\n'))
        .setFooter({ text: `${giveaways.length} total • Use the buttons below to manage` });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('giveawayList:end')
          .setLabel('⏹ End')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('giveawayList:edit')
          .setLabel('✏️ Edit')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('giveawayList:delete')
          .setLabel('🗑️ Delete')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('giveawayList:entries')
          .setLabel('👥 Entries')
          .setStyle(ButtonStyle.Primary),
      );

      return interaction.editReply({ embeds: [embed], components: [row] });
    }
  },
};
