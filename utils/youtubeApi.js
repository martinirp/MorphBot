const axios = require('axios');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const API_BASE = 'https://www.googleapis.com/youtube/v3';
const PIPED_BASE = process.env.PIPED_API_BASE || 'https://piped.video/api/v1';

async function searchPiped(query) {
  try {
    const res = await axios.get(`${PIPED_BASE}/search`, {
      params: { q: query },
      timeout: 5000
    });
    const items = Array.isArray(res.data) ? res.data : [];
    const video = items.find(i => (i.type === 'video' || i.type === 'stream') && i.id && i.title);
    if (!video) return null;
    return {
      videoId: video.id,
      title: video.title,
      channel: video.uploaderName || video.uploader || '',
      thumbnail: video.thumbnail || video.thumbnailURL || '',
      channelId: video.uploaderId || ''
    };
  } catch (err) {
    console.error('[PIPED] Erro search:', err.message);
    return null;
  }
}

/**
 * Busca no YouTube usando a API oficial (muito mais rápido que yt-dlp)
 * @param {string} query - Query de busca
 * @returns {Promise<{videoId: string, title: string, channel: string, thumbnail: string, channelId: string}|null>}
 */
async function searchYouTube(query) {
  if (!YOUTUBE_API_KEY) {
    // Fallback rápido: Piped
    return await searchPiped(query);
  }

  try {
    const response = await axios.get(`${API_BASE}/search`, {
      params: {
        part: 'snippet',
        q: query,
        type: 'video',
        maxResults: 1,
        key: YOUTUBE_API_KEY,
        videoCategoryId: '10'
      },
      timeout: 5000
    });

    if (!response.data.items || response.data.items.length === 0) {
      return null;
    }

    const item = response.data.items[0];
    return {
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.default?.url,
      channelId: item.snippet.channelId
    };
  } catch (error) {
    console.error('[YOUTUBE API] Erro na busca:', error.message);
    // Fallback rápido: Piped
    try { return await searchPiped(query); } catch {}
    return null;
  }
}

/**
 * Obtém metadados completos de um vídeo (duração, views, thumbnail HD)
 * @param {string} videoId - ID do vídeo
 * @returns {Promise<{videoId: string, title: string, channel: string, duration: string, thumbnail: string, views: number}|null>}
 */
async function getVideoDetails(videoId) {
  if (!YOUTUBE_API_KEY) {
    return await getVideoDetailsPiped(videoId);
  }

  try {
    const response = await axios.get(`${API_BASE}/videos`, {
      params: {
        part: 'snippet,contentDetails,statistics',
        id: videoId,
        key: YOUTUBE_API_KEY
      },
      timeout: 5000
    });

    if (!response.data.items || response.data.items.length === 0) {
      return null;
    }

    const video = response.data.items[0];
    return {
      videoId: video.id,
      title: video.snippet.title,
      channel: video.snippet.channelTitle,
      channelId: video.snippet.channelId,
      duration: parseDuration(video.contentDetails.duration),
      thumbnail: video.snippet.thumbnails.maxres?.url || video.snippet.thumbnails.high?.url,
      views: parseInt(video.statistics.viewCount || 0),
      description: video.snippet.description
    };
  } catch (error) {
    console.error('[YOUTUBE API] Erro ao obter detalhes:', error.message);
    // Fallback: Piped
    try { return await getVideoDetailsPiped(videoId); } catch {}
    return null;
  }
}

async function getVideoDetailsPiped(videoId) {
  try {
    const res = await axios.get(`${PIPED_BASE}/videos/${videoId}`, { timeout: 5000 });
    const v = res.data || {};
    // Piped retorna duration (segundos) e durationString
    return {
      videoId,
      title: v.title || '',
      channel: v.uploader || v.uploaderName || '',
      channelId: v.uploaderId || '',
      duration: v.durationString || (typeof v.duration === 'number' ? `${Math.floor(v.duration/60)}:${String(v.duration%60).padStart(2,'0')}` : undefined),
      thumbnail: v.thumbnail || '',
      views: v.views || 0,
      description: v.description || ''
    };
  } catch (err) {
    console.error('[PIPED] Erro getVideoDetails:', err.message);
    return null;
  }
}

/**
 * Lista todos os vídeos de uma playlist (muito mais rápido que yt-dlp)
 * @param {string} playlistId - ID da playlist
 * @param {number} maxResults - Máximo de resultados (padrão 100)
 * @returns {Promise<{title: string, videos: Array}|null>}
 */
async function getPlaylistItems(playlistId, maxResults = 100) {
  if (!YOUTUBE_API_KEY) {
    return await getPlaylistItemsPiped(playlistId, maxResults);
  }

  try {
    let videos = [];
    let nextPageToken = null;

    // Obter informações da playlist
    const playlistInfo = await axios.get(`${API_BASE}/playlists`, {
      params: {
        part: 'snippet',
        id: playlistId,
        key: YOUTUBE_API_KEY
      },
      timeout: 5000
    });

    const playlistTitle = playlistInfo.data.items?.[0]?.snippet?.title || 'Playlist';

    // Buscar vídeos (paginado, 50 por vez)
    do {
      const response = await axios.get(`${API_BASE}/playlistItems`, {
        params: {
          part: 'snippet',
          playlistId: playlistId,
          maxResults: Math.min(50, maxResults - videos.length),
          pageToken: nextPageToken,
          key: YOUTUBE_API_KEY
        },
        timeout: 5000
      });

      const items = response.data.items || [];
      
      for (const item of items) {
        if (videos.length >= maxResults) break;
        
        // Filtrar vídeos deletados/privados
        if (item.snippet.title === 'Private video' || item.snippet.title === 'Deleted video') {
          continue;
        }

        videos.push({
          videoId: item.snippet.resourceId.videoId,
          title: item.snippet.title,
          channel: item.snippet.channelTitle,
          thumbnail: item.snippet.thumbnails.default?.url
        });
      }

      nextPageToken = response.data.nextPageToken;
    } while (nextPageToken && videos.length < maxResults);

    return {
      title: playlistTitle,
      videos: videos
    };
  } catch (error) {
    console.error('[YOUTUBE API] Erro ao buscar playlist:', error.message);
    // Fallback: Piped
    try { return await getPlaylistItemsPiped(playlistId, maxResults); } catch {}
    return null;
  }
}

async function getPlaylistItemsPiped(playlistId, maxResults = 100) {
  try {
    const res = await axios.get(`${PIPED_BASE}/playlists/${playlistId}`, { timeout: 5000 });
    const data = res.data || {};
    const vids = Array.isArray(data.videos) ? data.videos.slice(0, maxResults) : [];
    const videos = vids.map(v => ({
      videoId: v.id,
      title: v.title,
      channel: v.uploader || v.uploaderName || '',
      thumbnail: v.thumbnail || ''
    }));
    return { title: data.name || data.title || 'Playlist', videos };
  } catch (err) {
    console.error('[PIPED] Erro playlist:', err.message);
    return null;
  }
}

/**
 * Busca vídeos relacionados (para Auto)
 * @param {string} videoId - ID do vídeo de referência
 * @param {number} maxResults - Máximo de resultados (padrão 5)
 * @returns {Promise<Array|null>}
 */
// Nota: removido endpoint `getRelatedVideos` devido a problemas de parâmetros.

/**
 * Converte duração ISO 8601 para segundos e formato legível
 * @param {string} isoDuration - Ex: PT4M13S
 * @returns {string} - Ex: "4:13"
 */
function parseDuration(isoDuration) {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '0:00';

  const hours = parseInt(match[1] || 0);
  const minutes = parseInt(match[2] || 0);
  const seconds = parseInt(match[3] || 0);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

module.exports = {
  searchYouTube,
  getVideoDetails,
  getPlaylistItems
};

// Busca múltiplos resultados no YouTube (útil para recomendações de fallback)
async function searchYouTubeMultiple(query, maxResults = 5) {
  if (!YOUTUBE_API_KEY) {
    // Piped fallback
    try {
      const res = await axios.get(`${PIPED_BASE}/search`, { params: { q: query }, timeout: 5000 });
      const items = Array.isArray(res.data) ? res.data : [];
      const videos = items.filter(i => (i.type === 'video' || i.type === 'stream')).slice(0, maxResults);
      if (videos.length === 0) return null;
      return videos.map(v => ({
        videoId: v.id,
        title: v.title,
        channel: v.uploaderName || v.uploader || '',
        thumbnail: v.thumbnail || ''
      }));
    } catch (err) {
      console.error('[PIPED] Erro search multiple:', err.message);
      return null;
    }
  }

  try {
    const response = await axios.get(`${API_BASE}/search`, {
      params: {
        part: 'snippet',
        q: query,
        type: 'video',
        maxResults: maxResults,
        key: YOUTUBE_API_KEY
      },
      timeout: 5000
    });

    if (!response.data.items || response.data.items.length === 0) return null;

    return response.data.items.map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.default?.url
    }));
  } catch (error) {
    try {
      if (error.response) {
        console.error('[YOUTUBE API] Erro searchYouTubeMultiple:', error.response.status, error.response.data && (typeof error.response.data === 'object' ? JSON.stringify(error.response.data) : error.response.data));
      } else {
        console.error('[YOUTUBE API] Erro searchYouTubeMultiple:', error.message);
      }
    } catch (e) {
      console.error('[YOUTUBE API] Erro ao tratar erro em searchYouTubeMultiple:', e.message);
    }
    // Fallback Piped
    try {
      const res = await axios.get(`${PIPED_BASE}/search`, { params: { q: query }, timeout: 5000 });
      const items = Array.isArray(res.data) ? res.data : [];
      const videos = items.filter(i => (i.type === 'video' || i.type === 'stream')).slice(0, maxResults);
      if (videos.length === 0) return null;
      return videos.map(v => ({
        videoId: v.id,
        title: v.title,
        channel: v.uploaderName || v.uploader || '',
        thumbnail: v.thumbnail || ''
      }));
    } catch (err) {
      console.error('[PIPED] Erro search multiple fallback:', err.message);
      return null;
    }
  }
}

// export adicional
module.exports.searchYouTubeMultiple = searchYouTubeMultiple;
