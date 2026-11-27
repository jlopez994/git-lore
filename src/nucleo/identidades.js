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

// usuarios que no dicen quién es nadie: dos «admin@» de dominios distintos no son la misma persona
const GENERICOS = new Set(['admin', 'root', 'info', 'dev', 'devs', 'git', 'noreply', 'no-reply', 'user', 'test', 'ci', 'bot',
  'github', 'gitlab', 'jenkins', 'build', 'builder', 'developer', 'support', 'contact', 'mail', 'me', 'hello', 'team', 'web']);

const compacto = s => normalizarNombre(s).replace(/[^a-z0-9]/g, '');

// «jose.perez+git@x» y «12345+joseperez@users.noreply.github.com» → «joseperez»
function usuarioDe(correo) {
  const [local, dominio] = (correo || '').toLowerCase().split('@');
  if (!local || !dominio) { return null; }
  const u = compacto((dominio === 'users.noreply.github.com' ? local.replace(/^\d+\+/, '') : local).replace(/\+.*$/, ''));
  return u.length >= 3 && !GENERICOS.has(u) ? u : null;
}

// «Iker M» y «Iker Martínez»: el mismo primer nombre y lo demás empieza igual
function nombresParecidos(a, b) {
  const [x, y] = [normalizarNombre(a).split(' '), normalizarNombre(b).split(' ')];
  if (x[0].length < 2 || x[0] !== y[0] || x.join(' ') === y.join(' ')) { return false; }
  const empieza = (p, q) => p.length >= 2 && p.length <= q.length && p.slice(1).every((w, k) => q[k + 1].startsWith(w));
  return empieza(x, y) || empieza(y, x);
}

// parejas que seguramente son la misma persona, con el motivo. fuerte: se proponen marcadas. El destino es el de más
// commits y con correo (git ignora un destino sin él)
function sugerencias(personas) {
  const pares = new Map();
  const anotar = (a, b, motivo, fuerte) => {
    if (a === b || (!a.correo && !b.correo)) { return; }
    const [destino, origen] = [a, b].sort((p, q) => (!!q.correo - !!p.correo) || q.commits - p.commits);
    const k = [personas.indexOf(origen), personas.indexOf(destino)].sort((p, q) => p - q).join(':');
    const previo = pares.get(k);
    if (!previo || (fuerte && !previo.fuerte)) { pares.set(k, { origen, destino, motivo, fuerte }); }
  };
  const porClave = new Map();
  const meter = (k, p) => { if (k) { porClave.set(k, [...(porClave.get(k) || []), p]); } };
  for (const p of personas) {
    const n = normalizarNombre(p.nombre);
    meter(n && `nombre:${n}`, p);
    const u = usuarioDe(p.correo);
    meter(u && `usuario:${u}`, p);
    // un nombre sin espacios puede ser un login, pero también un nombre de pila («Ana» y ana@otra.com): sin marcar
    const c = compacto(p.nombre);
    if (n && !n.includes(' ') && c.length >= 3 && !GENERICOS.has(c) && c !== u) { meter(`login:${c}`, p); }
    if (u) { meter(`login:${u}`, p); }
    meter(n && `pila:${n.split(' ')[0]}`, p);
  }
  for (const [k, grupo] of porClave) {
    const motivo = k.split(':')[0];
    for (let x = 0; x < grupo.length; x++) {
      for (let y = x + 1; y < grupo.length; y++) {
        if (motivo === 'pila') {
          if (nombresParecidos(grupo[x].nombre, grupo[y].nombre)) { anotar(grupo[x], grupo[y], 'parecido', false); }
        } else if (motivo === 'login') {
          anotar(grupo[x], grupo[y], 'usuario', false);
        } else {
          anotar(grupo[x], grupo[y], motivo, true);
        }
      }
    }
  }
  return [...pares.values()];
}

// parejas elegidas → uniones { origenes, destino }: A~B y B~C son una sola persona, en la de más commits con correo
function agrupar(pares) {
  const padre = new Map();
  const raiz = p => { while (padre.get(p) !== p) { p = padre.get(p); } return p; };
  for (const { origen, destino } of pares) {
    for (const p of [origen, destino]) { if (!padre.has(p)) { padre.set(p, p); } }
    padre.set(raiz(origen), raiz(destino));
  }
  const grupos = new Map();
  for (const p of padre.keys()) { grupos.set(raiz(p), [...(grupos.get(raiz(p)) || []), p]); }
  return [...grupos.values()].map(g => {
    const [destino] = [...g].sort((p, q) => (!!q.correo - !!p.correo) || q.commits - p.commits);
    return { origenes: g.filter(p => p !== destino), destino };
  });
}

module.exports = { normalizarNombre, gruposPorNombre, unirEnMailmap, sugerencias, agrupar };
