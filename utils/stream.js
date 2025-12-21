const { spawn } = require('child_process');

function createOpusStream(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  return createOpusStreamFromUrl(url);
}

function createOpusStreamFromUrl(url) {
  const ytdlp = spawn('yt-dlp', ['-f', 'bestaudio', '-o', '-', url], {
    stdio: ['ignore', 'pipe', 'ignore']
  });
  const ffmpeg = spawn('ffmpeg', [
    '-loglevel', 'quiet',
    '-i', 'pipe:0',
    '-f', 'ogg',
    '-acodec', 'libopus',
    '-b:a', '96k',
    '-compression_level', '10',
    'pipe:1'
  ], {
    stdio: ['pipe', 'pipe', 'ignore']
  });

  ytdlp.stdout.pipe(ffmpeg.stdin);
  
  // Propagar erros do pipeline
  ytdlp.on('error', err => ffmpeg.stdout.emit('error', err));
  ffmpeg.on('error', err => ffmpeg.stdout.emit('error', err));
  
  // 🟢 Buffer estratégico: aguarda ~512KB antes de iniciar playback
  const { PassThrough } = require('stream');
  const bufferedStream = new PassThrough();
  let bufferSize = 0;
  const BUFFER_THRESHOLD = 512 * 1024; // 512KB
  let bufferReady = false;

  ffmpeg.stdout.on('data', chunk => {
    if (!bufferReady) {
      bufferSize += chunk.length;
      if (bufferSize >= BUFFER_THRESHOLD) {
        bufferReady = true;
        console.log('[STREAM] buffer estratégico pronto (512KB), iniciando playback');
      }
    }
    bufferedStream.push(chunk);
  });

  ffmpeg.stdout.on('end', () => bufferedStream.end());
  ffmpeg.stdout.on('error', err => bufferedStream.destroy(err));

  // Armazenar flag de readiness para queueManager verificar
  bufferedStream.isBufferReady = () => bufferReady;

  return bufferedStream;
}

module.exports = { createOpusStream, createOpusStreamFromUrl };
