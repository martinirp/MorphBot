require('dotenv').config();
const queueManager = require('../utils/queueManager');
const dibuiador = require('../utils/dibuiador');
const downloadManager = require('../utils/download');
const { getSpotifyPlaylist } = require('../utils/getSpotifyPL');
const https = require('https');
const { joinVoiceChannel } = require('@discordjs/voice');

const DEBUG = process.env.DEBUG_MODE === 'true';

function log(...args) {
    if (DEBUG) console.log('[MIX]', ...args);
}

module.exports = {
    name: 'mix',
    aliases: ['m', 'playlist', 'radio'],
    inVoiceChannel: true,

    execute: async (message, client, args) => {
        if (!args[0]) return message.channel.send(`❌ | Digite uma música!`);

        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.channel.send(`❌ | Entre em um canal de voz!`);

        let connection = queueManager.connections.get(message.guild.id);
        if (!connection) {
            try {
                await message.channel.send('🎧 | Conectando ao canal de voz...');
                connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                    selfDeaf: false
                });
                queueManager.connections.set(message.guild.id, connection);
            } catch (err) {
                console.error('❌ Falha ao conectar:', err);
                return message.channel.send('❌ | Não consegui entrar no canal de voz.');
            }
        }

        const guildId = message.guild.id;
        const query = args.join(' ');

        try {
            log(`Tocando principal: "${query}"`);
            const musicaPrincipal = await dibuiador.buscarMusica(query);

            if (!musicaPrincipal) {
                return message.channel.send(`❌ | Música não encontrada!`);
            }

            const downloadResult = await downloadManager.downloadSong(
                musicaPrincipal.url,
                musicaPrincipal.videoId, 
                musicaPrincipal.title
            );

            if (!downloadResult.success) {
                return message.channel.send('❌ | Erro ao baixar a música principal: ' + downloadResult.error);
            }

            const position = await queueManager.addToQueue(guildId, {
                url: musicaPrincipal.url,
                title: musicaPrincipal.title,
                videoId: musicaPrincipal.videoId,
                requestedBy: message.author.tag,
                channel: message.channel,
                fromCache: downloadResult.fromCache,
                file: downloadResult.file
            }, voiceChannel);

            message.channel.send(`🎵 | **${musicaPrincipal.title}** adicionada ao mix!`);

            let recomendadas = [];
            let fonte = '';
            let duracao = 0;

            try {
                log(`🎵 Tentando Spotify...`);
                const inicioSpotify = Date.now();
                recomendadas = await getSpotifyPlaylist(query);
                duracao = ((Date.now() - inicioSpotify) / 1000).toFixed(1);
                fonte = 'Spotify';
                log(`✅ Spotify retornou ${recomendadas.length} músicas em ${duracao}s`);
            } catch (spotifyError) {
                log(`❌ Spotify falhou: ${spotifyError.message}`);
                log(`🤖 Tentando Gemini...`);
                try {
                    const inicioGemini = Date.now();
                    recomendadas = await getMixFromGemini(query);
                    duracao = ((Date.now() - inicioGemini) / 1000).toFixed(1);
                    fonte = 'Gemini AI';
                    log(`✅ Gemini retornou ${recomendadas.length} músicas em ${duracao}s`);
                } catch (geminiError) {
                    log(`❌ Gemini também falhou: ${geminiError.message}`);
                    return message.channel.send(`❌ | Não foi possível gerar recomendações. Tente novamente.`);
                }
            }

            if (!recomendadas || recomendadas.length === 0) {
                return message.channel.send(`❌ | Nenhuma recomendação encontrada.`);
            }

            const lista = recomendadas.slice(0, 10).map((m, i) => `${i + 1}. ${m}`).join('\n');
            const embedDesc = recomendadas.length > 10 
                ? `**Base:** ${musicaPrincipal.title}\n\n**Primeiras 10 recomendações:**\n${lista}\n\n... e mais ${recomendadas.length - 10} músicas`
                : `**Base:** ${musicaPrincipal.title}\n\n**Recomendações:**\n${lista}`;

            await message.channel.send({
                embeds: [{
                    title: `🎧 Mix criado por ${fonte}`,
                    description: embedDesc,
                    color: fonte === 'Spotify' ? 0x1DB954 : 0x4285F4,
                    footer: { text: `${recomendadas.length} músicas • Gerado em ${duracao}s • Fonte: ${fonte}` },
                    timestamp: new Date()
                }]
            });

            let adicionadas = 0;
            let falhas = 0;
            
            for (const nomeMusica of recomendadas) {
                try {
                    const resultado = await dibuiador.buscarMusica(nomeMusica);
                    if (resultado) {
                        const downloadResult = await downloadManager.downloadSong(
                            resultado.url,
                            resultado.videoId,
                            resultado.title
                        );

                        if (downloadResult.success) {
                            await queueManager.addToQueue(guildId, {
                                url: resultado.url,
                                title: resultado.title,
                                videoId: resultado.videoId,
                                requestedBy: message.author.tag,
                                channel: message.channel,
                                fromCache: downloadResult.fromCache,
                                file: downloadResult.file
                            }, voiceChannel);
                            adicionadas++;
                            log(`✅ + ${nomeMusica}`);
                        } else {
                            log(`❌ Falha no download: ${nomeMusica}`);
                            falhas++;
                        }
                    } else {
                        log(`❌ Não encontrada: ${nomeMusica}`);
                        falhas++;
                    }
                } catch (err) {
                    log(`❌ Erro ao adicionar "${nomeMusica}": ${err.message}`);
                    falhas++;
                }
                await new Promise(res => setTimeout(res, 500));
            }

            let resultadoMsg = `✅ | **Mix completo!** ${adicionadas} músicas adicionadas (via ${fonte})`;
            if (falhas > 0) {
                resultadoMsg += `\n⚠️ | ${falhas} músicas não puderam ser adicionadas`;
            }
            
            message.channel.send(resultadoMsg);

        } catch (error) {
            console.error(`❌ [MIX] Erro geral:`, error);
            message.channel.send(`❌ | Ocorreu um erro ao gerar o mix.`);
        }
    },
};

async function getMixFromGemini(musicaBase) {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        console.log(`❌ GEMINI_API_KEY não encontrada no .env`);
        return null;
    }

    const modelo = 'gemini-2.0-flash-exp';
    const prompt = `Me recomende 9 músicas similares a "${musicaBase}" para criar uma playlist mix, de preferencia do mesmo artista.
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

    const callGemini = () => new Promise((resolve) => {
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    console.error(`❌ Erro Gemini (${res.statusCode}):`, body);
                    return resolve(null);
                }

                try {
                    const result = JSON.parse(body);
                    const content = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                    if (!content) return resolve(null);

                    const match = content.match(/\[[\s\S]*\]/);
                    if (match) {
                        try {
                            const arr = JSON.parse(match[0]);
                            return resolve(arr);
                        } catch {
                            console.log(`⚠️ Erro ao interpretar JSON Gemini.`);
                            return resolve(null);
                        }
                    } else {
                        console.log(`⚠️ Gemini não retornou array válido:`, content);
                        return resolve(null);
                    }
                } catch (e) {
                    console.error(`❌ Erro ao parsear resposta Gemini:`, e.message);
                    resolve(null);
                }
            });
        });

        req.on('error', err => {
            console.error(`❌ Erro HTTP Gemini:`, err.message);
            resolve(null);
        });

        req.write(data);
        req.end();
    });

    try {
        const resposta = await Promise.race([
            callGemini(),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout (15s)`)), 15000))
        ]);
        return resposta;
    } catch (e) {
        console.log(`⚠️ Timeout ou erro, tentando novamente:`, e.message);
        return await callGemini();
    }
}
