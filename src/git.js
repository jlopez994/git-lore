'use strict';
// Puerta única a git: la API de la extensión vscode.git y el binario que ella usa.
const cp = require('child_process');
const path = require('path');
const vscode = require('vscode');
const { parsearBlame, parsearLog, parsearDiff, FORMATO_LOG } = require('./nucleo/parseo');
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

function ejecutar(cwd, args, { entrada, token } = {}) {
  return new Promise((resolver, rechazar) => {
    const proc = cp.spawn(api.git.path, ['-c', 'core.quotePath=false', ...args], {
      cwd,
      windowsHide: true,
      // solo lectura: que diff/status no tomen el lock del índice y choquen con los comandos del usuario
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
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

async function grafo(repo, { saltar = 0, limite = 300, alcance = 'todas' } = {}) {
  // repo recién creado: «git log HEAD» fallaría con «unknown revision»
  if (!repo.state.HEAD || !repo.state.HEAD.commit) { return []; }
  const args = ['log', ...ALCANCES[alcance], '--date-order', `--skip=${saltar}`, `-n${limite}`, `--format=${FORMATO_LOG}`];
  return parsearLog(await ejecutar(repo.rootUri.fsPath, args));
}

async function refs(repo) {
  const salida = await ejecutar(repo.rootUri.fsPath,
    ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%1f%(refname:short)', 'refs/heads', 'refs/remotes', 'refs/tags']);
  return salida.split('\n').filter(Boolean).map(l => {
    const [completo, nombre] = l.split('\x1f');
    const tipo = completo.startsWith('refs/heads/') ? 'rama' : completo.startsWith('refs/tags/') ? 'tag' : 'remota';
    return { nombre, tipo };
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

// recibe SHAs ya resueltos; hasta undefined = árbol de trabajo
async function diferencias(repo, desde, hasta) {
  const args = ['diff', '--name-status', '-M', desde, ...(hasta ? [hasta] : []), '--'];
  return parsearDiff(await ejecutar(repo.rootUri.fsPath, args));
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
  ALCANCES, obtenerApi, repoDe, rutaRelativa, resolverRef, blame, mensaje, historial, ficherosDeCommit, grafo, refs, diferencias, webDe,
  uriEnRevision, ErrorGit,
};
