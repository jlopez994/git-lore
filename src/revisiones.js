'use strict';
// Recorrer las revisiones de un fichero desde la barra del editor: ← abre el commit anterior, → el siguiente.
const path = require('path');
const vscode = require('vscode');
const git = require('./git');
const { cambiosDe } = require('./nucleo/historia');
const { abrirCambios } = require('./acciones');

const t = vscode.l10n.t;
const LIMITE = 1000;
const SHA = /^[0-9a-f]{40,64}$/;
// el último historial recorrido: un diff de antes de un renombrado apunta a la ruta vieja, que ya no tiene historial
let ultimo = null;

// el lado derecho del diff activo, o el fichero abierto
function enFoco() {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = tab && tab.input;
  if (input instanceof vscode.TabInputTextDiff) { return input.modified; }
  if (input instanceof vscode.TabInputText) { return input.uri; }
  return vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri;
}

// uri git: de vscode.git → fichero y commit; un fichero normal es el árbol de trabajo (sin commit)
function destino(uri) {
  if (!uri) { return null; }
  if (uri.scheme === 'file') { return { fichero: uri, sha: null }; }
  if (uri.scheme !== 'git') { return null; }
  try {
    const q = JSON.parse(uri.query);
    return { fichero: vscode.Uri.file(q.path), sha: SHA.test(q.ref || '') ? q.ref : null };
  } catch {
    return null;
  }
}

async function historialDe(repo, fichero, sha) {
  if (sha && ultimo && ultimo.raiz === repo.rootUri.fsPath && ultimo.commits.some(c => c.sha === sha)) { return ultimo; }
  const commits = await git.historial(repo, fichero, { limite: LIMITE });
  ultimo = { raiz: repo.rootUri.fsPath, fichero, commits, cambios: cambiosDe(commits, git.rutaRelativa(repo, fichero)) };
  return ultimo;
}

// paso +1 = más viejo, -1 = más nuevo; la posición -1 es el árbol de trabajo
async function navegar(arg, paso) {
  const d = destino(arg instanceof vscode.Uri ? arg : enFoco());
  if (!d) { return vscode.window.showWarningMessage(t('Open a file in a git repository first')); }
  const repo = await git.repoDe(d.fichero);
  if (!repo) { return vscode.window.showWarningMessage(t('Open a file in a git repository first')); }
  const h = await historialDe(repo, d.fichero, d.sha);
  const i = d.sha ? h.commits.findIndex(c => c.sha === d.sha) : -1;
  const j = i + paso;
  if (j < -1) { return; }
  if (j === -1) { return vscode.commands.executeCommand('vscode.open', h.fichero); }
  if (j >= h.commits.length) {
    return vscode.window.setStatusBarMessage(t('{0} has no older revisions', path.basename(h.fichero.fsPath)), 3000);
  }
  return abrirCambios(repo, h.cambios.get(h.commits[j].sha));
}

function registrar(context, protegido) {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitLore.previousRevision', arg => protegido(() => navegar(arg, 1))),
    vscode.commands.registerCommand('gitLore.nextRevision', arg => protegido(() => navegar(arg, -1))),
  );
}

module.exports = { registrar };
