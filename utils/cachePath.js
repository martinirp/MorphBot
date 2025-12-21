const path = require('path');

module.exports = function cachePath(videoId) {
  return path.join(
    'music_cache_opus',
    videoId.slice(0, 2),
    videoId.slice(2, 4),
    videoId.slice(4, 6),
    'audio.opus'
  );
};
