const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');

const { createEmbed } = require('../utils/embed');

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

    // 🔧 extrai link direto do conteúdo da mensagem
    const parts = message.content.trim().split(/\s+/);
    const input = parts[1];

    if (!input) {
      return textChannel.send({
        embeds: [
          createEmbed()
            .setDescription('❌ Você precisa enviar um link do YouTube.')
        ]
      });
    }

    const videoId = extractVideoId(input);

    if (!videoId) {
      return textChannel.send({
        embeds: [
          createEmbed()
            .setDescription('❌ Link inválido.')
        ]
      });
    }

    const filePath = tempPath(videoId);
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    console.log(`[DL] baixando mp3 → ${videoId}`);

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
        `yt-dlp -x --audio-format mp3 --no-playlist -o "${filePath}" https://www.youtube.com/watch?v=${videoId}`
      );

      let title = 'audio';
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
