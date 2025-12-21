const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let backendStarted = false;

// =============================
// 🔒 Evitar múltiplas instâncias
// =============================
const lockFile = path.join(__dirname, '.morphbot.lock');

function ensureSingleInstance() {
  try {
    if (fs.existsSync(lockFile)) {
      const pidStr = fs.readFileSync(lockFile, 'utf-8').trim();
      const existingPid = Number(pidStr);
      if (existingPid && Number.isFinite(existingPid)) {
        try {
          process.kill(existingPid, 0); // verifica se processo existe
          console.log(`⚠️ Já existe instância ativa (PID=${existingPid}). Encerrando esta.`);
          process.exit(0);
        } catch {
          // PID não existe mais → bloquear novamente
        }
      }
    }
  } catch {}

  try {
    fs.writeFileSync(lockFile, String(process.pid));
  } catch (e) {
    console.error('❌ Não foi possível criar lockfile:', e);
  }

  const release = () => {
    try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch {}
  };
  process.on('exit', release);
  process.on('SIGINT', () => { release(); process.exit(0); });
  process.on('SIGTERM', () => { release(); process.exit(0); });
}

ensureSingleInstance();

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

