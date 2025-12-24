const axios = require('axios');
const { runYtDlp } = require('./ytDlp');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const API_BASE = 'https://www.googleapis.com/youtube/v3';
const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
// Simple circuit breaker to avoid spamming 403 errors
let apiForbiddenUntil = 0; // epoch ms until which API calls are skipped
let apiWarnedDuringBlock = false;
// Piped disabled due to instability; prefer Last.FM-assisted yt-dlp fallback

async function searchViaLastFM(query) {
  if (!LASTFM_API_KEY) return null;
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=track.search&track=${encodeURIComponent(query)}&limit=1&api_key=${LASTFM_API_KEY}&format=json`;
    const res = await axios.get(url, { timeout: 5000 });
    const t = res.data?.results?.trackmatches?.track?.[0];
    if (!t || !t.name || !t.artist) return null;
    return `${t.artist} - ${t.name}`;
  } catch (e) {
    console.error('[LASTFM] Erro search:', e.message);
    return null;
  }
}

async function ytSearchBasic(query, count = 1) {
  try {
    const args = [
      `ytsearch${count}:${query}`,
      '--skip-download',
      '--no-playlist',
      '--no-warnings',
      '--extractor-retries','1',
      '--socket-timeout','5',
      '--print','%(id)s|||%(title)s|||%(uploader)s|||%(thumbnail)s'
    ];
    const { stdout } = await runYtDlp(args);
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    const results = lines.map(l => {
      const [id, title, uploader, thumb] = l.split('|||');
      return { videoId: id, title, channel: uploader || '', thumbnail: thumb || '', channelId: '' };
    });
    return results.length ? results : null;
  } catch (err) {
    console.error('[YT-DLP] Erro search:', err.message);
    return null;
  }
}

/**
 * Busca no YouTube usando a API oficial (muito mais rápido que yt-dlp)
 * @param {string} query - Query de busca
 * @returns {Promise<{videoId: string, title: string, channel: string, thumbnail: string, channelId: string}|null>}
 */
async function searchYouTube(query) {
  // Sempre usa yt-dlp para busca (gratuito, sem quota)
  const lf = await searchViaLastFM(query);
  const res = await ytSearchBasic(lf || query, 1);
  return res ? res[0] : null;
}

/**
 * Obtém metadados completos de um vídeo (duração, views, thumbnail HD)
 * @param {string} videoId - ID do vídeo
 * @returns {Promise<{videoId: string, title: string, channel: string, duration: string, thumbnail: string, views: number}|null>}
 */
async function getVideoDetails(videoId) {
  // Prioriza YouTube API para detalhes (1 unidade, rápido)
  if (YOUTUBE_API_KEY && Date.now() >= apiForbiddenUntil) {
    try {
      const response = await axios.get(`${API_BASE}/videos`, {
        params: {
          part: 'snippet,contentDetails,statistics',
          id: videoId,
          key: YOUTUBE_API_KEY
        },
        timeout: 5000
      });

      if (response.data.items && response.data.items.length > 0) {
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
      }
    } catch (error) {
      const status = error?.response?.status;
      if (status === 403) {
        // Block further API calls for a cooldown window to reduce noisy logs
        apiForbiddenUntil = Date.now() + 15 * 60 * 1000; // 15 minutes
        apiWarnedDuringBlock = false; // reset so we warn once below
        console.warn('[YOUTUBE API] 403 ao obter detalhes → desativando API por 15 min; usando yt-dlp como fallback');
      } else {
        console.error('[YOUTUBE API] Erro ao obter detalhes:', error.message);
      }
    }
  }
  // If API is currently blocked, warn once (not on every call)
  if (YOUTUBE_API_KEY && Date.now() < apiForbiddenUntil && !apiWarnedDuringBlock) {
    console.warn('[YOUTUBE API] desativada temporariamente devido a 403; usando yt-dlp');
    apiWarnedDuringBlock = true;
  }
  // Fallback: yt-dlp metadata
  return await getVideoDetailsYtDlp(videoId);
}

async function getVideoDetailsYtDlp(videoId) {
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const args = [
      url,
      '--skip-download',
      '--no-playlist',
      '--no-warnings',
      '--print','%(title)s|||%(uploader)s|||%(duration_string)s|||%(thumbnail)s'
    ];
    const { stdout } = await runYtDlp(args);
    const [title, uploader, duration, thumb] = (stdout.trim().split('|||')).map(s => s || '');
    return {
      videoId,
      title,
      channel: uploader,
      duration,
      thumbnail: thumb,
      views: 0,
      description: ''
    };
  } catch (err) {
    console.error('[YT-DLP] Erro detalhes:', err.message);
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
  if (!YOUTUBE_API_KEY || Date.now() < apiForbiddenUntil) {
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
    const status = error?.response?.status;
    if (status === 403) {
      apiForbiddenUntil = Date.now() + 15 * 60 * 1000;
      apiWarnedDuringBlock = false;
      console.warn('[YOUTUBE API] 403 ao buscar playlist → desativando API por 15 min; fallback Piped');
    } else {
      console.error('[YOUTUBE API] Erro ao buscar playlist:', error.message);
    }
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
  if (!YOUTUBE_API_KEY || Date.now() < apiForbiddenUntil) {
    const lf = await searchViaLastFM(query);
    const res = await ytSearchBasic(lf || query, Math.max(1, maxResults));
    return res;
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
      const status = error?.response?.status;
      if (status === 403) {
        apiForbiddenUntil = Date.now() + 15 * 60 * 1000;
        apiWarnedDuringBlock = false;
        console.warn('[YOUTUBE API] 403 em search → desativando API por 15 min; usando yt-dlp');
      } else if (error.response) {
        console.error('[YOUTUBE API] Erro searchYouTubeMultiple:', error.response.status, error.response.data && (typeof error.response.data === 'object' ? JSON.stringify(error.response.data) : error.response.data));
      } else {
        console.error('[YOUTUBE API] Erro searchYouTubeMultiple:', error.message);
      }
    } catch (e) {
      console.error('[YOUTUBE API] Erro ao tratar erro em searchYouTubeMultiple:', e.message);
    }
    const lf = await searchViaLastFM(query);
    const res = await ytSearchBasic(lf || query, Math.max(1, maxResults));
    return res;
  }
}

// export adicional
module.exports.searchYouTubeMultiple = searchYouTubeMultiple;
