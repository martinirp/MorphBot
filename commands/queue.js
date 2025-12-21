const { createEmbed } = require('../utils/embed');
const queueManager = require('../utils/queueManager');
const { getVideoDetails } = require('../utils/youtubeApi');

/**
 * Converte duração em formato legível (HH:MM:SS ou MM:SS) para segundos
 */
function durationToSeconds(duration) {
  if (!duration) return 0;
  
  const parts = duration.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

/**
 * Converte segundos para formato HH:MM:SS ou MM:SS
 */
function secondsToDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

async function execute(message) {
  const guildId = message.guild.id;
  const textChannel = message.channel;

  const g = queueManager.guilds.get(guildId);

  if (!g || (!g.playing && g.queue.length === 0)) {
    return textChannel.send({
      embeds: [
        createEmbed()
          .setTitle('📭 Fila de reprodução')
          .setDescription('A fila está vazia.')
      ]
    });
  }

  const embed = createEmbed()
    .setTitle('🎶 Fila de reprodução');

  // 🎵 música atual
  if (g.playing && g.current) {
    embed.addFields({
      name: '🎵 Tocando agora',
      value: `**${g.current.title}**`
    });
  }

  // 📜 próximas músicas
  if (g.queue.length > 0) {
    // Buscar durações das músicas da fila (em paralelo, até 10)
    const queueSlice = g.queue.slice(0, 10);
    
    const durationsPromises = queueSlice.map(async song => {
      if (song.duration) return song.duration;
      if (song.metadata?.duration) return song.metadata.duration;
      
      // Buscar duração via API se não tiver
      if (song.videoId) {
        const details = await getVideoDetails(song.videoId).catch(() => null);
        if (details?.duration) {
          song.duration = details.duration;
          return details.duration;
        }
      }
      return null;
    });

    const durations = await Promise.all(durationsPromises);
    
    // Calcular tempo acumulado
    let accumulatedSeconds = 0;
    
    const list = queueSlice.map((s, i) => {
      const duration = durations[i];
      const durationSeconds = durationToSeconds(duration);
      
      const timeUntil = accumulatedSeconds > 0 ? ` • Em ${secondsToDuration(accumulatedSeconds)}` : '';
      const durationDisplay = duration ? ` [${duration}]` : '';
      
      accumulatedSeconds += durationSeconds;
      
      return `${i + 1}. ${s.title}${durationDisplay}${timeUntil}`;
    }).join('\n');

    const totalDuration = accumulatedSeconds > 0 ? ` • Tempo total: ${secondsToDuration(accumulatedSeconds)}` : '';

    embed.addFields({
      name: `📜 Próximas músicas${totalDuration}`,
      value: list
    });

    if (g.queue.length > 10) {
      embed.setFooter({
        text: `+ ${g.queue.length - 10} música(s) na fila`
      });
    }
  }

  return textChannel.send({ embeds: [embed] });
}

module.exports = {
  name: 'queue',
  aliases: ['q', 'fila'],
  description: 'Mostra a fila de reprodução com duração e tempo até tocar',
  usage: '#queue',
  execute
};
