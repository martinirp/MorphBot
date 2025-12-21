const db = require('./db');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { searchYouTube, getVideoDetails } = require('./youtubeApi');

// =========================
// NORMALIZAÇÃO
// =========================
function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// PATCH 1️⃣ - Adicionar função tokenize
function tokenize(text) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length >= 3);
}

// =========================
// VARIANTS
// =========================
function buildVariants(query) {
  const normalized = normalize(query);
  const words = normalized.split(' ');
  const variants = new Set();

  // Sempre adicionar query normalizada completa
  variants.add(normalized);

  // Se tiver 2+ palavras, adicionar inversão simples (artista-música)
  if (words.length >= 2) {
    const half = Math.floor(words.length / 2);
    const part1 = words.slice(0, half).join(' ');
    const part2 = words.slice(half).join(' ');
    variants.add(`${part2} ${part1}`);
  }

  return [...variants];
}

// =========================
// RESOLVE
// =========================
async function resolve(query) {
  console.log(`[RESOLVER] query recebida: "${query}"`);

  // PATCH 2️⃣ - Tokenizar a query
  const queryTokens = tokenize(query);
  
  const variants = buildVariants(query);

  console.log('[RESOLVER] variants da query:', variants);

  // =========================
  // 🔎 BUSCA NO BANCO
  // =========================
  // PATCH 3️⃣ - Loop de busca com validação forte
  for (const key of variants) {
    const hit = db.findByKey(key);
    if (!hit) continue;

    const song = db.getByVideoId(hit.videoId);
    if (!song) continue;

    // 🔒 REGRA FORTE: verificar se todos os tokens da query existem nas chaves da música
    const songKeys = db.getKeysByVideoId(hit.videoId);
    const songKeyText = songKeys.join(' ');

    const valid = queryTokens.every(t => songKeyText.includes(t));
    if (!valid) continue;

    console.log(`[RESOLVER] cache HIT (validado) → ${hit.videoId}`);

    // 🔒 aprendizado CONTROLADO (sem poluir)
    for (const v of variants) {
      db.insertKey(v, hit.videoId);
    }

    db.insertKey(hit.videoId, hit.videoId);

    return {
      fromCache: true,
      videoId: hit.videoId,
      title: song.title
    };
  }

  // =========================
  // ❌ CACHE MISS → YouTube API (rápido) ou yt-dlp (fallback)
  // =========================
  console.log('[RESOLVER] cache MISS → tentando YouTube API');

  let videoId, title, metadata = null;

  // Tentar YouTube API primeiro (muito mais rápido + metadados ricos)
  const apiResult = await searchYouTube(query);
  
  if (apiResult) {
    videoId = apiResult.videoId;
    title = apiResult.title;
    metadata = {
      channel: apiResult.channel,
      thumbnail: apiResult.thumbnail,
      channelId: apiResult.channelId
    };
    
    // Buscar detalhes completos (duração, views)
    const details = await getVideoDetails(videoId);
    if (details) {
      metadata = { ...metadata, ...details };
    }
    
    console.log(`[RESOLVER] YouTube API resolveu → ${videoId}`);
  } else {
    // Fallback: yt-dlp com flags de otimização
    console.log('[RESOLVER] YouTube API indisponível → fallback yt-dlp');
    const { stdout } = await execPromise(
      `yt-dlp "ytsearch1:${query}" --skip-download --no-playlist --no-warnings --extractor-retries 1 --socket-timeout 5 --print "%(id)s|||%(title)s"`
    );

    if (!stdout) {
      throw new Error('yt-dlp não retornou resultado');
    }
  db.insertKey(videoId, videoId);

  return {
    fromCache: false,
    videoId,
    title,
    metadata
  };
} // =========================
  for (const v of variants) {
    db.insertKey(v, videoId);
  }

  db.insertKey(videoId, videoId);

  return {
    fromCache: false,
    videoId,
    title
  };
}

module.exports = { resolve };
