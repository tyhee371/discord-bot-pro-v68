/**
 * /ticketlog — configure the ticket progress channel.
 *
 * Subcommands:
 *   set <channel>   — set (or change) the progress channel
 *   clear           — remove the progress channel
 *   status          — show the current progress channel
 *
 * The progress channel receives one embed per ticket that is edited
 * in-place as the ticket moves through: open → claimed → closed/deleted.
 *
 * This is SEPARATE from the transcript channel (set via /ticket setup).
 *   • transcript channel  → receives HTML transcripts on close/delete
 *   • progress channel    → receives a live status embed per ticket
 */

'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} = require('discord.js');

const { getGuildSettings, setGuildSettings } = require('../../utils/settings');
const { replyOrEdit } = require('../../utils/reply');

module.exports = {
  ephemeral: true,
  moduleKey: 'tickets',

  data: new SlashCommandBuilder()
    .setName('ticketlog')
    .setDescription('Configure the ticket progress tracking channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Set the channel where ticket progress will be posted.')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Text channel for ticket progress entries')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )

    .addSubcommand((s) =>
      s
        .setName('clear')
        .setDescription('Remove the ticket progress channel (disable progress tracking).'),
    )

    .addSubcommand((s) =>
      s
        .setName('status')
        .setDescription('Show the current ticket progress channel setting.'),
    ),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    // ── set ────────────────────────────────────────────────────────────────
    if (sub === 'set') {
      const channel = interaction.options.getChannel('channel', true);

      // Validate bot can send + embed in the target channel
      const me   = interaction.guild.members.me;
      const perms = channel.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.ViewChannel)) {
        return replyOrEdit(interaction, {
          content: `❌ I don't have **Send Messages** or **View Channel** permission in ${channel}. Please fix the channel permissions first.`,
          ephemeral: true,
        });
      }
      if (!perms?.has(PermissionFlagsBits.EmbedLinks)) {
        return replyOrEdit(interaction, {
          content: `❌ I need **Embed Links** permission in ${channel} to post progress embeds.`,
          ephemeral: true,
        });
      }

      await setGuildSettings(guildId, {
        tickets: { progressChannelId: channel.id },
      });

      return replyOrEdit(interaction, {
        content: [
          `✅ Ticket progress channel set to ${channel}.`,
          '',
          'From now on, every new ticket will create one entry in that channel.',
          'The entry is automatically updated when the ticket is claimed, closed, or deleted.',
          '',
          '> **Tip:** The transcript channel (set via `/ticket setup`) is separate — it receives HTML transcripts on close.',
        ].join('\n'),
        ephemeral: true,
      });
    }

    // ── clear ──────────────────────────────────────────────────────────────
    if (sub === 'clear') {
      const settings = await getGuildSettings(guildId);
      const current  = settings?.tickets?.progressChannelId ?? null;

      if (!current) {
        return replyOrEdit(interaction, {
          content: '⚠️ No ticket progress channel is currently set.',
          ephemeral: true,
        });
      }

      await setGuildSettings(guildId, {
        tickets: { progressChannelId: null },
      });

      return replyOrEdit(interaction, {
        content: '✅ Ticket progress channel removed. New tickets will no longer post progress entries.',
        ephemeral: true,
      });
    }

    // ── status ─────────────────────────────────────────────────────────────
    if (sub === 'status') {
      const settings   = await getGuildSettings(guildId);
      const progressId = settings?.tickets?.progressChannelId ?? null;
      const transcriptId = settings?.tickets?.transcriptChannelId ?? null;

      const embed = new EmbedBuilder()
        .setTitle('🎫 Ticket Channel Configuration')
        .setColor(progressId ? 0x22c55e : 0x6b7280)
        .addFields(
          {
            name: '📋 Progress Channel',
            value: progressId
              ? `<#${progressId}>\nA live status embed is posted here for each ticket (created → claimed → closed).`
              : '❌ Not set — use `/ticketlog set #channel` to enable.',
            inline: false,
          },
          {
            name: '📄 Transcript Channel',
            value: transcriptId
              ? `<#${transcriptId}>\nAn HTML transcript is automatically sent here when a ticket is closed or deleted.`
              : '❌ Not set — use `/ticket setup transcript_channel:` to enable.',
            inline: false,
          },
        )
        .setTimestamp()
        .setFooter({ text: interaction.guild.name });

      return replyOrEdit(interaction, { embeds: [embed], ephemeral: true });
    }

    return replyOrEdit(interaction, { content: 'Unknown subcommand.', ephemeral: true });
  },
};
