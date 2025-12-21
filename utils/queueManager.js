const fs = require('fs');

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  entersState,
  VoiceConnectionStatus
} = require('@discordjs/voice');

const { createOpusStream, createOpusStreamFromUrl } = require('./stream');
const { createEmbed, createSongEmbed } = require('./embed');
const cachePath = require('./cachePath');
const downloadQueue = require('./downloadQueue');
const { getVideoDetails } = require('./youtubeApi');

class QueueManager {
  constructor() {
    this.guilds = new Map();
  }

  get(guildId) {
    if (!this.guilds.has(guildId)) {
      const player = createAudioPlayer({
        behaviors: {
          noSubscriber: 'play',
          maxMissedFrames: 1
        }
      });

      this.guilds.set(guildId, {
        player,
        queue: [],
        current: null,
        currentStream: null,
        playing: false,
        connection: null,
        textChannel: null,
        voiceChannel: null,
        emptyTimeout: null
      });
    }
    return this.guilds.get(guildId);
  }

  async play(guildId, voiceChannel, song, textChannel) {
    const g = this.get(guildId);

    if (textChannel) g.textChannel = textChannel;
    g.voiceChannel = voiceChannel;

    song.file = song.file || cachePath(song.videoId);

    console.log(`[QUEUE] ${guildId} → adicionando: ${song.title}`);
    g.queue.push(song);

    if (!fs.existsSync(song.file)) {
      downloadQueue.enqueue(guildId, song);
    }

    if (!g.connection) {
      g.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator
      });
      g.connection.subscribe(g.player);
    }

    if (!g.playing) {
      g.playing = true;
      this.next(guildId);
    }
  }

  async next(guildId) {
    const g = this.get(guildId);
    const song = g.queue.shift();

    if (!song) {
      g.current = null;
      g.playing = false;

      g.textChannel?.send({
        embeds: [createEmbed().setDescription('Fila encerrada.')]
      }).catch(() => {});

      return;
    }

    g.current = song;

    console.log(`[PLAYER] ${guildId} → tocando agora: ${song.title}`);

    let resource;

    if (fs.existsSync(song.file)) {
      // Cache hit: usa o arquivo direto para reduzir overhead
      resource = createAudioResource(song.file, { inputType: StreamType.OggOpus });
      g.currentStream = null;
    } else {
      // Usa streamUrl se presente (SoundCloud/Bandcamp/Direct), senão YouTube
      const stream = song.streamUrl 
        ? createOpusStreamFromUrl(song.streamUrl)
        : createOpusStream(song.videoId);

      stream.on('error', err => {
        if (err.code !== 'EPIPE') {
          console.error('[STREAM] erro:', err);
        }
        g.currentStream = null;
        this.next(guildId);
      });

      g.currentStream = stream;

      resource = createAudioResource(stream, {
        inputType: StreamType.OggOpus,
        inlineVolume: false
      });
    }

    // Garantir conexão pronta antes de tocar (reduz silêncio inicial)
    try {
      if (g.connection) {
        await entersState(g.connection, VoiceConnectionStatus.Ready, 3000);
      }
    } catch (e) {
      console.warn('[VOICE] conexão não ficou pronta em 3s; iniciando mesmo assim');
    }

    g.player.play(resource);

    // Evitar múltiplos listeners acumulados
    g.player.removeAllListeners(AudioPlayerStatus.Idle);

    g.player.once(AudioPlayerStatus.Idle, () => {
      g.currentStream = null;
      this.next(guildId);
    });

    // Fallback para race conditions (ex.: recurso não dispara Idle)
    setTimeout(() => {
      if (g.current === song && g.player?.state?.status === AudioPlayerStatus.Idle) {
        g.currentStream = null;
        this.next(guildId);
      }
    }, 5000);

    // Buscar metadados ricos se não tiver e enviar embed melhorado
    if (!song.metadata && song.videoId) {
      const details = await getVideoDetails(song.videoId);
      if (details) {
        song.metadata = details;
      }
    }

    const songData = song.metadata ? { ...song, ...song.metadata } : song;

    g.textChannel?.send({
      embeds: [createSongEmbed(songData, 'playing')]
    }).catch(() => {});

    // 🟢 Prefetch próxima música se existir na fila
    if (g.queue.length > 0) {
      const nextSong = g.queue[0];
      if (nextSong && !fs.existsSync(nextSong.file)) {
        console.log(`[PREFETCH] ${guildId} → pré-baixando próxima: ${nextSong.title}`);
        downloadQueue.enqueue(guildId, nextSong);
      }
    }
  }

  pause(guildId) {
    const g = this.guilds.get(guildId);
    if (!g?.player) return;

    if (g.player.state.status === AudioPlayerStatus.Playing) {
      g.player.pause(true);
    }
  }

  resume(guildId) {
    const g = this.guilds.get(guildId);
    if (!g?.player) return;

    if (g.player.state.status === AudioPlayerStatus.Paused) {
      g.player.unpause();
    }
  }

  skip(guildId) {
    const g = this.get(guildId);

    if (g.currentStream) {
      try { g.currentStream.destroy(); } catch {}
      g.currentStream = null;
    }

    try { g.player.stop(true); } catch {}
    g.current = null;
  }

  resetGuild(guildId) {
    const g = this.guilds.get(guildId);
    if (!g) return;

    if (g.currentStream) {
      try { g.currentStream.destroy(); } catch {}
    }

    downloadQueue.resetGuild(guildId);

    try { g.player.stop(true); } catch {}
    try { g.connection?.destroy(); } catch {}

    this.guilds.delete(guildId);
  }
}

module.exports = new QueueManager();
