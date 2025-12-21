const fs = require('fs');
const path = require('path');
const db = require('./db');

function removeSongCompletely(videoId) {
  const song = db.getByVideoId(videoId);
  if (!song || !song.file) return false;

  // caminho ABSOLUTO (obrigatório)
  const absoluteFile = path.resolve(song.file);
  const dir = path.dirname(absoluteFile);

  if (fs.existsSync(dir)) {
    fs.rmSync(dir, {
      recursive: true,
      force: true
    });
    console.log(`[CACHE] diretório removido: ${dir}`);
  }

  db.deleteSong(videoId);
  return true;
}

module.exports = { removeSongCompletely };

