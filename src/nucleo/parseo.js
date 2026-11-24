'use strict';
// Parseo de la salida de git. Sin vscode ni I/O: es lo que cubren los tests.

const CERO = /^0+$/;
const CABECERA_BLAME = /^([0-9a-f]{40,64}) \d+ (\d+)(?: \d+)?$/;

// git entrecomilla rutas con caracteres raros ("a\303\261o.txt"); los octales son bytes UTF-8
function desentrecomillar(ruta) {
  if (!ruta.startsWith('"') || !ruta.endsWith('"')) { return ruta; }
  const bytes = [];
  const cuerpo = Array.from(ruta.slice(1, -1)); // por puntos de código: un emoji son dos unidades UTF-16
  const escapes = { n: 10, t: 9, r: 13, b: 8, f: 12, v: 11, a: 7, '"': 34, '\\': 92 };
  for (let i = 0; i < cuerpo.length; i++) {
    const c = cuerpo[i];
    if (c !== '\\') { bytes.push(...Buffer.from(c, 'utf8')); continue; }
    const sig = cuerpo[i + 1];
    if (/[0-7]/.test(sig)) {
      bytes.push(parseInt(cuerpo.slice(i + 1, i + 4).join(''), 8));
      i += 3;
    } else {
      bytes.push(escapes[sig] !== undefined ? escapes[sig] : sig.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

// git blame --porcelain → { lineas: [sha por línea], commits: Map(sha → datos) }
function parsearBlame(texto) {
  const commits = new Map();
  const lineas = [];
  let sha = null;
  let linea = 0;
  for (const l of texto.split('\n')) {
    const m = CABECERA_BLAME.exec(l);
    if (m) {
      sha = m[1];
      linea = Number(m[2]);
      if (!commits.has(sha)) { commits.set(sha, { sha, sinCommit: CERO.test(sha) }); }
      continue;
    }
    if (l.startsWith('\t')) {
      lineas[linea - 1] = sha;
      continue;
    }
    const c = sha && commits.get(sha);
    if (!c) { continue; }
    const esp = l.indexOf(' ');
    const clave = esp < 0 ? l : l.slice(0, esp);
    const valor = esp < 0 ? '' : l.slice(esp + 1);
    if (clave === 'author') { c.autor = valor; }
    else if (clave === 'author-mail') { c.correo = valor.replace(/^<|>$/g, ''); }
    else if (clave === 'author-time') { c.fecha = Number(valor) * 1000; }
    else if (clave === 'summary') { c.resumen = valor; }
    else if (clave === 'filename') { c.fichero = desentrecomillar(valor); }
    else if (clave === 'previous') {
      const e = valor.indexOf(' ');
      c.anterior = valor.slice(0, e);
      c.ficheroAnterior = desentrecomillar(valor.slice(e + 1));
    }
  }
  return { lineas, commits };
}

const SEP_REG = '\x1e';
const SEP_CAMPO = '\x1f';
// Formato de git log que entiende parsearLog
const FORMATO_LOG = `${SEP_REG}%H${SEP_CAMPO}%P${SEP_CAMPO}%an${SEP_CAMPO}%ae${SEP_CAMPO}%at${SEP_CAMPO}%D${SEP_CAMPO}%s`;

const NAME_STATUS = /^([ACDMRTUXB])\d*\t([^\t]+)(?:\t([^\t]+))?$/;

function parsearNameStatus(l) {
  const m = NAME_STATUS.exec(l);
  if (!m) { return null; }
  const [, estado, a, b] = m;
  return b
    ? { estado, rutaAnterior: desentrecomillar(a), ruta: desentrecomillar(b) }
    : { estado, ruta: desentrecomillar(a) };
}

// git log --format=FORMATO_LOG [--name-status] → commits; las líneas que no son name-status (el parche de -L) se ignoran
function parsearLog(texto) {
  return texto.split(SEP_REG).filter(r => r.trim()).map(r => {
    const [cab, ...resto] = r.split('\n');
    const [sha, padres, autor, correo, fecha, refs, resumen] = cab.split(SEP_CAMPO);
    return {
      sha,
      padres: padres ? padres.split(' ') : [],
      autor,
      correo,
      fecha: Number(fecha) * 1000,
      refs: refs ? refs.split(', ').filter(Boolean) : [],
      resumen: resumen || '',
      ficheros: resto.map(parsearNameStatus).filter(Boolean),
    };
  });
}

// git diff --name-status -M (sin -z)
function parsearDiff(texto) {
  return texto.split('\n').map(parsearNameStatus).filter(Boolean);
}

// git log --numstat --format=%x1e%H → sha → líneas añadidas y borradas (un binario no tiene líneas)
const FORMATO_SHA = '%x1e%H';
const NUMSTAT = /^(\d+|-)\t(\d+|-)\t/;
function parsearNumstat(texto) {
  const lineas = new Map();
  for (const bloque of texto.split(SEP_REG)) {
    const [sha, ...resto] = bloque.trim().split('\n');
    if (!sha) { continue; }
    let mas = 0, menos = 0, binario = false;
    for (const l of resto) {
      const m = NUMSTAT.exec(l);
      if (!m) { continue; }
      if (m[1] === '-') { binario = true; } else { mas += Number(m[1]); menos += Number(m[2]); }
    }
    lineas.set(sha.trim(), { mas, menos, binario });
  }
  return lineas;
}

// git stash list --format=FORMATO_STASH; %gd es el nombre (stash@{n}) y el primer padre, la base del stash
const FORMATO_STASH = `${SEP_REG}%H${SEP_CAMPO}%P${SEP_CAMPO}%an${SEP_CAMPO}%ae${SEP_CAMPO}%at${SEP_CAMPO}%gd${SEP_CAMPO}%s`;
function parsearStash(texto) {
  return texto.split(SEP_REG).filter(r => r.trim()).map(r => {
    const [sha, padres, autor, correo, fecha, nombre, resumen] = r.trim().split(SEP_CAMPO);
    return { sha, base: padres.split(' ')[0], autor, correo, fecha: Number(fecha) * 1000, nombre, resumen: resumen || '' };
  });
}

// git worktree list --porcelain: bloques separados por una línea en blanco
function parsearWorktrees(texto) {
  return texto.split(/\n\n+/).map(b => {
    const w = {};
    for (const l of b.split('\n')) {
      const i = l.indexOf(' ');
      const [clave, valor] = i < 0 ? [l, ''] : [l.slice(0, i), l.slice(i + 1)];
      if (clave === 'worktree') { w.ruta = valor; }
      if (clave === 'HEAD') { w.head = valor; }
      if (clave === 'branch') { w.rama = valor.replace(/^refs\/heads\//, ''); }
      if (clave === 'bare') { w.bare = true; }
      if (clave === 'prunable') { w.huerfano = true; } // su carpeta ya no existe
    }
    return w;
  }).filter(w => w.ruta && !w.bare && !w.huerfano);
}

// git shortlog -sne → autores por correo (la misma persona con dos nombres cuenta una vez, con el que más usa)
// una persona es su correo, aunque firme con varios nombres; sin correo, su nombre
const claveDePersona = (correo, nombre) => (correo || nombre || '').toLowerCase();

function parsearShortlog(texto) {
  const porCorreo = new Map();
  for (const l of texto.split('\n')) {
    const m = /^\s*(\d+)\t(.*?)\s*<([^>]*)>\s*$/.exec(l);
    if (!m) { continue; }
    const [, n, nombre, correo] = m;
    const clave = claveDePersona(correo, nombre);
    const a = porCorreo.get(clave) || { nombre, correo, commits: 0, maxNombre: 0 };
    a.commits += Number(n);
    if (Number(n) > a.maxNombre) { a.nombre = nombre; a.maxNombre = Number(n); }
    porCorreo.set(clave, a);
  }
  return [...porCorreo.values()].map(({ nombre, correo, commits }) => ({ nombre, correo, commits }))
    .sort((a, b) => b.commits - a.commits || a.nombre.localeCompare(b.nombre));
}

// %aE/%aN aplican .mailmap como shortlog: si no, las cifras no cuadrarían con las de commits
const FORMATO_AUTOR = `${SEP_REG}%aE${SEP_CAMPO}%aN`;

// git log --numstat --format=FORMATO_AUTOR → Map(clave de persona → { mas, menos })
function parsearLineasPorAutor(texto) {
  const porClave = new Map();
  for (const bloque of texto.split(SEP_REG)) {
    const [cabecera, ...resto] = bloque.split('\n');
    if (!cabecera.trim()) { continue; }
    const [correo, nombre] = cabecera.split(SEP_CAMPO);
    const clave = claveDePersona(correo, nombre);
    const a = porClave.get(clave) || { mas: 0, menos: 0 };
    for (const l of resto) {
      const m = NUMSTAT.exec(l);
      if (m && m[1] !== '-') { a.mas += Number(m[1]); a.menos += Number(m[2]); }
    }
    porClave.set(clave, a);
  }
  return porClave;
}

module.exports = {
  parsearShortlog, parsearLineasPorAutor, claveDePersona, FORMATO_AUTOR,
  desentrecomillar, parsearBlame, parsearLog, parsearDiff, parsearNumstat, parsearStash, parsearWorktrees,
  FORMATO_LOG, FORMATO_SHA, FORMATO_STASH,
};
