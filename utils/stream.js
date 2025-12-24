const { spawn } = require('child_process');

function createOpusStream(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  return createOpusStreamFromUrl(url);
}

function createOpusStreamFromUrl(url) {
  const bitrateK = (() => {
    const v = parseInt(process.env.OPUS_BITRATE_K || '96', 10);
    if (Number.isNaN(v)) return 96;
    return Math.min(512, Math.max(16, v));
  })();
  const compLevel = (() => {
    const v = parseInt(process.env.OPUS_COMPRESSION_LEVEL || '10', 10);
    if (Number.isNaN(v)) return 10;
    return Math.min(10, Math.max(0, v));
  })();

  console.log(`[STREAM] ffmpeg opus settings: bitrate=${bitrateK}k compression=${compLevel}`);

  const ytdlp = spawn('yt-dlp', ['-f', 'bestaudio', '-o', '-', url], {
    stdio: ['ignore', 'pipe', 'ignore']
  });
  const ffmpeg = spawn('ffmpeg', [
    '-loglevel', 'quiet',
    '-i', 'pipe:0',
    '-f', 'ogg',
    '-acodec', 'libopus',
    '-b:a', `${bitrateK}k`,
    '-compression_level', String(compLevel),
    'pipe:1'
  ], {
    stdio: ['pipe', 'pipe', 'ignore']
  });

  // Conectar pipeline de forma explícita
  ytdlp.stdout.pipe(ffmpeg.stdin);

  // Propagar erros do pipeline (sem causar exceções no consumidor)
  ytdlp.on('error', err => {
    console.error('[STREAM] yt-dlp erro:', err?.message || err);
    try { ffmpeg.stdin.end(); } catch {}
  });
  ffmpeg.on('error', err => {
    console.error('[STREAM] ffmpeg erro:', err?.message || err);
  });
  
  // Passar stream diretamente sem buffer estratégico
  const { PassThrough } = require('stream');
  const bufferedStream = new PassThrough();

  ffmpeg.stdout.on('data', chunk => {
    // Respeitar backpressure: pausar leitura se necessário
    if (!bufferedStream.push(chunk)) {
      try { ffmpeg.stdout.pause(); } catch {}
      bufferedStream.once('drain', () => {
        try { ffmpeg.stdout.resume(); } catch {}
      });
    }
  });

  ffmpeg.stdout.on('end', () => {
    console.log('[STREAM] stream finalizado normalmente');
    bufferedStream.end();
  });
  ffmpeg.stdout.on('close', () => {
    try { bufferedStream.end(); } catch {}
  });
  ffmpeg.stdout.on('error', err => {
    console.error('[STREAM] stdout erro:', err?.message || err);
    try { bufferedStream.end(); } catch {}
  });

  // Encerramento coordenado dos processos quando o consumidor termina
  const cleanup = () => {
    try { ytdlp.kill('SIGKILL'); } catch {}
    try { ffmpeg.kill('SIGKILL'); } catch {}
  };
  bufferedStream.on('close', cleanup);
  bufferedStream.on('end', cleanup);

  return bufferedStream;
}

module.exports = { createOpusStream, createOpusStreamFromUrl };
