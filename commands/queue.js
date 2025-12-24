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
    const queueSlice = g.queue.slice(0, 10);

    // Primeiro envio rápido com durações já conhecidas (sem bloquear na API)
    const initialDurations = queueSlice.map(s => s.duration || s.metadata?.duration || null);

    const buildList = (durations) => {
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

      return { list, totalDuration };
    };

    const initial = buildList(initialDurations);

    embed.addFields({
      name: `📜 Próximas músicas${initial.totalDuration}`,
      value: initial.list
    });

    if (g.queue.length > 10) {
      embed.setFooter({
        text: `+ ${g.queue.length - 10} música(s) na fila`
      });
    }
  }

  const sent = await textChannel.send({ embeds: [embed] });

  // Atualiza durations em background (assíncrono) e edita o embed quando disponível
  if (g && g.queue.length > 0) {
    (async () => {
      try {
        const queueSlice = g.queue.slice(0, 10);
        const durations = await Promise.all(queueSlice.map(async song => {
          if (song.duration) return song.duration;
          if (song.metadata?.duration) return song.metadata.duration;
          if (song.videoId) {
            const details = await getVideoDetails(song.videoId).catch(() => null);
            if (details?.duration) {
              song.duration = details.duration;
              return details.duration;
            }
          }
          return null;
        }));

        // Se nada novo, não edita
        if (!durations.some(Boolean)) return;

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

        const updatedEmbed = createEmbed()
          .setTitle('🎶 Fila de reprodução');

        if (g.playing && g.current) {
          updatedEmbed.addFields({
            name: '🎵 Tocando agora',
            value: `**${g.current.title}**`
          });
        }

        updatedEmbed.addFields({
          name: `📜 Próximas músicas${totalDuration}`,
          value: list
        });

        if (g.queue.length > 10) {
          updatedEmbed.setFooter({
            text: `+ ${g.queue.length - 10} música(s) na fila`
          });
        }

        await sent.edit({ embeds: [updatedEmbed] });
      } catch (e) {
        // Se falhar, apenas ignora para não travar o comando
      }
    })();
  }

  return sent;
}

module.exports = {
  name: 'queue',
  aliases: ['q', 'fila'],
  description: 'Mostra a fila de reprodução com duração e tempo até tocar',
  usage: '#queue',
  execute
};
