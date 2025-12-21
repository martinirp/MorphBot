const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'music.db');
const db = new Database(dbPath);

// =========================
// 🔧 NORMALIZAÇÃO
// =========================
function normalizeKey(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// =========================
// INIT
// =========================
db.prepare(`
  CREATE TABLE IF NOT EXISTS songs (
    videoId TEXT PRIMARY KEY,
    title TEXT,
    artist TEXT,
    track TEXT,
    file TEXT,
    createdAt INTEGER
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS search_keys (
    key TEXT,
    videoId TEXT
  )
`).run();

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_search_keys_key
  ON search_keys(key)
`).run();

// =========================
// INSERTS
// =========================
function insertSong({ videoId, title, artist, track, file }) {
  db.prepare(`
    INSERT OR IGNORE INTO songs
    (videoId, title, artist, track, file, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(videoId, title || null, artist || null, track || null, file, Date.now());
}

function insertKey(key, videoId) {
  const normalized = normalizeKey(key);
  db.prepare(`
    INSERT INTO search_keys (key, videoId)
    VALUES (?, ?)
  `).run(normalized, videoId);
}

// =========================
// QUERIES
// =========================
function findByKey(key) {
  const normalized = normalizeKey(key);
  return db.prepare(`
    SELECT videoId FROM search_keys
    WHERE key = ?
    LIMIT 1
  `).get(normalized) || null;
}

function getByVideoId(videoId) {
  return db.prepare(`
    SELECT * FROM songs
    WHERE videoId = ?
    LIMIT 1
  `).get(videoId);
}

// AJUSTE: Versão simplificada de getAllSongs()
function getAllSongs() {
  return db.prepare('SELECT * FROM songs').all();
}

// ADIÇÃO: Função para obter todas as chaves de um videoId
function getKeysByVideoId(videoId) {
  return db
    .prepare('SELECT key FROM search_keys WHERE videoId = ?')
    .all(videoId)
    .map(r => r.key);
}

// =========================
// 🔍 BUSCA MANUAL (LIB)
// =========================
function searchSongs(query) {
  const q = `%${query.toLowerCase()}%`;
  return db.prepare(`
    SELECT *
    FROM songs
    WHERE LOWER(title) LIKE ?
    ORDER BY createdAt DESC
    LIMIT 10
  `).all(q);
}

// =========================
// ❌ EXCLUSÃO COMPLETA
// =========================
function deleteSong(videoId) {
  db.prepare(`DELETE FROM songs WHERE videoId = ?`).run(videoId);
  db.prepare(`DELETE FROM search_keys WHERE videoId = ?`).run(videoId);
}

// ADIÇÃO: Função para limpar search_keys
function clearSearchKeys() {
  db.prepare('DELETE FROM search_keys').run();
}

module.exports = {
  insertSong,
  insertKey,
  findByKey,
  getByVideoId,
  getAllSongs,
  getKeysByVideoId, // NOVA FUNÇÃO ADICIONADA
  searchSongs,
  deleteSong,
  clearSearchKeys
};

