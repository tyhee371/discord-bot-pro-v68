const { EmbedBuilder } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../stores/settings');
const { logger } = require('./logger');

async function getErrorsConfig(guildId) {
  const s = await getGuildSettings(guildId);
  return s.errors ?? { channelId: null, enabled: false };
}

async function setErrorsConfig(guildId, patch) {
  const s = await getGuildSettings(guildId);
  const cfg = { ...(s.errors ?? {}), ...patch };
  await setGuildSettings(guildId, { errors: cfg });
  return cfg;
}

function stackSnippet(err) {
  const stack = String(err?.stack || err || '');
  return stack.split('\n').slice(0, 10).join('\n').slice(0, 1800);
}

async function getEnabledChannels(client) {
  const out = [];
  for (const guild of client.guilds.cache.values()) {
    const cfg = await getErrorsConfig(guild.id).catch(() => null);
    if (!cfg?.enabled || !cfg?.channelId) continue;
    const ch = await guild.channels.fetch(cfg.channelId).catch(() => null);
    if (!ch?.isTextBased?.()) continue;
    out.push({ guild, channel: ch, cfg });
  }
  return out;
}

async function reportInteractionError(interaction, err, commandName) {
  try {
    const guild = interaction?.guild;
    if (!guild) return;

    const cfg = await getErrorsConfig(guild.id);
    if (!cfg.enabled || !cfg.channelId) return;

    const ch = await guild.channels.fetch(cfg.channelId).catch(() => null);
    if (!ch?.isTextBased?.()) return;

    const emb = new EmbedBuilder()
      .setTitle('⚠️ Bot Error')
      .setColor(0xed4245)
      .addFields(
        { name: 'Command', value: `/${commandName || interaction.commandName || 'unknown'}`.slice(0, 1024), inline: true },
        { name: 'User', value: `${interaction.user?.tag ?? 'unknown'} (${interaction.user?.id ?? 'n/a'})`, inline: true },
      )
      .setTimestamp();

    const snip = stackSnippet(err);
    if (snip) emb.addFields({ name: 'Stack (top)', value: '```js\n' + (snip.length > 1000 ? snip.slice(0, 1000) + '…' : snip) + '\n```' });

    await ch.send({ embeds: [emb] }).catch(() => null);
  } catch (e) {
    logger.warn({ err: e }, 'Failed to report interaction error');
  }
}

async function reportProcessError(client, err, kind = 'process') {
  try {
    if (!client?.guilds?.cache?.size) return;
    const chans = await getEnabledChannels(client);
    if (!chans.length) return;

    const snip = stackSnippet(err);
    const emb = new EmbedBuilder()
      .setTitle('🧯 Process Error')
      .setColor(0xed4245)
      .addFields({ name: 'Type', value: String(kind).slice(0, 1024), inline: true })
      .setTimestamp();
    if (snip) emb.addFields({ name: 'Stack (top)', value: '```js\n' + (snip.length > 1000 ? snip.slice(0, 1000) + '…' : snip) + '\n```' });

    await Promise.allSettled(chans.map(({ channel }) => channel.send({ embeds: [emb] })));
  } catch (e) {
    logger.warn({ err: e }, 'Failed to report process error');
  }
}

async function reportStartupLoadErrors(client, loadErrors) {
  try {
    if (!client?.guilds?.cache?.size) return;
    const errs = Array.isArray(loadErrors) ? loadErrors : [];
    if (!errs.length) return;

    const chans = await getEnabledChannels(client);
    if (!chans.length) return;

    const list = errs
      .slice(0, 15)
      .map((e) => `• **${e.label}**: \`${e.filePath}\` — ${String(e.message || '').slice(0, 120)}`)
      .join('\n');

    const emb = new EmbedBuilder()
      .setTitle('🚧 Startup Load Errors')
      .setColor(0xf1c40f)
      .setDescription(`Some files failed to load on startup.\n\nTotal: **${errs.length}**\n\n${list}${errs.length > 15 ? `\n… and ${errs.length - 15} more` : ''}`)
      .setTimestamp();

    await Promise.allSettled(chans.map(({ channel }) => channel.send({ embeds: [emb] })));
  } catch (e) {
    logger.warn({ err: e }, 'Failed to report startup load errors');
  }
}

async function reportSafeModeDisabled(interaction, kind, name, disabledUntil, err) {
  try {
    const guild = interaction?.guild;
    if (!guild) return;

    const cfg = await getErrorsConfig(guild.id);
    if (!cfg.enabled || !cfg.channelId) return;

    const ch = await guild.channels.fetch(cfg.channelId).catch(() => null);
    if (!ch?.isTextBased?.()) return;

    const emb = new EmbedBuilder()
      .setTitle('🛡️ Safe Mode: Disabled a Handler')
      .setColor(0xf1c40f)
      .addFields(
        { name: 'Type', value: String(kind), inline: true },
        { name: 'Name', value: String(name).slice(0, 1024), inline: true },
        { name: 'Until', value: `<t:${Math.floor(disabledUntil / 1000)}:R>`, inline: true },
      )
      .setTimestamp();

    const snip = stackSnippet(err);
    if (snip) emb.addFields({ name: 'Reason (top)', value: '```js\n' + (snip.length > 900 ? snip.slice(0, 900) + '…' : snip) + '\n```' });

    await ch.send({ embeds: [emb] }).catch(() => null);
  } catch (e) {
    logger.warn({ err: e }, 'Failed to report safe mode disable');
  }
}

module.exports = {
  getErrorsConfig,
  setErrorsConfig,
  reportInteractionError,
  reportProcessError,
  reportStartupLoadErrors,
  reportSafeModeDisabled,
};
