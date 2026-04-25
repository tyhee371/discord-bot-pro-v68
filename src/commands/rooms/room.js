const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, GuildSystemChannelFlags } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/settings');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('room')
    .setDescription('Temporary voice room system (join-to-create).')
    .addSubcommand(s =>
      s.setName('setup')
        .setDescription('Configure temp rooms.')
        .addChannelOption(o =>
          o.setName('master')
            .setDescription('Master voice channel (join-to-create)')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true),
        )
        .addChannelOption(o =>
          o.setName('category')
            .setDescription('Category where rooms will be created')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true),
        )
        .addIntegerOption(o =>
          o.setName('default_user_limit')
            .setDescription('Default user limit (0 = unlimited)')
            .setMinValue(0).setMaxValue(99)
            .setRequired(false),
        )
        .addIntegerOption(o =>
          o.setName('default_bitrate')
            .setDescription('Default bitrate in bps (e.g. 64000). Leave empty for server default.')
            .setMinValue(8000).setMaxValue(384000)
            .setRequired(false),
        )
        .addStringOption(o =>
          o.setName('name_template')
            .setDescription("Room name template. Use {user}. Example: '{user} room'")
            .setRequired(false),
        )
        .addStringOption(o =>
          o.setName('default_region')
            .setDescription("RTC region override (e.g. 'sydney') or 'auto'")
            .setRequired(false),
        ),
    )
    .addSubcommand(s =>
      s.setName('disable')
        .setDescription('Disable temp rooms.'),
    )
    .addSubcommand(s =>
      s.setName('status')
        .setDescription('Show current room configuration.'),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'setup') {
      const master = interaction.options.getChannel('master', true);
      const category = interaction.options.getChannel('category', true);
      const defaultUserLimit = interaction.options.getInteger('default_user_limit');
      const defaultBitrate = interaction.options.getInteger('default_bitrate');
      const nameTemplate = interaction.options.getString('name_template');
      const region = interaction.options.getString('default_region');

      const defaultRegion = !region ? null : (region.toLowerCase() === 'auto' ? null : region);

      await setGuildSettings(interaction.guildId, {
        rooms: {
          masterChannelId: master.id,
          categoryId: category.id,
          defaultUserLimit: defaultUserLimit ?? 0,
          defaultBitrate: defaultBitrate ?? null,
          nameTemplate: nameTemplate ?? "{user}'s room",
          defaultRegion,
        },
      });

      // Suppress Discord's "X started a voice hangout" system message.
      // This fires whenever anyone joins a voice channel and pollutes general chat.
      // We set the SuppressVoiceChannelStatus flag on the guild's system channel settings.
      let hangoutNote = '';
      try {
        const guild = interaction.guild;
        const currentFlags = guild.systemChannelFlags;
        const suppressFlag = GuildSystemChannelFlags.SuppressVoiceChannelStatus;
        if (suppressFlag && !currentFlags.has(suppressFlag)) {
          await guild.edit({
            systemChannelFlags: currentFlags.add(suppressFlag),
          });
          hangoutNote = '\n• 🔇 "Voice hangout" system messages suppressed.';
        }
      } catch {
        hangoutNote = '\n• ⚠️ Could not suppress "voice hangout" messages (missing Manage Server perm?).';
      }

      return interaction.editReply(
        `✅ Temp rooms configured.\n• Master: ${master}\n• Category: <#${category.id}>\n• Default limit: ${defaultUserLimit ?? 0}\n• Default bitrate: ${defaultBitrate ?? '(server default)'}\n• Template: \`${nameTemplate ?? "{user}'s room"}\`\n• Region: ${defaultRegion ?? 'auto'}${hangoutNote}`,
      );
    }

    if (sub === 'disable') {
      await setGuildSettings(interaction.guildId, { rooms: null });
      return interaction.editReply('✅ Temp rooms disabled.');
    }

    if (sub === 'status') {
      const s = await getGuildSettings(interaction.guildId);
      const r = s.rooms;
      if (!r) return interaction.editReply('Temp rooms are not configured. Use `/room setup`.');

      return interaction.editReply(
        `Temp rooms:\n• Master: <#${r.masterChannelId}>\n• Category: <#${r.categoryId}>\n• Default limit: ${r.defaultUserLimit ?? 0}\n• Default bitrate: ${r.defaultBitrate ?? '(server default)'}\n• Template: \`${r.nameTemplate ?? "{user}'s room"}\`\n• Region: ${r.defaultRegion ?? 'auto'}`,
      );
    }
  },
};
