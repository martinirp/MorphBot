const db = require('../utils/db');

/**
 * === MESMAS FUNÇÕES DO cacheWriter ===
 * (copiadas de propósito, para garantir padrão idêntico)
 */

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\bofficial\b/g, '')
    .replace(/\bmusic\b/g, '')
    .replace(/\bvideo\b/g, '')
    .replace(/\bremastered\b/g, '')
    .replace(/\blyrics?\b/g, '')
    .replace(/\blive\b/g, '')
    .replace(/\bhd\b/g, '')
    .replace(/–|—/g, '-')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function generateKeysFromTitle(title) {
  const clean = normalizeTitle(title);
  const parts = clean.split(' - ');
  const keys = new Set();

  if (parts.length >= 2) {
    const artist = parts[0].trim();
    const track = parts.slice(1).join(' - ').trim();

    keys.add(`${artist} ${track}`);
    keys.add(`${track} ${artist}`);
    keys.add(artist);
    keys.add(track);
  } else {
    keys.add(clean);
  }

  return keys;
}

/**
 * === SCRIPT ===
 */

function rebuild() {
  const songs = db.getAllSongs();

  console.log(`🔧 Recriando search_keys para ${songs.length} músicas...\n`);

  // 1️⃣ LIMPA TODAS AS KEYS ANTIGAS
  db.clearSearchKeys();

  let totalKeys = 0;

  // 2️⃣ RECRIA KEYS UMA A UMA
  for (const song of songs) {
    const keys = generateKeysFromTitle(song.title);

    // sempre manter o videoId como key direta
    keys.add(song.videoId);

    for (const key of keys) {
      db.insertKey(key, song.videoId);
      totalKeys++;
    }

    console.log(`✔ ${song.title}`);
  }

  console.log(`\n✅ Concluído.`);
  console.log(`🎯 ${totalKeys} keys criadas.`);
}

rebuild();
