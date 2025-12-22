const axios = require('axios');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const API_BASE = 'https://www.googleapis.com/youtube/v3';

async function searchMultiple(query, maxResults = 3) {
  if (!YOUTUBE_API_KEY) return null;

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

    if (!response.data.items) return null;

    return response.data.items.map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.default?.url
    }));
  } catch (err) {
    console.error('[DIBUIADOR] erro na busca:', err.message);
    return null;
  }
}

module.exports = { searchMultiple };
