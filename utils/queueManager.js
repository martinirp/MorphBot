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
const { resolve, tokenize } = require('./resolver');
const cachePath = require('./cachePath');
const downloadQueue = require('./downloadQueue');
const { getVideoDetails } = require('./youtubeApi');

class QueueManager {
  constructor() {
    this.guilds = new Map();
    this.selfDisconnecting = new Set(); // Rastreia desconexões iniciadas pelo bot
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
        ,
        loop: false,
        autoDJ: false,
        nowPlayingMessage: null
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
    // Se loop ativo, reaproveita a música atual em vez de puxar da fila
    let song;
    if (g.loop && g.current) {
      song = g.current;
    } else {
      song = g.queue.shift();
    }

    if (!song) {
      g.current = null;
      g.playing = false;

      g.textChannel?.send({
        embeds: [createEmbed().setDescription('Fila encerrada.')]
      }).catch(() => {});

      // Iniciar timer para desconectar se vazio
      this.startAutoDisconnect(guildId);
      return;
    }

    // Cancelar auto-disconnect se tinha
    if (g.emptyTimeout) {
      clearTimeout(g.emptyTimeout);
      g.emptyTimeout = null;
    }

    g.current = song;

    const { decodeHtml } = require('./embed');
    const cleanTitleLog = decodeHtml(song.title || '');
    console.log(`[PLAYER] ${guildId} → tocando agora: ${cleanTitleLog}`);

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

    try {
      const loopOn = !!g.loop;
      const autoOn = !!g.autoDJ;

      // Se estamos reaproveitando a mesma faixa por causa do loop e já temos uma mensagem "Now Playing",
      // não reenviamos o embed para evitar spam. Apenas atualizamos a mensagem existente.
      if (g.loop && g.current && g.nowPlayingMessage) {
        try {
          const existing = g.nowPlayingMessage;
          const newEmbed = createSongEmbed(songData, 'playing', loopOn, autoOn);
          await existing.edit({ embeds: [newEmbed] }).catch(() => {});
        } catch (err) {
          // se falhar ao editar, ignoramos silenciosamente
        }
      } else {
        const sent = await g.textChannel?.send({ embeds: [createSongEmbed(songData, 'playing', loopOn, autoOn)] });

        if (sent) {
          g.nowPlayingMessage = sent;
          try { await sent.react('🔁'); } catch {}
          try { await sent.react('🎶'); } catch {}
        }
      }

      // Se Auto estiver ativado, gerar recomendações e adicionar à fila
      if (g.autoDJ && song.videoId) {
        try {
          const { searchYouTubeMultiple } = require('./youtubeApi');
          let related = null;

          // Preferir recomendações via Spotify se a música atual tiver spotifyId
          try {
            const spotifyId = song.metadata?.spotifyId || (song.videoId && song.metadata && song.metadata.spotifyId);
            if (spotifyId) {
              const { getSpotifyRecommendations } = require('./spotifyResolver');
              const srec = await getSpotifyRecommendations(spotifyId, 5);
              if (srec && srec.length > 0) {
                // Map Spotify recs to same shape as YouTube related items
                related = srec.map(r => ({ videoId: null, title: `${r.artists} - ${r.title}`, channel: r.artists, thumbnail: null, spotifyTrackId: r.trackId }));
              }
            }
          } catch (spErr) {
            console.error('[AUTODJ] erro ao obter recommendations do Spotify:', spErr);
          }

          // Se não obteve de Spotify, usar fallback baseado em busca por título/canal
          if (!related || related.length === 0) {
            try {
              const titleForSearch = (song.title || '').replace(/\[.*?\]|\(.*?\)/g, '').trim();
              const channel = song.channel || (song.metadata && song.metadata.channel) || '';
              const queries = [];
              if (titleForSearch) queries.push(titleForSearch);
              if (channel && titleForSearch) queries.push(`${titleForSearch} ${channel}`);
              if (channel) queries.push(`music from ${channel}`);

              for (const q of queries) {
                const sres = await searchYouTubeMultiple(q, 5);
                if (sres && sres.length > 0) {
                  related = sres;
                  break;
                }
              }
            } catch (fe) {
              console.error('[AUTODJ] fallback de recomendações falhou:', fe);
            }
          }

          if (related && related.length > 0) {
            let added = 0;
            // tokens da música atual para deduplicação
            const currentTokens = new Set(tokenize(song.title || songData.title || ''));

            for (const item of related) {
              if (added >= 2) break;

              // Se item não tiver videoId (ex.: recomendação do Spotify), tentar resolver via resolver
              if (!item.videoId) {
                try {
                  const res = await resolve(item.title);
                  if (res && res.videoId) {
                    item.videoId = res.videoId;
                    item.title = res.title || item.title;
                  } else {
                    continue; // não conseguiu resolver
                  }
                } catch (e) {
                  continue;
                }
              }

              // evitar adicionar a mesma música ou já presente na fila
              if (item.videoId === song.videoId) continue;
              if (g.queue.some(s => s.videoId === item.videoId)) continue;

              // deduplicação por similaridade de tokens no título (evita covers/versões repetidas)
              const candidateTokens = tokenize(item.title || '');
              if (candidateTokens.length > 0 && currentTokens.size > 0) {
                const common = candidateTokens.filter(t => currentTokens.has(t));
                const similarity = common.length / Math.max(1, Math.min(candidateTokens.length, currentTokens.size));
                if (similarity >= 0.6) {
                  continue; // considerada mesma música
                }
              }

              const dbSong = require('./db').getByVideoId(item.videoId);
              const songObj = dbSong || {
                videoId: item.videoId,
                title: item.title,
                metadata: { channel: item.channel, thumbnail: item.thumbnail }
              };

              g.queue.push(songObj);
              const downloadQueue = require('./downloadQueue');
              if (!fs.existsSync(songObj.file || require('./cachePath')(songObj.videoId))) {
                downloadQueue.enqueue(guildId, songObj);
              }

              added++;
            }

            if (added > 0) {
              try {
                g.textChannel?.send({ embeds: [createEmbed().setDescription(`🎶 Auto: adicionadas ${added} recomendações à fila.`)] }).catch(() => {});
              } catch {}
            }
          }
        } catch (err) {
          console.error('[AUTODJ] erro ao buscar recomendações:', err);
        }
      }
    } catch (e) {
      // Falha em enviar embed não é crítico
      try { g.textChannel?.send({ embeds: [createSongEmbed(songData, 'playing', false, false)] }); } catch {}
    }

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
    }

    this.next(guildId);
  }

  resetGuild(guildId, options = {}) {
    const g = this.guilds.get(guildId);
    if (!g) return;

    if (g.emptyTimeout) {
      clearTimeout(g.emptyTimeout);
      g.emptyTimeout = null;
    }

    if (g.currentStream) {
      try { g.currentStream.destroy(); } catch {}
    }

    downloadQueue.resetGuild(guildId);

    try { g.player.stop(true); } catch {}
    try { g.connection?.destroy(); } catch {}

    this.guilds.delete(guildId);

    // Preservar flag se especificado (para auto-disconnect)
    if (!options.preserveSelfFlag) {
      this.selfDisconnecting.delete(guildId);
    }
  }

  startAutoDisconnect(guildId) {
    const g = this.get(guildId);
    if (!g) return;

    // Já tem timeout? ignora
    if (g.emptyTimeout) return;

    g.emptyTimeout = setTimeout(() => {
      const guild = this.get(guildId);
      if (!guild || guild.playing || guild.queue.length > 0) return;

      this.selfDisconnecting.add(guildId);
      this.resetGuild(guildId, { preserveSelfFlag: true });

      guild.textChannel?.send({
        embeds: [createEmbed().setDescription('⏱️ Desconectado por inatividade.')]
      }).catch(() => {});

      // Limpar flag após 5s
      setTimeout(() => this.selfDisconnecting.delete(guildId), 5000);
    }, 5 * 60 * 1000); // 5 minutos
  }

  checkIfAlone(guildId) {
    const g = this.get(guildId);
    if (!g?.voiceChannel) return;

    const members = g.voiceChannel.members.filter(m => !m.user.bot);

    if (members.size === 0) {
      this.selfDisconnecting.add(guildId);
      this.resetGuild(guildId, { preserveSelfFlag: true });

      g.textChannel?.send({
        embeds: [createEmbed().setDescription('👋 Desconectado (sozinho no canal).')]
      }).catch(() => {});

      setTimeout(() => this.selfDisconnecting.delete(guildId), 5000);
    }
  }

  // Adiciona recomendações imediatas quando Auto é ativado
  async addAutoRecommendations(guildId, count = 2) {
    const g = this.get(guildId);
    if (!g || !g.current) return 0;

    try {
      const axios = require('axios');
      const { searchYouTubeMultiple } = require('./youtubeApi');

      const currentTitle = g.current.title || '';
      const primaryTokens = new Set(tokenize(currentTitle));

      let recommendations = [];

      // Step 1: Try Spotify recommendations if trackId available
      const spotifyId = g.current.metadata?.spotifyId;
      if (spotifyId && process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
        try {
          const token = await this._getSpotifyToken();
          const recRes = await axios.get('https://api.spotify.com/v1/recommendations', {
            headers: { Authorization: `Bearer ${token}` },
            params: { seed_tracks: spotifyId, limit: count * 3 }
          });
          if (recRes.data.tracks) {
            recommendations = recRes.data.tracks.map(t => ({
              source: 'spotify',
              title: `${t.artists.map(a => a.name).join(', ')} - ${t.name}`,
              duration: Math.round(t.duration_ms / 1000)
            }));
          }
        } catch (spErr) {
          console.error('[AUTODJ] Spotify recommendations error:', spErr.message);
        }
      }

      // Step 2: Fallback to YouTube search - BUSCAR ESPECIFICAMENTE POR MÚSICA
      if (recommendations.length === 0) {
        try {
          // Extrair informações úteis do título atual
          const titleForSearch = currentTitle.replace(/\[.*?\]|\(.*?\)/g, '').trim();
          // Adicionar "music" ou "song" para focar em conteúdo musical
          const enhancedQueries = [
            `${titleForSearch} music`,
            `${titleForSearch} official`,
            titleForSearch
          ];

          for (const query of enhancedQueries) {
            const sres = await searchYouTubeMultiple(query, count * 3);
            if (sres && sres.length > 0) {
              // Filtrar a música atual e conteúdo claramente não-musical
              const nonMusicKeywords = ['cooking', 'recipe', 'vlog', 'tutorial', 'howto', 'asmr', 'challenge', 'prank', 'reaction', 'gameplay'];
              recommendations = sres
                .filter(r => r.videoId !== g.current.videoId)
                .filter(r => !nonMusicKeywords.some(kw => r.title.toLowerCase().includes(kw)))
                .map(r => ({
                  source: 'youtube',
                  title: r.title,
                  duration: r.duration,
                  videoId: r.videoId
                }));
              
              if (recommendations.length > 0) {
                console.log(`[AUTODJ] YouTube search retornou ${recommendations.length} resultados`);
                break;
              }
            }
          }
        } catch (ytErr) {
          console.error('[AUTODJ] YouTube search error:', ytErr.message);
        }
      }

      // Step 2B: Fallback to Gemini AI (terceira opção)
      if (recommendations.length === 0 && process.env.GEMINI_API_KEY) {
        try {
          console.log('[AUTODJ] Fallback para Gemini AI...');
          const geminiRecs = await this._getRecommendationsFromGemini(currentTitle, count * 3);
          if (geminiRecs && geminiRecs.length > 0) {
            recommendations = geminiRecs.map(r => ({
              source: 'gemini',
              title: r
            }));
            console.log(`[AUTODJ] Gemini retornou ${recommendations.length} recomendações`);
          }
        } catch (geminiErr) {
          console.error('[AUTODJ] Gemini error:', geminiErr.message);
        }
      }

      if (recommendations.length === 0) return 0;

      // Step 3: Apply filters and deduplication
      const stopwords = ['cover', 'live', 'stripped', 'acoustic', 'remix', 'karaoke', 'instrumental', 'solo'];
      const durationTolerance = 30; // seconds
      const primaryDuration = g.current.metadata?.duration || 0;
      const similarityThreshold = 0.5; // Mudei para lógica diferente abaixo
      const minTokenOverlap = 1; // Deve ter pelo menos 1 token em comum

      let added = 0;
      for (const rec of recommendations) {
        if (added >= count) break;

        const recTokens = tokenize(rec.title || '');

        // Check token overlap - DEVE TER TOKENS EM COMUM
        if (recTokens.length > 0 && primaryTokens.size > 0) {
          const overlap = recTokens.filter(t => primaryTokens.has(t));
          if (overlap.length < minTokenOverlap) {
            console.log(`[AUTODJ FILTER] REJEITADO: sem tokens em comum. Primary: [${Array.from(primaryTokens).join(', ')}] vs Rec: [${recTokens.join(', ')}]`);
            continue;
          }

          // Se TEM overlap, agora verifica similaridade Jaccard
          const sim = this._jaccardSimilarity(Array.from(primaryTokens), recTokens);
          // Se a similaridade é MUITO ALTA (>= 0.75), é provavelmente a mesma música
          if (sim >= 0.75) {
            console.log(`[AUTODJ FILTER] REJEITADO por similaridade muito alta: ${sim.toFixed(3)}`);
            continue;
          }
          console.log(`[AUTODJ FILTER] similaridade OK: ${sim.toFixed(3)} (primary: [${Array.from(primaryTokens).join(', ')}] vs rec: [${recTokens.join(', ')}])`);
        } else {
          console.log(`[AUTODJ FILTER] REJEITADO: sem tokens suficientes para comparação`);
          continue;
        }

        // Check for stopwords
        if (stopwords.some(w => rec.title.toLowerCase().includes(w))) {
          console.log(`[AUTODJ FILTER] REJEITADO por stopword (cover/live/stripped)`);
          continue;
        }

        // Check duration
        if (rec.duration && primaryDuration > 0) {
          const durDiff = Math.abs(primaryDuration - rec.duration);
          if (durDiff > durationTolerance) {
            console.log(`[AUTODJ FILTER] REJEITADO por duração (${rec.duration}s vs ${primaryDuration}s, diff=${durDiff}s, tolerance=${durationTolerance}s)`);
            continue;
          }
        }

        // Resolve to get videoId
        let videoId = null;
        if (rec.videoId) {
          // Já vem do YouTube fallback
          videoId = rec.videoId;
        } else {
          // Precisa resolver (ex: Spotify ou Gemini)
          try {
            console.log(`[AUTODJ] Resolvendo: "${rec.title}"`);
            const res = await resolve(rec.title);
            if (res && res.videoId) {
              videoId = res.videoId;
            } else {
              console.log(`[AUTODJ FILTER] REJEITADO: não conseguiu resolver para videoId`);
              continue;
            }
          } catch (e) {
            console.log(`[AUTODJ FILTER] REJEITADO: erro ao resolver`, e.message);
            continue;
          }
        }

        // Check if already in queue
        if (videoId === g.current.videoId) {
          console.log(`[AUTODJ FILTER] REJEITADO: é a música atual`);
          continue;
        }
        if (g.queue.some(s => s.videoId === videoId)) {
          console.log(`[AUTODJ FILTER] REJEITADO: já está na fila`);
          continue;
        }

        console.log(`[AUTODJ] ✅ ACEITO: "${rec.title}"`);

        // Add to queue
        const dbSong = require('./db').getByVideoId(videoId);
        const songObj = dbSong || {
          videoId: videoId,
          title: rec.title,
          metadata: { channel: rec.source }
        };

        g.queue.push(songObj);

        // Enqueue download
        const downloadQueue = require('./downloadQueue');
        const fs = require('fs');
        const filePath = songObj.file || require('./cachePath')(videoId);
        if (!fs.existsSync(filePath)) {
          downloadQueue.enqueue(guildId, songObj);
        }

        added++;
      }

      if (added > 0) {
        try {
          g.textChannel?.send({
            embeds: [
              require('./embed').createEmbed()
                .setDescription(`🎶 Auto: adicionadas ${added} recomendações à fila.`)
            ]
          }).catch(() => {});
        } catch {}
      }

      return added;
    } catch (err) {
      console.error('[AUTODJ] addAutoRecommendations erro:', err);
      return 0;
    }
  }

  // Helper: Get Spotify token
  async _getSpotifyToken() {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Spotify credentials not set');

    const axios = require('axios');
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await axios.post('https://accounts.spotify.com/api/token', 'grant_type=client_credentials', {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    return res.data.access_token;
  }

  // Helper: Jaccard similarity
  _jaccardSimilarity(a, b) {
    const A = new Set(a);
    const B = new Set(b);
    const inter = [...A].filter(x => B.has(x)).length;
    const uni = new Set([...A, ...B]).size;
    return uni === 0 ? 0 : inter / uni;
  }

  // Helper: Get recommendations from Gemini AI
  async _getRecommendationsFromGemini(musicTitle, limit = 5) {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) throw new Error('Gemini API key not set');

    const https = require('https');
    const modelo = 'gemini-2.0-flash-exp';
    const prompt = `Me recomende ${limit} músicas similares a "${musicTitle}".
Responda apenas com um array JavaScript no formato ["Artista - Música"], sem explicações, sem markdown.`;

    const data = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: `/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    };

    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              console.error(`[AUTODJ] Gemini error (${res.statusCode})`);
              return resolve([]);
            }

            const result = JSON.parse(body);
            const content = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (!content) return resolve([]);

            const match = content.match(/\[[\s\S]*\]/);
            if (match) {
              try {
                const arr = JSON.parse(match[0]);
                console.log(`[AUTODJ] Gemini retornou ${arr.length} recomendações`);
                return resolve(arr);
              } catch (e) {
                console.error('[AUTODJ] Erro ao parsear JSON Gemini:', e.message);
                return resolve([]);
              }
            }
            resolve([]);
          } catch (e) {
            console.error('[AUTODJ] Erro Gemini:', e.message);
            resolve([]);
          }
        });
      });

      req.on('error', err => {
        console.error('[AUTODJ] Erro HTTP Gemini:', err.message);
        resolve([]);
      });

      req.write(data);
      req.end();
    });
  }
}

module.exports = new QueueManager();
