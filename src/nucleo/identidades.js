'use strict';
// Juntar identidades de git (la misma persona con otro nombre o correo) escribiendo un mailmap. Sin vscode: lo
// prueban los tests.

// «José  Pérez» y «jose perez» cuentan como el mismo nombre al sugerir duplicados
const normalizarNombre = n => (n || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

// personas, ya con el mailmap aplicado, que firman con el mismo nombre y distinto correo. Cada grupo conserva el orden
// de entrada (shortlog: más commits primero). Sin ningún correo no hay a quién juntarlas: git ignora un destino sin él
function gruposPorNombre(personas) {
  const grupos = new Map();
  for (const p of personas) {
    const n = normalizarNombre(p.nombre);
    if (n) { grupos.set(n, [...(grupos.get(n) || []), p]); }
  }
  return [...grupos.values()].filter(g => g.length > 1 && g.some(p => p.correo));
}

// git no deja < > ni saltos de línea en nombres y correos, pero el fichero se puede editar a mano
const limpio = s => String(s || '').replace(/[<>\r\n]/g, '').trim();

// git busca cada entrada por nombre y correo del commit, sin distinguir mayúsculas
const claveDeEntrada = (correo, nombre) => `${(nombre || '').toLowerCase()} <${(correo || '').toLowerCase()}>`;

// git admite # dentro de un nombre: solo es comentario la línea que empieza por #
const LINEA = /^(?!\s*#)\s*([^<]*?)\s*<([^>]*)>(?:\s*([^<]*?)\s*<([^>]*)>)?/;

function claveDeLinea(linea) {
  const m = LINEA.exec(linea);
  if (!m) { return null; }
  return m[4] !== undefined ? claveDeEntrada(m[4], m[3]) : claveDeEntrada(m[2], '');
}

// crudas: identidades tal como están en los commits. Sus líneas anteriores se quitan: una persona juntada dos veces
// solo tiene la última, y lo que ya apuntaba al origen pasa al destino porque también viene en crudas. Con nombre y
// correo: una entrada así del .mailmap del repo ganaría a una de solo correo
function unirEnMailmap(texto, crudas, destino) {
  const nuevas = new Map();
  for (const c of crudas) {
    const quien = limpio(c.nombre) ? `${limpio(c.nombre)} ` : '';
    nuevas.set(claveDeEntrada(c.correo, c.nombre), `${limpio(destino.nombre)} <${limpio(destino.correo)}> ${quien}<${limpio(c.correo)}>`);
  }
  const quedan = (texto || '').split('\n').filter(l => !nuevas.has(claveDeLinea(l)));
  while (quedan.length && !quedan[quedan.length - 1].trim()) { quedan.pop(); }
  return `${[...quedan, ...nuevas.values()].join('\n')}\n`;
}

module.exports = { normalizarNombre, gruposPorNombre, unirEnMailmap };
