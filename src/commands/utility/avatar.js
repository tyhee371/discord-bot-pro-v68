const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { safeReply, safeDefer } = require('../../utils/safeReply');

function buildSizeLinks(makeUrl) {
  const sizes = [128, 256, 512, 1024, 2048, 4096];
  return sizes.map((s) => `[${s}](${makeUrl(s)})`).join(' • ');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Show a user avatar (server avatar by default).')
    .addUserOption((o) => o.setName('user').setDescription('Target user').setRequired(false))
    .addBooleanOption((o) =>
      o.setName('global').setDescription('Show global avatar instead of server avatar').setRequired(false),
    ),

  async execute(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const member = interaction.guild ? interaction.options.getMember('user') : null;

    const useGlobal = interaction.options.getBoolean('global') || false;

    const serverUrl =
      member?.displayAvatarURL?.({ extension: 'png', size: 1024, forceStatic: false }) ||
      user.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: false });

    const globalUrl = user.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: false });

    const selectedUrl = useGlobal ? globalUrl : serverUrl;

    const emb = new EmbedBuilder()
      .setTitle(`${user.tag}'s Avatar`)
      .setDescription(
        `**Selected:** ${useGlobal ? 'Global avatar' : 'Server avatar'}
` +
          `**Server:** ${buildSizeLinks((s) => (member ? member.displayAvatarURL({ extension: 'png', size: s }) : globalUrl))}
` +
          `**Global:** ${buildSizeLinks((s) => user.displayAvatarURL({ extension: 'png', size: s }))}`,
      )
      .setImage(selectedUrl);

    // Thumbnail as the other avatar type (handy)
    const otherUrl = useGlobal ? serverUrl : globalUrl;
    if (otherUrl) emb.setThumbnail(otherUrl);

    return safeReply(interaction, { embeds: [emb] });
  },
};