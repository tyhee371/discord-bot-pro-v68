const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { replyOrEdit } = require('../../utils/reply');
const { getGuildSettings } = require('../../utils/settings');
const { resolveLogChannel } = require('../../utils/logService');
const { getTicket } = require('../../services/ticketService');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function fetchManyMessages(channel, max = 500) {
  const out = [];
  let lastId = undefined;

  while (out.length < max) {
    const batch = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
    if (!batch || batch.size === 0) break;

    const arr = [...batch.values()];
    out.push(...arr);
    lastId = arr[arr.length - 1].id;

    if (batch.size < 100) break;
  }

  // oldest first
  out.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return out.slice(-max);
}

function buildHtmlTranscript(guild, channel, ticket, messages) {
  const title = `${guild.name} - #${channel.name}`;
  const meta = `Ticket: ${channel.name} | Type: ${ticket?.typeValue ?? 'n/a'} | Opener: ${ticket?.openerId ?? 'n/a'} | Created: ${ticket?.createdAt ? new Date(ticket.createdAt).toLocaleString() : 'n/a'}`;

  const rows = messages.map((m) => {
    const author = m.member?.displayName || m.author?.tag || 'Unknown';
    const time = new Date(m.createdTimestamp).toLocaleString();
    const content = esc(m.content || '');

    const atts = [...m.attachments.values()].map((a) => `<a href="${esc(a.url)}" target="_blank">${esc(a.name ?? 'attachment')}</a>`).join(' · ');
    const embeds = (m.embeds || []).length ? `<div class="embeds">[${m.embeds.length} embed(s)]</div>` : '';

    return `
      <div class="msg">
        <div class="head">
          <span class="author">${esc(author)}</span>
          <span class="time">${esc(time)}</span>
        </div>
        <div class="content">${content ? content.replace(/\n/g, '<br>') : '<span class="muted">(no text)</span>'}</div>
        ${atts ? `<div class="att">${atts}</div>` : ''}
        ${embeds}
      </div>
    `;
  }).join('\n');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<style>
body{font-family:system-ui,Segoe UI,Arial,sans-serif;background:#0b0f19;color:#e5e7eb;margin:0;padding:18px}
.header{padding:14px 16px;background:#111827;border:1px solid #1f2937;border-radius:10px;margin-bottom:12px}
.h1{font-size:18px;font-weight:800;margin:0 0 6px}
.meta{font-size:12px;color:#9ca3af}
.msg{padding:12px 14px;border:1px solid #1f2937;background:#0f172a;border-radius:10px;margin:10px 0}
.head{display:flex;gap:10px;align-items:baseline}
.author{font-weight:800}
.time{font-size:12px;color:#9ca3af}
.content{margin-top:6px;line-height:1.35}
.att{margin-top:8px;font-size:12px}
.att a{color:#93c5fd;text-decoration:none}
.muted{color:#9ca3af}
.embeds{margin-top:8px;font-size:12px;color:#cbd5e1}
</style>
</head>
<body>
  <div class="header">
    <div class="h1">${esc(title)}</div>
    <div class="meta">${esc(meta)}</div>
  </div>
  ${rows || '<div class="msg"><span class="muted">No messages found.</span></div>'}
</body>
</html>`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('transcript')
    .setDescription('Create a ticket transcript (HTML) and send it to the transcript/log channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Ticket channel (default: current)').setRequired(false),
    )
    .addBooleanOption((o) =>
      o.setName('dm_user').setDescription('Also DM the opener with the transcript (default: false)').setRequired(false),
    ),

  async execute(interaction) {
    if (!interaction.guild) return replyOrEdit(interaction, { content: '❌ Server only.' });

    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    if (!channel || !channel.isTextBased?.()) {
      return replyOrEdit(interaction, { content: '❌ Invalid channel.' });
    }

    const ticket = await getTicket(interaction.guildId, channel.id);
    if (!ticket) {
      return replyOrEdit(interaction, { content: '❌ That channel is not a ticket channel.' });
    }

    // permission gate: opener OR staff roles from ticket setup OR ManageMessages
    const settings = await getGuildSettings(interaction.guildId);
    const adminRoleId = settings?.tickets?.adminRoleId ?? null;
    const modRoleId = settings?.tickets?.modRoleId ?? settings?.tickets?.supportRoleId ?? null;

    const isOpener = ticket.openerId === interaction.user.id;
    const isStaff =
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ||
      (adminRoleId && interaction.member?.roles?.cache?.has(adminRoleId)) ||
      (modRoleId && interaction.member?.roles?.cache?.has(modRoleId));

    if (!isOpener && !isStaff) {
      return replyOrEdit(interaction, { content: '❌ You do not have permission to create a transcript for this ticket.' });
    }

    await replyOrEdit(interaction, { content: '🧾 Building transcript…' });

    const messages = await fetchManyMessages(channel, 500);
    const html = buildHtmlTranscript(interaction.guild, channel, ticket, messages);

    const fileName = `${channel.name}-transcript.html`;
    const attachment = new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: fileName });

    const transcriptChannelId = settings?.tickets?.transcriptChannelId ?? null;
    const logChannel = transcriptChannelId ? await resolveLogChannel(interaction.guild, transcriptChannelId) : null;

    if (logChannel) {
      await logChannel.send({
        content: `🧾 Transcript for ${channel} (requested by ${interaction.user})`,
        files: [attachment],
      }).catch(() => {});
    }

    const dmUser = interaction.options.getBoolean('dm_user') ?? false;
    if (dmUser && ticket.openerId) {
      const opener = await interaction.guild.members.fetch(ticket.openerId).catch(() => null);
      if (opener) {
        await opener.send({
          content: `🧾 Here is your ticket transcript from **${interaction.guild.name}**: #${channel.name}`,
          files: [attachment],
        }).catch(() => {});
      }
    }

    return replyOrEdit(interaction, {
      content: logChannel
        ? `✅ Transcript sent to ${logChannel}.`
        : '✅ Transcript created. (No transcript channel set in `/ticket setup`, so it was not posted anywhere.)',
    });
  },
};
