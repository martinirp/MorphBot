function normalize(str = '') {
  return str
    .toLowerCase()
    .replace(/official|music|video|lyrics|clip|hd|4k/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Expande a QUERY do usuário para bater com search_keys
 * Lógica inspirada no dibuiador antigo (ordem não importa)
 */
function variants(query) {
  const base = normalize(query);
  if (!base) return [];

  const parts = base.split(' ').filter(Boolean);
  const out = new Set();

  // 1️⃣ query original
  out.add(base);

  // 2️⃣ rotações simples
  if (parts.length >= 3) {
    out.add([...parts.slice(1), parts[0]].join(' ')); // ghost square hammer
    out.add([parts[parts.length - 1], ...parts.slice(0, -1)].join(' '));
  }

  // 3️⃣ ordem alfabética (ignora posição)
  if (parts.length > 1) {
    out.add([...parts].sort().join(' '));
  }

  // 4️⃣ pares adjacentes
  for (let i = 0; i < parts.length - 1; i++) {
    out.add(`${parts[i]} ${parts[i + 1]}`);
  }

  // 5️⃣ reduções (como o dibuiador fazia implicitamente)
  out.add(parts[0]); // artista ou palavra forte

  if (parts.length >= 2) {
    out.add(parts.slice(-2).join(' ')); // nome da música
  }

  if (parts.length >= 3) {
    out.add(parts.slice(-3).join(' '));
  }

  return [...out];
}

module.exports = { normalize, variants };
