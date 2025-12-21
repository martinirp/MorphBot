const { createEmbed } = require('../utils/embed');
const queueManager = require('../utils/queueManager');
const db = require('../utils/db');
const { getRelatedVideos } = require('../utils/youtubeApi');

async function execute(message) {
  const guildId = message.guild.id;
  const g = queueManager.get(guildId);

  if (!g.current) {
    return message.channel.send({
      embeds: [
        createEmbed().setDescription('❌ Nenhuma música tocando no momento.')
      ]
    });
  }

  const statusMsg = await message.channel.send({
    embeds: [createEmbed().setDescription('🤖 Auto-DJ: buscando músicas relacionadas...')]
  });

  try {
    // Buscar 5 vídeos relacionados à música atual
    const related = await getRelatedVideos(g.current.videoId, 5);

    if (!related || related.length === 0) {
      throw new Error('Não foi possível encontrar músicas relacionadas.');
    }

    let added = 0;

    for (const video of related) {
      // Verificar se já está na fila
      const alreadyInQueue = g.queue.some(s => s.videoId === video.videoId);
      if (alreadyInQueue) continue;

      // Adicionar à fila
      const song = db.getByVideoId(video.videoId) || {
        videoId: video.videoId,
        title: video.title,
        metadata: {
          channel: video.channel,
          thumbnail: video.thumbnail
        }
      };

      await queueManager.play(
        guildId,
        g.voiceChannel,
        song,
        message.channel
      );

      added++;
    }

    await statusMsg.edit({
      embeds: [
        createEmbed()
          .setTitle('🤖 Auto-DJ ativado')
          .setDescription(`✅ Adicionadas **${added}** músicas relacionadas à fila baseadas em:\n**${g.current.title}**`)
      ]
    });
  } catch (error) {
    console.error('[AUTODJ] Erro:', error);
    await statusMsg.edit({
      embeds: [
        createEmbed().setDescription(`❌ Erro ao ativar Auto-DJ: ${error.message}`)
      ]
    });
  }
}

module.exports = {
  name: 'autodj',
  aliases: ['dj', 'autoplay'],
  description: 'Adiciona automaticamente 5 músicas relacionadas à música atual',
  usage: '#autodj',
  execute
};
