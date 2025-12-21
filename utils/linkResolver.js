const { spawn } = require('child_process');
const { getPlaylistItems } = require('./youtubeApi');

function isYoutubeLink(input) {
  return /youtu\.?be/.test(input);
}

function isSoundCloudLink(input) {
  return /soundcloud\.com/.test(input);
}

function isBandcampLink(input) {
  return /bandcamp\.com/.test(input);
}

function isSpotifyLink(input) {
  return /spotify\.com|spotify:/.test(input);
}

function isDirectAudioUrl(input) {
  return /\.(mp3|ogg|m4a|wav|flac|aac|opus|webm)$/i.test(input);
}

function isPlaylist(input) {
  return /list=/.test(input);
}

function getPlaylistId(url) {
  const match = url.match(/[?&]list=([^&]+)/);
  return match ? match[1] : null;
}

function detectSourceType(input) {
  if (isDirectAudioUrl(input)) return 'direct';
  if (isSoundCloudLink(input)) return 'soundcloud';
  if (isBandcampLink(input)) return 'bandcamp';
  if (isSpotifyLink(input)) return 'spotify';
  if (isYoutubeLink(input)) return 'youtube';
  return 'search';
}

async function resolveVideo(url) {
  const { exec } = require('child_process');
  const util = require('util');
  const execP = util.promisify(exec);

  const { stdout } = await execP(
    `yt-dlp --dump-json --no-playlist "${url}"`
  );

  const data = JSON.parse(stdout);

  return {
    videoId: data.id,
    title: data.title,
    channel: data.uploader
  };
}

function resolvePlaylist(url) {
  const playlistId = getPlaylistId(url);
  
  if (!playlistId) {
    return Promise.reject(new Error('ID da playlist não encontrado'));
  }

  // Tentar YouTube API primeiro (muito mais rápido)
  return getPlaylistItems(playlistId, 100)
    .then(result => {
      if (result) {
        console.log(`[PLAYLIST] YouTube API resolveu ${result.videos.length} vídeos`);
        return result;
      }
      
      // Fallback: yt-dlp
      console.log('[PLAYLIST] YouTube API indisponível, usando yt-dlp...');
      return resolvePlaylistYtDlp(url);
    })
    .catch(err => {
      console.error('[PLAYLIST] Erro na API, fallback yt-dlp:', err.message);
      return resolvePlaylistYtDlp(url);
    });
}

function resolvePlaylistYtDlp(url) {
  return new Promise((resolve, reject) => {
    const yt = spawn('yt-dlp', [
      '--flat-playlist',
      '--dump-json',
      url
    ]);

    const videos = [];
    let buffer = '';

    yt.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        try {
          const d = JSON.parse(line);
          videos.push({
            videoId: d.id,
            title: d.title
          });
        } catch {}
      }
    });

    yt.on('close', code => {
      if (code !== 0) return reject(new Error('Erro playlist'));
      resolve({
        title: 'Playlist do YouTube',
        videos
      });
    });
  });
}

module.exports = {
  isYoutubeLink,
  isSoundCloudLink,
  isBandcampLink,
  isSpotifyLink,
  isDirectAudioUrl,
  detectSourceType,
  isPlaylist,
  getPlaylistId,
  resolveVideo,
  resolvePlaylist
};
