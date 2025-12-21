const axios = require('axios');

let spotifyToken = null;
let spotifyTokenExpiry = null;

async function getSpotifyToken() {
  const now = Date.now();
  if (spotifyToken && spotifyTokenExpiry && spotifyTokenExpiry > now) {
    return spotifyToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Spotify credentials not configured');
  }

  try {
    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    spotifyToken = response.data.access_token;
    spotifyTokenExpiry = now + (response.data.expires_in * 1000);

    return spotifyToken;
  } catch (err) {
    console.error('[SPOTIFY] erro ao autenticar:', err.message);
    throw new Error('Spotify authentication failed');
  }
}

async function resolveSpotifyTrack(spotifyUrl) {
  try {
    const token = await getSpotifyToken();

    // Extrair track ID da URL
    const trackIdMatch = spotifyUrl.match(/track\/([a-zA-Z0-9]+)/);
    if (!trackIdMatch) {
      throw new Error('Invalid Spotify URL');
    }

    const trackId = trackIdMatch[1];

    const response = await axios.get(
      `https://api.spotify.com/v1/tracks/${trackId}`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    const track = response.data;
    const artists = track.artists.map(a => a.name).join(', ');
    const title = track.name;

    return {
      artist: artists,
      title: title,
      query: `${artists} - ${title}`
    };
  } catch (err) {
    console.error('[SPOTIFY] erro ao resolver track:', err.message);
    return null;
  }
}

module.exports = {
  resolveSpotifyTrack,
  getSpotifyToken
};
