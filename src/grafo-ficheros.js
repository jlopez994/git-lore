'use strict';
// Menú contextual de un fichero en el detalle de un commit del grafo: diff, revisión, fichero actual, rutas y restaurar.
const path = require('path');
const vscode = require('vscode');
const git = require('./git');
const { abrirCambios, corto } = require('./acciones');
const { shaDe, confirmar } = require('./grafo-acciones');

const t = vscode.l10n.t;

// el webview manda un índice, no una ruta: el fichero se vuelve a sacar del commit
async function ficheroDe(repo, sha, indice) {
  const commit = await git.ficherosDeCommit(repo, sha);
  const f = commit && Number.isInteger(indice) && commit.ficheros[indice];
  if (!f) { throw new Error(t('File not found in commit {0}', corto(sha))); }
  return { commit, f };
}

function abrirFichero(repo, sha, indice) {
  return ficheroDe(repo, sha, indice).then(({ commit, f }) =>
    abrirCambios(repo, { sha, ...f, refAnterior: commit.padres.length ? undefined : null }));
}

async function enDisco(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    vscode.window.showWarningMessage(t('{0} no longer exists in the working tree', path.posix.basename(uri.path)));
    return false;
  }
}

// un fichero borrado en el commit solo existe en el padre
const revisionDe = (sha, f) => (f.estado === 'D' ? `${sha}^` : sha);

const ACCIONES = {
  openDiff: (repo, sha, indice) => abrirFichero(repo, sha, indice),

  async openRevision(repo, sha, { f }) {
    const ref = revisionDe(sha, f);
    return vscode.commands.executeCommand('vscode.open', git.uriEnRevision(repo, f.ruta, ref), {},
      `${path.posix.basename(f.ruta)} (${corto(sha)}${f.estado === 'D' ? '^' : ''})`);
  },

  async compareWorking(repo, sha, { f }) {
    const actual = git.uriEnRevision(repo, f.ruta);
    if (!await enDisco(actual)) { return; }
    const nombre = path.posix.basename(f.ruta);
    return vscode.commands.executeCommand('vscode.diff', git.uriEnRevision(repo, f.ruta, revisionDe(sha, f)), actual,
      `${nombre} (${corto(sha)} ↔ ${t('working tree')})`);
  },

  async openFile(repo, sha, { f }) {
    const actual = git.uriEnRevision(repo, f.ruta);
    if (await enDisco(actual)) { return vscode.commands.executeCommand('vscode.open', actual); }
  },

  copyPath: (repo, sha, { f }) => vscode.env.clipboard.writeText(path.join(repo.rootUri.fsPath, ...f.ruta.split('/'))),
  copyRelativePath: (repo, sha, { f }) => vscode.env.clipboard.writeText(f.ruta),

  async restoreFile(repo, sha, { f }) {
    if (!await confirmar(t('Restore {0} to its version in {1}?', f.ruta, corto(sha)),
      t('Uncommitted changes to this file are lost.'), t('Restore'))) { return; }
    return git.restaurarFichero(repo, sha, f.ruta);
  },
};

function registrar(context, protegido, vistaDe) {
  for (const [nombre, accion] of Object.entries(ACCIONES)) {
    context.subscriptions.push(vscode.commands.registerCommand(`gitLore.graph.${nombre}`, arg => protegido(async () => {
      const vista = arg && vistaDe(arg.panel);
      if (!vista) { throw new Error(t('The Commit Graph is no longer open')); }
      const sha = shaDe(arg);
      // no recarga el grafo: restaurar cambia el árbol de trabajo y eso ya lo vigila la vista
      return accion(vista.repo, sha, nombre === 'openDiff' ? arg.indice : await ficheroDe(vista.repo, sha, arg.indice));
    })));
  }
}

module.exports = { registrar, abrirFichero };
