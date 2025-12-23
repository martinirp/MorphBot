const { createEmbed } = require('../utils/embed');
const { resolve } = require('../utils/resolver');
const queueManager = require('../utils/queueManager');
const db = require('../utils/db');

const {
  isYoutubeLink,
  detectSourceType,
  isPlaylist,
  resolveVideo,
  resolvePlaylist,
  isSpotifyLink
} = require('../utils/linkResolver');

const { processPlaylistBatched } = require('../utils/playlistProcessor');
const { resolveSpotifyTrack } = require('../utils/spotifyResolver');

async function execute(message) {
  const guildId = message.guild.id;
  const voiceChannel = message.member.voice.channel;
  const textChannel = message.channel;

  console.log(`[PLAY] comando recebido em ${guildId}`);

  if (!voiceChannel) {
    return textChannel.send({
      embeds: [
        createEmbed().setDescription('❌ Entre em um canal de voz.')
      ]
    });
  }

  const query = message.content.split(' ').slice(1).join(' ').trim();
  if (!query) return;

  const statusMsg = await textChannel.send({
    embeds: [createEmbed().setDescription('🔍 Processando…')]
  });

  try {
    // =====================================================
    // 🎵 SPOTIFY LINK (busca no YouTube via metadata)
    // =====================================================
    if (isSpotifyLink(query)) {
      console.log('[PLAY] Detectado link Spotify, resolvendo metadata...');

      const spotifyData = await resolveSpotifyTrack(query);
      
      if (!spotifyData) {
        throw new Error('Não foi possível resolver o link do Spotify. Tente novamente.');
      }

      // Busca a música no YouTube usando artista + título
      console.log(`[PLAY] Buscando no YouTube: "${spotifyData.query}"`);
      const result = await resolve(spotifyData.query);

      const song = result.fromCache
        ? db.getByVideoId(result.videoId)
        : { videoId: result.videoId, title: spotifyData.query, metadata: { spotifyId: spotifyData.trackId } };

      // Se veio do banco mas não tiver spotifyId, adicionamos para futuras recomendações
      if (song && song.metadata && !song.metadata.spotifyId && spotifyData.trackId) {
        song.metadata.spotifyId = spotifyData.trackId;
      }

      await queueManager.play(
        guildId,
        voiceChannel,
        song,
        textChannel
      );

      await statusMsg.edit({
        embeds: [
          createEmbed()
            .setDescription(`✅ Spotify → YouTube: **${spotifyData.title}** por **${spotifyData.artist}**`)
        ]
      });

      return;
    }

    // =====================================================
    // 🔗 LINK DO YOUTUBE (VÍDEO SEMPRE PRIMEIRO)
    // =====================================================
    if (isYoutubeLink(query)) {
      // 🎵 resolve e toca o vídeo imediatamente
      const video = await resolveVideo(query);

      const dbSong = db.getByVideoId(video.videoId);
      // Sempre preferir o título recém-resolvido (para não exibir versões antigas ou truncadas)
      let song = dbSong
        ? { ...dbSong, title: video.title || dbSong.title }
        : { videoId: video.videoId, title: video.title };

      await queueManager.play(
        guildId,
        voiceChannel,
        song,
        textChannel
      );

      await statusMsg.edit({
        embeds: [
          createEmbed()
            .setDescription(`Adicionado à fila: **${song.title}**`)
        ]
      });

      // 📜 SE TAMBÉM FOR PLAYLIST, PERGUNTA DEPOIS
      if (isPlaylist(query)) {
        const playlist = await resolvePlaylist(query);

        // remove o vídeo atual da playlist
        playlist.videos = playlist.videos.filter(
          v => v.videoId !== video.videoId
        );

        if (playlist.videos.length === 0) return;

        const askMsg = await textChannel.send({
          embeds: [
            createEmbed()
              .setTitle('📜 Playlist detectada')
              .setDescription(
                `Este vídeo faz parte de uma playlist.\nDeseja adicionar as **${playlist.videos.length}** músicas restantes?`
              )
          ],
          components: [
            {
              type: 1,
              components: [
                { type: 2, style: 3, label: 'Sim', custom_id: 'pl_yes' },
                { type: 2, style: 4, label: 'Não', custom_id: 'pl_no' }
              ]
            }
          ]
        });

        const filter = i => i.user.id === message.author.id;
        const collector = askMsg.createMessageComponentCollector({
          filter,
          max: 1,
          time: 60000
        });

        collector.on('collect', async i => {
          if (i.deferred || i.replied) return;
          await i.deferUpdate();

          if (i.customId === 'pl_yes') {
            await processPlaylistBatched({
              playlist,
              guildId,
              voiceChannel,
              textChannel,
              limit: 100,
              batchSize: 10
            });
          }

          askMsg.edit({ components: [] }).catch(() => {});
        });
      }

      return;
    }

    // =====================================================
    // 🔗 OUTRAS FONTES (SoundCloud/Bandcamp/Direct URLs)
    // =====================================================
    const sourceType = detectSourceType(query);
    
    if (sourceType !== 'search' && sourceType !== 'youtube') {
      const { runYtDlpJson } = require('../utils/ytDlp');

      let video;
      try {
        const data = await runYtDlpJson([
          '--dump-json',
          '--no-playlist',
          query
        ]);
        video = {
          videoId: data.id || require('crypto').createHash('md5').update(query).digest('hex'),
          title: data.title || 'Áudio externo',
          channel: data.uploader || sourceType
        };
      } catch (err) {
        console.error('[PLAY] erro ao resolver URL:', err);
        video = {
          videoId: require('crypto').createHash('md5').update(query).digest('hex'),
          title: query.split('/').pop() || 'Áudio externo',
          channel: sourceType
        };
      }

      let song = db.getByVideoId(video.videoId) || {
        videoId: video.videoId,
        title: video.title,
        streamUrl: query
      };

      await queueManager.play(
        guildId,
        voiceChannel,
        song,
        textChannel
      );

      await statusMsg.edit({
        embeds: [
          createEmbed()
            .setDescription(`✅ Adicionado: **${song.title}**`)
        ]
      });

      return;
    }

    // =====================================================
    // 🔍 SEARCH NORMAL
    // =====================================================
    const result = await resolve(query);

    const song = result.fromCache
      ? db.getByVideoId(result.videoId)
      : { videoId: result.videoId, title: result.title };

    await queueManager.play(
      guildId,
      voiceChannel,
      song,
      textChannel
    );

    await statusMsg.edit({
      embeds: [
        createEmbed()
          .setDescription(`Adicionado à fila: **${song.title}**`)
      ]
    });
  } catch (err) {
    console.error('[PLAY] Erro:', err);
    
    await statusMsg.edit({
      embeds: [
        createEmbed()
          .setTitle('❌ Erro ao processar')
          .setDescription(err.message || 'Vídeo inválido ou inacessível')
      ]
    }).catch(() => {});
  }
}

module.exports = {
  name: 'play',
  aliases: ['p'],
  description: 'Toca uma música do YouTube, Spotify, SoundCloud ou URL direta',
  usage: '#play <nome ou link>',
  execute
};
