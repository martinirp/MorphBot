const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(path.join(__dirname, '..'));
const DB_PATH = path.join(ROOT, 'utils', 'music.db');
const CACHE_ROOT = path.join(ROOT, 'music_cache_opus');
const TEMP_ROOT = path.join(ROOT, 'temp_downloads');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer.trim().toLowerCase()));
  });
}

async function main() {
  console.log('🔥 RESET COMPLETO DO BANCO DE DADOS E CACHE');
  console.log('');
  console.log('Isso vai remover:');
  console.log(`  - Banco de dados: ${DB_PATH}`);
  console.log(`  - Cache Opus: ${CACHE_ROOT}`);
  console.log(`  - Downloads temporários: ${TEMP_ROOT}`);
  console.log('');

  const force = process.argv.includes('--force') || process.argv.includes('-f');

  if (!force) {
    const answer = await ask('Tem certeza? (sim/não): ');
    if (answer !== 'sim' && answer !== 's' && answer !== 'yes' && answer !== 'y') {
      console.log('❌ Cancelado pelo usuário.');
      rl.close();
      return;
    }
  }

  console.log('');
  console.log('🧹 Removendo arquivos...');

  // Remover banco de dados + arquivos temporários do SQLite
  const dbFiles = [
    DB_PATH,
    `${DB_PATH}-journal`,
    `${DB_PATH}-shm`,
    `${DB_PATH}-wal`
  ];

  for (const file of dbFiles) {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`  ✅ Removido: ${path.basename(file)}`);
      }
    } catch (err) {
      console.error(`  ❌ Erro ao remover ${path.basename(file)}:`, err.message);
    }
  }

  // Remover cache de áudio
  try {
    if (fs.existsSync(CACHE_ROOT)) {
      fs.rmSync(CACHE_ROOT, { recursive: true, force: true });
      console.log(`  ✅ Removido: music_cache_opus/`);
    }
  } catch (err) {
    console.error('  ❌ Erro ao remover cache:', err.message);
  }

  // Remover downloads temporários
  try {
    if (fs.existsSync(TEMP_ROOT)) {
      fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
      console.log(`  ✅ Removido: temp_downloads/`);
    }
  } catch (err) {
    console.error('  ❌ Erro ao remover downloads temporários:', err.message);
  }

  console.log('');
  console.log('✅ Reset completo! O banco será recriado automaticamente quando o bot iniciar.');
  rl.close();
}

main().catch(err => {
  console.error('❌ Erro no reset:', err);
  rl.close();
  process.exit(1);
});
