const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let backendStarted = false;

function startBackendIfExists() {
  if (backendStarted) return;

  const backendDir = path.resolve(__dirname, '..', 'os', 'backend');
  const backendEntry = path.join(backendDir, 'index.js');

  if (!fs.existsSync(backendEntry)) {
    console.log('ℹ️ Backend não encontrado, pulando.');
    return;
  }

  console.log('🚀 Iniciando backend auxiliar...');
  backendStarted = true;

  const backend = spawn('node', [backendEntry], {
    stdio: 'inherit',
    shell: false,
    cwd: backendDir
  });

  backend.on('exit', (code, signal) => {
    console.error(`❌ Backend finalizado (code=${code}, signal=${signal})`);
  });

  backend.on('error', err => {
    console.error('❌ Erro ao iniciar backend:', err);
  });
}

function startBot() {
  console.log('🚀 Iniciando bot...');

  const bot = spawn('node', ['index.js'], {
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, __MORPHBOT_STARTER: '1' }
  });

  bot.on('exit', (code, signal) => {
    console.error(
      `❌ Bot finalizado (code=${code}, signal=${signal})`
    );

    console.log('🔄 Reiniciando em 2 segundos...');
    setTimeout(startBot, 2000);
  });

  bot.on('error', err => {
    console.error('❌ Erro ao iniciar o bot:', err);
    console.log('🔄 Tentando reiniciar em 2 segundos...');
    setTimeout(startBot, 2000);
  });
}

startBackendIfExists();
startBot();

