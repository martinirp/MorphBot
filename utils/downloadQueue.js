const fs = require('fs');
const cachePath = require('./cachePath');
const { createOpusStream, createOpusStreamFromUrl } = require('./stream');
const { writeCache } = require('./cacheWriter');

class DownloadQueue {
  constructor() {
    this.guilds = new Map();
    this.active = 0;
    this.MAX_CONCURRENCY = Number(process.env.DOWNLOAD_CONCURRENCY || 4);
  }

  get(guildId) {
    if (!this.guilds.has(guildId)) {
      this.guilds.set(guildId, {
        queue: [],
        downloading: false,
        currentController: null
      });
    }
    return this.guilds.get(guildId);
  }

  enqueue(guildId, song) {
    const g = this.get(guildId);

    const file = song.file || cachePath(song.videoId);
    if (fs.existsSync(file)) return;

    if (g.queue.find(s => s.videoId === song.videoId)) return;

    g.queue.push({ ...song, file });
    this._tryNext();
  }

  _startDownload(guildId, song, state) {
    state.downloading = true;
    this.active += 1;

    console.log(`[DOWNLOAD] ${guildId} → baixando: ${song.title}`);

    const stream = song.streamUrl 
      ? createOpusStreamFromUrl(song.streamUrl)
      : createOpusStream(song.videoId);

    const finalize = () => {
      state.downloading = false;
      this.active = Math.max(0, this.active - 1);
      this._tryNext();
    };

    stream.on('error', err => {
      console.error('[DOWNLOAD] erro no stream:', err);
      finalize();
    });

    writeCache(song.videoId, song.title, stream, finalize, song.streamUrl);
  }

  _tryNext() {
    while (this.active < this.MAX_CONCURRENCY) {
      const entry = [...this.guilds.entries()].find(([, st]) => !st.downloading && st.queue.length > 0);
      if (!entry) return;

      const [guildId, state] = entry;
      const nextSong = state.queue.shift();
      if (!nextSong) return;

      this._startDownload(guildId, nextSong, state);
    }
  }

  resetGuild(guildId) {
    const g = this.guilds.get(guildId);
    if (g?.currentController) {
      try { g.currentController.abort(); } catch {}
    }
    if (g?.downloading) {
      this.active = Math.max(0, this.active - 1);
    }
    this.guilds.delete(guildId);
    this._tryNext();
  }
}

module.exports = new DownloadQueue();
