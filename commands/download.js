const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');

const { createEmbed } = require('../utils/embed');
const { searchMultiple } = require('../utils/dibuiador');
const { getVideoDetails } = require('../utils/youtubeApi');

const execPromise = util.promisify(exec);

// =========================
// HELPERS
// =========================
function extractVideoId(input) {
  try {
    // youtu.be/ID
    if (input.includes('youtu.be')) {
      return input.split('youtu.be/')[1].split(/[?&]/)[0];
    }

    // watch?v=ID
    const url = new URL(input);
    return url.searchParams.get('v');
  } catch {
    return null;
  }
}

function tempPath(videoId) {
  return path.join(
    __dirname,
    '..',
    'temp_downloads',
    `${videoId}.mp3`
  );
}

// =========================
// COMMAND
// =========================
module.exports = {
  name: 'dl',
  aliases: ['download'],
  description: 'Baixa um vídeo do YouTube em formato MP3 e envia no chat',
  usage: '#download <link do YouTube>',

  async execute(message) {
    const textChannel = message.channel;

    // argumentos após o prefix
    const parts = message.content.trim().split(/\s+/);
    const input = parts.slice(1).join(' ');

    // Se não recebeu nada, pede query
    if (!input) {
      return textChannel.send({ embeds: [createEmbed().setDescription('❌ Forneça um link ou uma query de busca.') ] });
    }

    // Se parece link do YouTube extrai ID e baixa direto
    const videoIdFromUrl = extractVideoId(input);

    let chosenVideoId = null;
    let chosenTitle = null;

    if (videoIdFromUrl) {
      chosenVideoId = videoIdFromUrl;
    } else {
      // Fazer busca e listar 3 opções
      const searching = await textChannel.send({ embeds: [createEmbed().setDescription('🔎 Buscando no YouTube...')] });
      const results = await searchMultiple(input, 3);

      if (!results || results.length === 0) {
        return searching.edit({ embeds: [createEmbed().setDescription('❌ Nenhum resultado encontrado.')] });
      }

      // Buscar detalhes (duração) para cada resultado
      const detailed = [];
      for (const r of results) {
        const details = await getVideoDetails(r.videoId);
        detailed.push({ ...r, duration: details?.duration || '??:??' });
      }

      const listEmbed = createEmbed()
        .setTitle('Escolha um vídeo para baixar (responda 1, 2 ou 3)')
        .setDescription(detailed.map((d, i) => `**${i+1}.** ${d.title} — ${d.channel} (${d.duration})`).join('\n\n'));

      await searching.edit({ embeds: [listEmbed] });

      // Collector para resposta do autor
      const filter = m => m.author.id === message.author.id && /^[1-3]$/.test(m.content.trim());
      try {
        const collected = await textChannel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
        const reply = collected.first().content.trim();
        const idx = parseInt(reply, 10) - 1;
        const sel = detailed[idx];
        if (!sel) {
          return textChannel.send({ embeds: [createEmbed().setDescription('❌ Seleção inválida. Abortando.')] });
        }
        chosenVideoId = sel.videoId;
        chosenTitle = sel.title;
      } catch (e) {
        return textChannel.send({ embeds: [createEmbed().setDescription('⌛ Tempo esgotado. Execute o comando novamente.')] });
      }
    }

    const filePath = tempPath(chosenVideoId);
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    console.log(`[DL] baixando mp3 → ${chosenVideoId}`);

    const statusMsg = await textChannel.send({
      embeds: [
        createEmbed().setDescription('⬇️ Baixando áudio...')
      ]
    });

    try {
      // =========================
      // yt-dlp → MP3
      // =========================
      const { stdout } = await execPromise(
        `yt-dlp -x --audio-format mp3 --no-playlist -o "${filePath}" https://www.youtube.com/watch?v=${chosenVideoId}`
      );

      let title = chosenTitle || 'audio';
      const match = stdout.match(/Destination:\s(.+)\.mp3/);
      if (match) {
        title = path.basename(match[1]);
      }

      await statusMsg.edit({
        embeds: [
          createEmbed()
            .setTitle('🎵 Download pronto')
            .setDescription(`**${title}**`)
        ]
      });

      await textChannel.send({
        files: [
          {
            attachment: filePath,
            name: `${title}.mp3`
          }
        ]
      });

    } catch (err) {
      console.error('[DL] erro:', err);

      await statusMsg.edit({
        embeds: [
          createEmbed().setDescription('❌ Erro ao baixar o áudio.')
        ]
      });
    } finally {
      // 🧹 remove arquivo temporário
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log('[DL] arquivo temporário removido');
        }
      }, 5000);
    }
  }
};
