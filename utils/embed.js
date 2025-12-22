const { EmbedBuilder } = require('discord.js');

function createEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTimestamp()
    .setFooter({ text: 'Music Bot' });
}

/**
 * Cria embed rico para música com metadados completos
 * @param {Object} song - Objeto com videoId, title, channel, thumbnail, duration, views
 * @param {string} status - Status ('playing', 'queued', 'added')
 */
function createSongEmbed(song, status = 'playing', loop = false) {
  const embed = createEmbed();

  const statusEmoji = {
    playing: '▶️ Tocando agora',
    queued: '📝 Adicionado à fila',
    added: '✅ Adicionado'
  };

  embed.setTitle(statusEmoji[status] || '🎵 Música');
  embed.setDescription(`**${song.title}**`);

  if (song.channel) {
    embed.addFields({ name: '👤 Canal', value: song.channel, inline: true });
  }

  if (song.duration) {
    embed.addFields({ name: '⏱️ Duração', value: song.duration, inline: true });
  }

  // Mostrar estado de loop dentro do embed
  if (status === 'playing') {
    embed.addFields({ name: '🔁 Loop', value: loop ? 'Ativado' : 'Desativado', inline: true });
  }

  if (song.videoId) {
    embed.setURL(`https://www.youtube.com/watch?v=${song.videoId}`);
  }

  return embed;
}

module.exports = { createEmbed, createSongEmbed };
