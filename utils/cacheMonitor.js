const fs = require('fs');
const path = require('path');

const db = require('./db');
const cachePath = require('./cachePath');
const { isValidOggOpus } = require('./validator');
const { removeSongCompletely } = require('./removeSong');
const queueManager = require('./queueManager');

function anyGuildPlayingVideo(videoId) {
  for (const [guildId, g] of queueManager.guilds) {
    if (g?.current?.videoId === videoId) return true;
  }
  return false;
}

function startCacheMonitor() {
  const enabled = (process.env.CACHE_VALIDATE_ENABLED || 'true').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[CACHE MONITOR] desativado por env CACHE_VALIDATE_ENABLED=false');
    return;
  }

  const fix = (process.env.CACHE_VALIDATE_FIX || 'false').toLowerCase() === 'true';
  const intervalMin = parseInt(process.env.CACHE_VALIDATE_INTERVAL_MINUTES || '60', 10);
  const batchSize = parseInt(process.env.CACHE_VALIDATE_BATCH_SIZE || '25', 10);

  let idx = 0;
  let running = false;

  const tick = () => {
    if (running) return; // evitar concorrência
    running = true;

    try {
      const songs = db.getAllSongs();
      if (songs.length === 0) {
        running = false;
        return;
      }

      // Reiniciar índice se atingir fim
      if (idx >= songs.length) idx = 0;

      const end = Math.min(idx + batchSize, songs.length);
      const batch = songs.slice(idx, end);

      let checked = 0;
      let broken = 0;
      let removed = 0;

      for (const s of batch) {
        const fileRel = s.file || cachePath(s.videoId);
        const abs = path.resolve(path.join(__dirname, '..', fileRel));

        // pular se estiver tocando agora em alguma guild
        if (anyGuildPlayingVideo(s.videoId)) continue;

        if (!fs.existsSync(abs)) {
          broken++;
          if (fix) {
            try { removeSongCompletely(s.videoId); removed++; } catch {}
          }
          continue;
        }

        const valid = isValidOggOpus(abs);
        if (!valid) {
          broken++;
          if (fix) {
            try { removeSongCompletely(s.videoId); removed++; } catch {}
          }
        }
        checked++;
      }

      console.log(`[CACHE MONITOR] verificados=${checked} quebrados=${broken} removidos=${removed} (idx ${idx}-${end}/${songs.length})`);

      idx = end; // avançar cursor
    } catch (e) {
      console.error('[CACHE MONITOR] erro no tick:', e.message);
    } finally {
      running = false;
    }
  };

  // primeira execução após 30s para evitar competir com boot
  setTimeout(tick, 30_000);
  setInterval(tick, Math.max(1, intervalMin) * 60_000);
  console.log(`[CACHE MONITOR] iniciado: interval=${intervalMin}m batch=${batchSize} fix=${fix}`);
}

module.exports = { startCacheMonitor };
