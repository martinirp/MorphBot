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

// Roles que podem usar o comando
const ALLOWED_ROLES = ['Admin', 'Moderador', 'DJ', 'MODS'];

async function execute(message) {
  const guildId = message.guild.id;
  const voiceChannel = message.member.voice.channel;
  const textChannel = message.channel;

  console.log(`[PLAYNOW] comando recebido em ${guildId} por ${message.author.tag}`);

  // =====================================================
  // ✅ VERIFICAÇÃO DE PRIVILÉGIOS
  // =====================================================
  const hasPermission = 
    message.member.permissions.has('ADMINISTRATOR') ||
    message.member.roles.cache.some(role => ALLOWED_ROLES.includes(role.name));

  if (!hasPermission) {
    return textChannel.send({
      embeds: [
        createEmbed().setDescription('❌ Você não tem permissão para usar este comando.')
      ]
    });
  }

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
      console.log('[PLAYNOW] Detectado link Spotify, resolvendo metadata...');

      const spotifyData = await resolveSpotifyTrack(query);
      
      if (!spotifyData) {
        throw new Error('Não foi possível resolver o link do Spotify. Tente novamente.');
      }

      // Busca a música no YouTube usando artista + título
      console.log(`[PLAYNOW] Buscando no YouTube: "${spotifyData.query}"`);
      const result = await resolve(spotifyData.query);

      const song = result.fromCache
        ? db.getByVideoId(result.videoId)
        : { videoId: result.videoId, title: spotifyData.query, metadata: { spotifyId: spotifyData.trackId } };

      // Se veio do banco mas não tiver spotifyId, adicionamos para futuras recomendações
      if (song && song.metadata && !song.metadata.spotifyId && spotifyData.trackId) {
        song.metadata.spotifyId = spotifyData.trackId;
      }

      await queueManager.playNow(
        guildId,
        voiceChannel,
        song,
        textChannel
      );

      await statusMsg.edit({
        embeds: [
          createEmbed()
            .setDescription(`✅ Próximo: **${spotifyData.title}** por **${spotifyData.artist}**`)
        ]
      });

      return;
    }

    // =====================================================
    // 🔗 LINK DO YOUTUBE
    // =====================================================
    if (isYoutubeLink(query)) {
      const video = await resolveVideo(query);

      let song = db.getByVideoId(video.videoId) || {
        videoId: video.videoId,
        title: video.title
      };

      await queueManager.playNow(
        guildId,
        voiceChannel,
        song,
        textChannel
      );

      await statusMsg.edit({
        embeds: [
          createEmbed()
            .setDescription(`✅ Próximo a tocar: **${song.title}**`)
        ]
      });

      return;
    }

    // =====================================================
    // 🔗 OUTRAS FONTES (SoundCloud/Bandcamp/Direct URLs)
    // =====================================================
    const sourceType = detectSourceType(query);
    
    if (sourceType !== 'search' && sourceType !== 'youtube') {
      const { exec } = require('child_process');
      const util = require('util');
      const execP = util.promisify(exec);

      let video;
      try {
        const { stdout } = await execP(
          `yt-dlp --dump-json --no-playlist "${query}"`
        );
        const data = JSON.parse(stdout);
        video = {
          videoId: data.id || require('crypto').createHash('md5').update(query).digest('hex'),
          title: data.title || 'Áudio externo',
          channel: data.uploader || sourceType
        };
      } catch (err) {
        console.error('[PLAYNOW] erro ao resolver URL:', err);
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

      await queueManager.playNow(
        guildId,
        voiceChannel,
        song,
        textChannel
      );

      await statusMsg.edit({
        embeds: [
          createEmbed()
            .setDescription(`✅ Próximo: **${song.title}**`)
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

    await queueManager.playNow(
      guildId,
      voiceChannel,
      song,
      textChannel
    );

    await statusMsg.edit({
      embeds: [
        createEmbed()
          .setDescription(`✅ Próximo a tocar: **${song.title}**`)
      ]
    });
  } catch (err) {
    console.error('[PLAYNOW] Erro:', err);
    
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
  name: 'playnow',
  aliases: ['pn', 'pnow', 'next'],
  description: 'Coloca uma música como próxima a tocar (requer privilégios)',
  usage: '#playnow <nome ou link> | #pn <nome ou link> | %pn <nome ou link>',
  permissions: ['ADMINISTRATOR'],
  execute
};
