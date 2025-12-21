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

module.exports = { processPlaylistSequentially };
