const db = require('../utils/db');

function listKeys() {
  const songs = db.getAllSongs();

  for (const song of songs) {
    console.log('\n========================================');
    console.log(`🎵 ${song.title}`);
    console.log(`🆔 ${song.videoId}`);

    const keys = db.getKeysByVideoId(song.videoId);

    for (const key of keys) {
      console.log(`  - ${key}`);
    }
  }

  console.log('\n✅ Fim da listagem.');
}

listKeys();
