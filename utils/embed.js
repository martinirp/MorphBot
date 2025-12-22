const { EmbedBuilder } = require('discord.js');

function createEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTimestamp()
    .setFooter({ text: 'Music Bot' });
}

// Decodifica entidades HTML comuns em strings (ex: &quot; → ")
function decodeHtml(str) {
  if (!str || typeof str !== 'string') return str;
  let s = str;
  const entities = {
    '&quot;': '"',
    '&#34;': '"',
    '&amp;': '&',
    '&#39;': "'",
    '&apos;': "'",
    '&lt;': '<',
    '&gt;': '>'
  };

  s = s.replace(/&[a-zA-Z0-9#]+;/g, match => entities[match] || match);

  // numeric entities
  s = s.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  s = s.replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  return s;
}

/**
 * Cria embed rico para música com metadados completos
 * @param {Object} song - Objeto com videoId, title, channel, thumbnail, duration, views
 * @param {string} status - Status ('playing', 'queued', 'added')
 */
function createSongEmbed(song, status = 'playing', loop = false, autoDJ = false) {
  const embed = createEmbed();

  const statusEmoji = {
    playing: '▶️ Tocando agora',
    queued: '📝 Adicionado à fila',
    added: '✅ Adicionado'
  };

  embed.setTitle(statusEmoji[status] || '🎵 Música');
  const cleanTitle = decodeHtml(song.title || '');
  embed.setDescription(`**${cleanTitle}**`);

  if (song.channel) {
    embed.addFields({ name: '👤 Canal', value: decodeHtml(song.channel), inline: true });
  }

  if (song.duration) {
    embed.addFields({ name: '⏱️ Duração', value: song.duration, inline: true });
  }

  // Mostrar estados (loop + auto-dj) dentro do embed
  if (status === 'playing') {
    embed.addFields({ name: '🔁 Loop', value: loop ? 'Ativado' : 'Desativado', inline: true });
    embed.addFields({ name: '🎧 Auto', value: autoDJ ? 'Ativado' : 'Desativado', inline: true });
  }

  if (song.videoId) {
    embed.setURL(`https://www.youtube.com/watch?v=${song.videoId}`);
  }

  return embed;
}

module.exports = { createEmbed, createSongEmbed, decodeHtml };
