const queueManager = require('./queueManager');

async function interruptibleDelay(ms, guildId) {
  const step = 1000;
  let elapsed = 0;

  while (elapsed < ms) {
    // ⛔ guild foi resetada (kick, disconnect, crash)
    if (!queueManager.guilds?.has(guildId)) {
      return false;
    }

    await new Promise(r => setTimeout(r, step));
    elapsed += step;
  }

  return true;
}

async function processPlaylistSequentially({
  playlist,
  guildId,
  voiceChannel,
  textChannel
}) {
  let added = 0;

  for (const video of playlist.videos) {

    // =========================
    // 🔒 VERIFICA ESTADO IMEDIATA
    // =========================
    if (!queueManager.guilds?.has(guildId)) {
      console.log('[PLAYLIST] abortada: guild inexistente');
      break;
    }

    try {
      await queueManager.play(
        guildId,
        voiceChannel,
        {
          videoId: video.videoId,
          title: video.title
        },
        textChannel
      );

      added++;
    } catch (e) {
      console.error('[PLAYLIST] erro ao adicionar:', e);
      break;
    }

    // =========================
    // ⏱️ DELAY INTERRUPTÍVEL (40s)
    // =========================
    const ok = await interruptibleDelay(40_000, guildId);
    if (!ok) {
      console.log('[PLAYLIST] abortada durante delay');
      break;
    }
  }

  if (added > 0 && queueManager.guilds?.has(guildId)) {
    textChannel.send({
      embeds: [{
        title: '📜 Playlist processada',
        description: `Foram adicionadas **${added}** músicas à fila.`
      }]
    }).catch(() => {});
  }
}

async function processPlaylistBatched({
  playlist,
  guildId,
  voiceChannel,
  textChannel,
  limit = 100,
  batchSize = 10,
  delayMs = 2000
}) {
  if (!playlist || !Array.isArray(playlist.videos) || playlist.videos.length === 0) {
    return 0;
  }

  const videos = playlist.videos.slice(0, limit);
  let added = 0;

  for (let i = 0; i < videos.length; i += batchSize) {
    // ⛔ guild foi resetada (kick, disconnect, crash)
    if (!queueManager.guilds?.has(guildId)) {
      console.log('[PLAYLIST] abortada: guild inexistente');
      break;
    }

    const batch = videos.slice(i, i + batchSize);

    for (const video of batch) {
      try {
        await queueManager.play(
          guildId,
          voiceChannel,
          { videoId: video.videoId, title: video.title },
          textChannel
        );
        added++;
      } catch (e) {
        console.error('[PLAYLIST] erro ao adicionar:', e);
        // continua tentando os próximos itens em vez de abortar toda a playlist
      }
    }

    // Pequeno atraso entre lotes para evitar sobrecarga
    if (delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  if (added > 0 && queueManager.guilds?.has(guildId)) {
    textChannel.send({
      embeds: [{
        title: '📜 Playlist adicionada',
        description: `Foram adicionadas **${added}** músicas à fila.`
      }]
    }).catch(() => {});
  }

  return added;
}

module.exports = { processPlaylistSequentially, processPlaylistBatched };
