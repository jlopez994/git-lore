'use strict';
// Acciones sobre un commit que comparten el hover, el historial, el grafo y la comparación.
const path = require('path');
const vscode = require('vscode');
const git = require('./git');
const { urlDeCommit, nombreDeRemoto } = require('./nucleo/remotos');
const { fechaRelativa } = require('./nucleo/tiempo');

const t = vscode.l10n.t;
const corto = sha => sha.slice(0, 7);
const ICONO_ESTADO = { A: 'diff-added', D: 'diff-removed', R: 'diff-renamed', C: 'diff-renamed', M: 'diff-modified' };

function relativa(ms) {
  return fechaRelativa(ms, Date.now(), vscode.env.language);
}

async function repoPorRaiz(raiz) {
  const repo = (await git.obtenerApi()).getRepository(vscode.Uri.file(raiz));
  if (!repo) { throw new Error(t('Repository not found: {0}', raiz)); }
  return repo;
}

// Diff de un fichero en un commit frente a su padre; sin padre o recién creado se abre tal cual
async function abrirCambios(repo, { sha, ruta, rutaAnterior, refAnterior, estado }) {
  const nombre = path.posix.basename(ruta);
  if (estado === 'D') {
    return vscode.commands.executeCommand('vscode.open', git.uriEnRevision(repo, ruta, `${sha}^`));
  }
  const izquierda = refAnterior === null || estado === 'A' ? null : (refAnterior || `${sha}^`);
  const derecha = git.uriEnRevision(repo, ruta, sha);
  if (!izquierda) {
    return vscode.commands.executeCommand('vscode.open', derecha, {}, `${nombre} (${corto(sha)})`);
  }
  return vscode.commands.executeCommand('vscode.diff',
    git.uriEnRevision(repo, rutaAnterior || ruta, izquierda), derecha,
    `${nombre} (${refAnterior ? corto(refAnterior) : `${corto(sha)}^`} ↔ ${corto(sha)})`);
}

async function copiarSha(sha) {
  await vscode.env.clipboard.writeText(sha);
  vscode.window.setStatusBarMessage(t('Copied {0}', corto(sha)), 2000);
}

async function abrirEnRemoto(repo, sha) {
  const url = urlDeCommit(git.webDe(repo), sha);
  if (!url) { return vscode.window.showWarningMessage(t('This repository has no web remote')); }
  return vscode.env.openExternal(vscode.Uri.parse(url));
}

async function elegirRepo() {
  const api = await git.obtenerApi();
  const editor = vscode.window.activeTextEditor;
  const delEditor = editor && api.getRepository(editor.document.uri);
  if (delEditor) { return delEditor; }
  if (api.repositories.length <= 1) { return api.repositories[0]; }
  const elegido = await vscode.window.showQuickPick(
    api.repositories.map(r => ({ label: path.basename(r.rootUri.fsPath), description: r.rootUri.fsPath, repo: r })),
    { placeHolder: t('Repository') });
  return elegido && elegido.repo;
}

// Ficheros del commit en un QuickPick, con copiar y abrir en remoto arriba
async function mostrarCommit(repo, sha) {
  const commit = await git.ficherosDeCommit(repo, sha);
  if (!commit) { return; }
  const web = git.webDe(repo);
  const items = [
    { label: `$(copy) ${t('Copy SHA')}`, accion: () => copiarSha(sha) },
    ...(web ? [{ label: `$(globe) ${t('Open on {0}', nombreDeRemoto(web) || t('remote'))}`, accion: () => abrirEnRemoto(repo, sha) }] : []),
    { label: t('Files'), kind: vscode.QuickPickItemKind.Separator },
    ...commit.ficheros.map(f => ({
      label: `$(${ICONO_ESTADO[f.estado] || 'file'}) ${path.posix.basename(f.ruta)}`,
      description: f.rutaAnterior ? `${f.rutaAnterior} → ${f.ruta}` : path.posix.dirname(f.ruta).replace(/^\.$/, ''),
      accion: () => abrirCambios(repo, {
        sha, ruta: f.ruta, rutaAnterior: f.rutaAnterior, estado: f.estado,
        refAnterior: commit.padres.length ? undefined : null,
      }),
    })),
  ];
  const elegido = await vscode.window.showQuickPick(items, {
    title: `${corto(sha)} · ${commit.resumen}`,
    placeHolder: `${commit.autor}, ${relativa(commit.fecha)}`,
    matchOnDescription: true,
  });
  return elegido && elegido.accion();
}

module.exports = { elegirRepo, abrirCambios, copiarSha, abrirEnRemoto, mostrarCommit, repoPorRaiz, relativa, corto, ICONO_ESTADO };
