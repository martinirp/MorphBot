const { exec } = require('child_process');

const videos = [
  'https://www.youtube.com/watch?v=VjLZ7aHj4sQ',
  'https://www.youtube.com/watch?v=4dOsbsuhYGQ',
  'https://www.youtube.com/watch?v=fJ9rUzIMcZQ',
  'https://www.youtube.com/watch?v=l482T0yNkeo',
  'https://www.youtube.com/watch?v=hTWKbfoikeg'
];

function inspect(url) {
  return new Promise((resolve, reject) => {
    exec(
      `yt-dlp -j --no-playlist "${url}"`,
      { maxBuffer: 1024 * 1024 * 10 },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(JSON.parse(stdout));
      }
    );
  });
}

(async () => {
  for (const url of videos) {
    console.log('\n========================================');
    console.log('URL:', url);

    try {
      const info = await inspect(url);

      console.log('title       :', info.title);
      console.log('fulltitle   :', info.fulltitle);
      console.log('uploader    :', info.uploader);
      console.log('channel     :', info.channel);
      console.log('artist      :', info.artist);
      console.log('track       :', info.track);
      console.log('album       :', info.album);
      console.log('duration    :', info.duration);
      console.log('categories  :', info.categories);
      console.log('tags        :', info.tags?.slice(0, 10));

    } catch (e) {
      console.error('Erro ao analisar vídeo:', e.message);
    }
  }
})();
