'use strict';
// Puerta única a git: la API de la extensión vscode.git y el binario que ella usa.
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const {
  parsearBlame, parsearLog, parsearShortlog, parsearDiff, parsearNumstat, parsearStash, parsearWorktrees, FORMATO_LOG, FORMATO_SHA, FORMATO_STASH,
} = require('./nucleo/parseo');
const { webDeRemoto, elegirRemoto } = require('./nucleo/remotos');

const t = vscode.l10n.t;
let api;

async function obtenerApi() {
  if (api) { return api; }
  const ext = vscode.extensions.getExtension('vscode.git');
  if (!ext) { throw new Error(t('The built-in Git extension is not available')); }
  const exportado = await ext.activate();
  if (!exportado.enabled) { throw new Error(t('The built-in Git extension is disabled')); }
  api = exportado.getAPI(1);
  return api;
}

class ErrorGit extends Error {
  constructor(args, codigo, stderr) {
    super(stderr.trim() || `git ${args[0]} exited with ${codigo}`);
    this.codigo = codigo;
  }
}

function ejecutar(cwd, args, { entrada, token, entorno } = {}) {
  return new Promise((resolver, rechazar) => {
    const proc = cp.spawn(api.git.path, ['-c', 'core.quotePath=false', ...args], {
      cwd,
      windowsHide: true,
      // solo lectura: que diff/status no tomen el lock del índice y choquen con los comandos del usuario
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...entorno },
    });
    const salida = [];
    const errores = [];
    const cancelar = token && token.onCancellationRequested(() => proc.kill());
    proc.stdout.on('data', d => salida.push(d));
    proc.stderr.on('data', d => errores.push(d));
    proc.on('error', e => { cancelar && cancelar.dispose(); rechazar(e); });
    proc.on('close', codigo => {
      cancelar && cancelar.dispose();
      if (token && token.isCancellationRequested) { return rechazar(new vscode.CancellationError()); }
      if (codigo !== 0) { return rechazar(new ErrorGit(args, codigo, Buffer.concat(errores).toString('utf8'))); }
      resolver(Buffer.concat(salida).toString('utf8'));
    });
    if (entrada !== undefined) {
      proc.stdin.on('error', () => { }); // git puede cerrar stdin antes de leerlo todo si falla
      proc.stdin.end(entrada);
    }
  });
}

async function repoDe(uri) {
  if (!uri || uri.scheme !== 'file') { return null; }
  return (await obtenerApi()).getRepository(uri);
}

function rutaRelativa(repo, uri) {
  return path.relative(repo.rootUri.fsPath, uri.fsPath).split(path.sep).join('/');
}

// El texto se pasa por --contents para que las líneas no se desplacen con cambios sin guardar
async function blame(repo, documento, token) {
  const ruta = rutaRelativa(repo, documento.uri);
  const salida = await ejecutar(repo.rootUri.fsPath, ['blame', '--porcelain', '--contents', '-', '--', ruta],
    { entrada: documento.getText(), token });
  return parsearBlame(salida);
}

async function mensaje(repo, sha) {
  return (await ejecutar(repo.rootUri.fsPath, ['show', '-s', '--format=%B', sha])).trim();
}

async function historial(repo, uri, { desde, hasta, limite = 500 } = {}, token) {
  const ruta = rutaRelativa(repo, uri);
  const args = desde
    ? ['log', `-L${desde},${hasta}:${ruta}`, '-s', `-n${limite}`, `--format=${FORMATO_LOG}`]
    : ['log', '--follow', '-M', '--name-status', `-n${limite}`, `--format=${FORMATO_LOG}`, '--', ruta];
  return parsearLog(await ejecutar(repo.rootUri.fsPath, args, { token }));
}

// las mismas opciones que historial(): mismos commits, para cruzarlos por sha
async function lineasDeFichero(repo, uri, limite) {
  const args = ['log', '--follow', '-M', '--numstat', `-n${limite}`, `--format=${FORMATO_SHA}`, '--', rutaRelativa(repo, uri)];
  return parsearNumstat(await ejecutar(repo.rootUri.fsPath, args));
}

async function ficherosDeCommit(repo, sha) {
  const args = ['show', '-M', '--name-status', '--first-parent', `--format=${FORMATO_LOG}`, sha];
  const [commit] = parsearLog(await ejecutar(repo.rootUri.fsPath, args));
  return commit;
}

// ramas, remotas y tags, no --all: dejaría fuera los stash, notas y checkpoints de otras herramientas (refs/t3/…)
// sin las remotas también se quitan sus insignias: %D decora con todas las refs
const ALCANCES = {
  todas: ['--branches', '--remotes', '--tags', 'HEAD'],
  locales: ['--branches', '--tags', 'HEAD', '--decorate-refs-exclude=refs/remotes'],
  actual: ['HEAD'],
};

// extra: HEADs separados de otros worktrees, que no salen con --branches (solo shas, nunca opciones)
async function grafo(repo, { saltar = 0, limite = 300, alcance = 'todas', extra = [] } = {}) {
  // repo recién creado: «git log HEAD» fallaría con «unknown revision»
  if (!repo.state.HEAD || !repo.state.HEAD.commit) { return []; }
  // refs completas: el tipo de cada insignia sale del prefijo y no de si el nombre lleva «/»
  const revisiones = alcance === 'actual' ? [] : extra.filter(s => /^[0-9a-f]{40,64}$/.test(s));
  const args = ['log', ...ALCANCES[alcance], ...revisiones, '--decorate=full', '--date-order', `--skip=${saltar}`, `-n${limite}`, `--format=${FORMATO_LOG}`];
  return parsearLog(await ejecutar(repo.rootUri.fsPath, args));
}

async function refs(repo) {
  const salida = await ejecutar(repo.rootUri.fsPath,
    ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%1f%(refname:short)', 'refs/heads', 'refs/remotes', 'refs/tags']);
  return salida.split('\n').filter(Boolean).map(l => {
    const [completo, nombre] = l.split('\x1f');
    const tipo = completo.startsWith('refs/heads/') ? 'rama' : completo.startsWith('refs/tags/') ? 'tag' : 'remota';
    return { nombre, tipo, completo };
  }).filter(r => !r.nombre.endsWith('/HEAD'));
}

// Una ref que empieza por «-» (un tag «--output=x» de un repo clonado) sería una opción de git
async function resolverRef(repo, ref) {
  if (typeof ref !== 'string' || !ref.trim() || ref.trim().startsWith('-')) {
    throw new Error(t('Not a valid ref: {0}', String(ref)));
  }
  try {
    return (await ejecutar(repo.rootUri.fsPath, ['rev-parse', '--verify', '--quiet', `${ref.trim()}^{commit}`])).trim();
  } catch {
    throw new Error(t('Not a valid ref: {0}', ref));
  }
}

// todas las refs con su commit: si cambia, algo se movió (fetch, push, ramas o tags creados fuera, un stash).
// repo.state.refs no sirve: las versiones recientes de VS Code lo dejan vacío y cargan las refs bajo demanda
// refs/stash es solo el de arriba: descartar uno intermedio solo se ve en la lista completa
async function firmaDeRefs(repo) {
  const raiz = repo.rootUri.fsPath;
  const [refs, stash] = await Promise.all([
    ejecutar(raiz, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes', 'refs/tags']),
    ejecutar(raiz, ['stash', 'list', '--format=%H']),
  ]);
  return `${refs}\n${stash}`;
}

// el .git compartido por todos los worktrees: ahí viven las refs
async function dirComun(repo) {
  const salida = (await ejecutar(repo.rootUri.fsPath, ['rev-parse', '--git-common-dir'])).trim();
  return path.resolve(repo.rootUri.fsPath, salida);
}

// HEAD explícito: sin revisión y sin terminal, shortlog se queda leyendo de la entrada estándar
async function autores(repo) {
  if (!repo.state.HEAD || !repo.state.HEAD.commit) { return []; }
  return parsearShortlog(await ejecutar(repo.rootUri.fsPath, ['shortlog', '-sne', 'HEAD']));
}

// con correo: «<correo>» literal (--fixed-strings: un «+» no es regex), sin distinguir mayúsculas como al agrupar.
// sin correo git guarda «Nombre <>»: se ancla entera con regex escapada, o «Anabel» casaría con «Ana Anabel <>»
async function commitsDeAutor(repo, autor, limite = 200) {
  const escapar = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patron = autor.correo
    ? ['--fixed-strings', `--author=<${autor.correo}>`]
    : ['--extended-regexp', `--author=^${escapar(autor.nombre)} <>$`];
  return parsearLog(await ejecutar(repo.rootUri.fsPath,
    ['log', 'HEAD', '--regexp-ignore-case', ...patron, `-n${limite}`, `--format=${FORMATO_LOG}`]));
}

async function stashes(repo) {
  return parsearStash(await ejecutar(repo.rootUri.fsPath, ['stash', 'list', `--format=${FORMATO_STASH}`]));
}

// los demás worktrees del repo (el propio se quita: es el que ya se está viendo). realpath: git da la ruta real
// y VS Code puede tener la del enlace (/tmp → /private/tmp en macOS)
async function worktrees(repo) {
  const real = r => { try { return fs.realpathSync(r); } catch { return path.resolve(r); } };
  const propio = real(repo.rootUri.fsPath);
  const todos = parsearWorktrees(await ejecutar(repo.rootUri.fsPath, ['worktree', 'list', '--porcelain']));
  return todos.filter(w => real(w.ruta) !== propio);
}

// el nombre stash@{n} se mueve con cada stash nuevo: se busca por sha justo antes de tocarlo
async function nombreDeStash(repo, sha) {
  const s = (await stashes(repo)).find(x => x.sha === sha);
  if (!s) { throw new Error(t('That stash no longer exists')); }
  return s.nombre;
}

async function usarStash(repo, sha, accion) {
  if (!['apply', 'pop', 'drop'].includes(accion)) { throw new Error(`stash ${accion}`); }
  return modificar(repo, ['stash', accion, await nombreDeStash(repo, sha)]);
}

// recibe SHAs ya resueltos; hasta undefined = árbol de trabajo
async function diferencias(repo, desde, hasta) {
  const args = ['diff', '--name-status', '-M', desde, ...(hasta ? [hasta] : []), '--'];
  return parsearDiff(await ejecutar(repo.rootUri.fsPath, args));
}

// Lo que la API de vscode.git no tiene. Sin TTY, un editor o una pregunta de git colgarían la acción: que fallen
const SIN_TTY = { GIT_EDITOR: 'true', GIT_TERMINAL_PROMPT: '0' };
async function modificar(repo, args) {
  try {
    await ejecutar(repo.rootUri.fsPath, args, { entorno: SIN_TTY });
  } finally {
    await repo.status().catch(() => { }); // también tras un conflicto; si falla, que no tape el error de git
  }
}

// un merge pide -m: se toma el primer padre, la rama en la que se fusionó
async function opcionMerge(repo, sha) {
  const linea = (await ejecutar(repo.rootUri.fsPath, ['rev-list', '--parents', '-n1', sha])).trim();
  return linea.split(' ').length > 2 ? ['-m', '1'] : [];
}

async function cherryPick(repo, sha) {
  return modificar(repo, ['cherry-pick', ...(await opcionMerge(repo, sha)), sha]);
}

async function revertir(repo, sha) {
  return modificar(repo, ['revert', '--no-edit', ...(await opcionMerge(repo, sha)), sha]);
}

// repo.tag() de la API toma el 2.º argumento como mensaje en unas versiones y como ref en otras
async function crearTag(repo, nombre, sha) {
  return modificar(repo, ['tag', nombre, sha]);
}

// «--» y una ruta que sale del propio commit: nada de opciones colándose
async function restaurarFichero(repo, sha, ruta) {
  return modificar(repo, ['checkout', sha, '--', ruta]);
}

const MODOS_RESET = ['soft', 'mixed', 'hard'];
async function resetear(repo, sha, modo) {
  if (!MODOS_RESET.includes(modo)) { throw new Error(`reset --${modo}`); }
  return modificar(repo, ['reset', `--${modo}`, sha]);
}

function webDe(repo) {
  const r = elegirRemoto(repo.state.remotes, repo.state.HEAD && repo.state.HEAD.upstream && repo.state.HEAD.upstream.remote);
  return r ? webDeRemoto(r.fetchUrl || r.pushUrl) : null;
}

function uriEnRevision(repo, ruta, ref) {
  const uri = vscode.Uri.joinPath(repo.rootUri, ruta);
  return ref ? api.toGitUri(uri, ref) : uri;
}

module.exports = {
  ALCANCES, obtenerApi, repoDe, rutaRelativa, resolverRef, blame, mensaje, historial, lineasDeFichero, ficherosDeCommit, grafo, refs, diferencias, webDe,
  uriEnRevision, cherryPick, revertir, resetear, crearTag, restaurarFichero, stashes, worktrees, usarStash, firmaDeRefs, dirComun, autores, commitsDeAutor, ErrorGit,
};
