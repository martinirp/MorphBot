const fs = require('fs');
const path = require('path');

const db = require('../utils/db');
const cachePath = require('../utils/cachePath');
const { isValidOggOpus } = require('../utils/validator');
const { removeSongCompletely } = require('../utils/removeSong');

const ROOT = path.resolve(path.join(__dirname, '..'));
const CACHE_ROOT = path.join(ROOT, 'music_cache_opus');

function walkDir(dir, acc = []) {
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkDir(full, acc);
    } else if (e.isFile() && e.name === 'audio.opus') {
      acc.push(full);
    }
  }
  return acc;
}

async function main() {
  const fix = process.argv.includes('--fix');

  console.log('🔎 Validando cache e banco...');

  const songs = db.getAllSongs();
  const dbFiles = new Set();
  let ok = 0;
  let broken = 0;
  let missing = 0;
  let fixed = 0;

  for (const s of songs) {
    const file = s.file || cachePath(s.videoId);
    const abs = path.resolve(path.join(ROOT, file));
    dbFiles.add(abs);

    if (!fs.existsSync(abs)) {
      console.log(`❌ MISSING: ${s.videoId} → ${abs}`);
      missing++;
      if (fix) {
        try { removeSongCompletely(s.videoId); fixed++; } catch {}
      }
      continue;
    }

    if (!isValidOggOpus(abs)) {
      console.log(`❌ BROKEN: ${s.videoId} → ${abs}`);
      broken++;
      if (fix) {
        try { removeSongCompletely(s.videoId); fixed++; } catch {}
      }
      continue;
    }

    ok++;
  }

  // Orphans: files in cache with no DB record
  const allCacheFiles = walkDir(CACHE_ROOT);
  const orphans = allCacheFiles.filter(f => !dbFiles.has(path.resolve(f)));

  console.log('');
  console.log('📊 Resultado:');
  console.log(`   ✅ Válidos: ${ok}`);
  console.log(`   ❌ Corrompidos: ${broken}`);
  console.log(`   ❌ Ausentes: ${missing}`);
  console.log(`   🧩 Órfãos (no cache sem DB): ${orphans.length}`);
  if (fix) console.log(`   🧹 Removidos: ${fixed}`);

  if (fix && orphans.length) {
    console.log('🧹 Removendo órfãos...');
    for (const f of orphans) {
      try {
        const dir = path.dirname(f);
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`   → ${dir}`);
      } catch {}
    }
  }

  console.log('✅ Validação concluída');
}

main().catch(err => {
  console.error('❌ Erro na validação:', err);
  process.exit(1);
});
