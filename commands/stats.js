const { createEmbed } = require('../utils/embed');
const db = require('../utils/db');

async function execute(message) {
  try {
    const stats = db.getStats();

    return message.channel.send({
      embeds: [
        createEmbed()
          .setTitle('📊 Estatísticas do Bot')
          .addFields(
            { name: '🎵 Músicas em Cache', value: `${stats.totalSongs}` },
            { name: '🔍 Chaves de Busca', value: `${stats.totalKeys}` },
            { name: '💾 DB Otimizado', value: 'WAL + 64MB cache ✅' },
            { name: '⚡ Bitrate Áudio', value: '96 kbps (otimizado)' }
          )
      ]
    });
  } catch (err) {
    console.error('[STATS] Erro:', err);
    message.channel.send({
      embeds: [
        createEmbed()
          .setDescription('❌ Erro ao obter estatísticas.')
      ]
    }).catch(() => {});
  }
}

module.exports = {
  name: 'stats',
  aliases: ['estatísticas', 'info'],
  description: 'Exibe estatísticas do bot (músicas em cache, chaves de busca)',
  usage: '#stats',
  execute
};
