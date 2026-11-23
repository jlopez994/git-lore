'use strict';
// Vista «Compare»: ficheros que cambian entre dos refs (o una ref y el árbol de trabajo).
const path = require('path');
const vscode = require('vscode');
const git = require('./git');
const { ICONO_ESTADO, elegirRepo } = require('./acciones');

const t = vscode.l10n.t;
const ICONO_REF = { rama: 'git-branch', remota: 'cloud', tag: 'tag' };

async function elegirRef(repo, titulo, { conArbol }) {
  const refs = await git.refs(repo);
  const items = [
    ...(conArbol ? [{ label: `$(file-directory) ${t('Working Tree')}`, ref: undefined, arbol: true }] : []),
    { label: '$(target) HEAD', ref: 'HEAD' },
    ...refs.map(r => ({ label: `$(${ICONO_REF[r.tipo]}) ${r.nombre}`, ref: r.nombre })),
  ];
  // createQuickPick en vez de showQuickPick para poder escribir un SHA que no está en la lista
  return new Promise(resolver => {
    const qp = vscode.window.createQuickPick();
    qp.title = titulo;
    qp.placeholder = t('Branch, tag or commit SHA');
    qp.items = items;
    qp.onDidAccept(() => {
      const escrito = qp.value.trim();
      resolver(qp.selectedItems[0] || (escrito ? { ref: escrito } : undefined));
      qp.hide();
    });
    qp.onDidHide(() => { resolver(undefined); qp.dispose(); });
    qp.show();
  });
}

class Comparacion {
  constructor() {
    this.estado = null; // { repo, a, b, ficheros }
    this.cambio = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.cambio.event;
  }

  getTreeItem(f) {
    const { repo } = this.estado;
    const item = new vscode.TreeItem(path.posix.basename(f.ruta));
    item.resourceUri = vscode.Uri.joinPath(repo.rootUri, f.ruta);
    item.description = f.rutaAnterior ? `${f.rutaAnterior} →` : path.posix.dirname(f.ruta).replace(/^\.$/, '');
    item.iconPath = new vscode.ThemeIcon(ICONO_ESTADO[f.estado] || 'file');
    item.command = { command: 'gitLore.openComparedFile', title: t('Open changes'), arguments: [f] };
    return item;
  }

  getChildren(padre) {
    return padre || !this.estado ? [] : this.estado.ficheros;
  }

  abrir(f) {
    const { repo, a, b, shaA, shaB } = this.estado;
    const nombre = path.posix.basename(f.ruta);
    const derecha = git.uriEnRevision(repo, f.ruta, shaB);
    const izquierda = git.uriEnRevision(repo, f.rutaAnterior || f.ruta, shaA);
    if (f.estado === 'A') { return vscode.commands.executeCommand('vscode.open', derecha); }
    if (f.estado === 'D') { return vscode.commands.executeCommand('vscode.open', izquierda); }
    return vscode.commands.executeCommand('vscode.diff', izquierda, derecha, `${nombre} (${a} ↔ ${b || t('Working Tree')})`);
  }
}

function registrar(context, protegido) {
  const proveedor = new Comparacion();
  const vista = vscode.window.createTreeView('gitLore.compare', { treeDataProvider: proveedor });

  // a y b son nombres para enseñar; git solo recibe los SHAs resueltos
  async function comparar(repo, a, b) {
    const shaA = await git.resolverRef(repo, a);
    const shaB = b && await git.resolverRef(repo, b);
    const ficheros = await git.diferencias(repo, shaA, shaB);
    proveedor.estado = { repo, a, b, shaA, shaB, ficheros };
    proveedor.cambio.fire();
    vista.description = `${a} ↔ ${b || t('Working Tree')}`;
    vista.message = ficheros.length ? undefined : t('No differences.');
    vscode.commands.executeCommand('setContext', 'gitLore.comparing', true);
    await vscode.commands.executeCommand('gitLore.compare.focus');
  }

  context.subscriptions.push(
    vista,
    vscode.commands.registerCommand('gitLore.compareRefs', arg => protegido(async () => {
      // desde la barra de Source Control llega el SourceControl de ese repo
      const repo = (arg && arg.rootUri && (await git.obtenerApi()).getRepository(arg.rootUri)) || await elegirRepo();
      if (!repo) { return vscode.window.showWarningMessage(t('No git repository is open')); }
      const a = await elegirRef(repo, t('Compare: base'), { conArbol: false });
      if (!a) { return; }
      const b = await elegirRef(repo, t('Compare {0} with…', a.ref), { conArbol: true });
      if (!b) { return; }
      await comparar(repo, a.ref, b.ref);
    })),
    vscode.commands.registerCommand('gitLore.swapCompare', () => protegido(async () => {
      const e = proveedor.estado;
      if (e && e.b) { await comparar(e.repo, e.b, e.a); }
    })),
    vscode.commands.registerCommand('gitLore.openComparedFile', f => protegido(() => proveedor.abrir(f))),
  );
}

module.exports = { registrar };
