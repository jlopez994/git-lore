'use strict';
// Vista «File History» en el panel de Source Control: commits del fichero activo o de las líneas elegidas.
const path = require('path');
const vscode = require('vscode');
const git = require('./git');
const { relativa, corto } = require('./acciones');

const t = vscode.l10n.t;

class Historial {
  constructor(log) {
    this.log = log;
    this.objetivo = null; // { uri, desde?, hasta? }
    this.alFallar = () => { };
    this.cambio = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.cambio.event;
  }

  fijar(objetivo) {
    this.objetivo = objetivo;
    this.cambio.fire();
  }

  getTreeItem(c) {
    const item = new vscode.TreeItem(c.resumen || corto(c.sha));
    item.description = `${c.autor}, ${relativa(c.fecha)}`;
    item.iconPath = new vscode.ThemeIcon('git-commit');
    item.contextValue = 'commit';
    const tip = new vscode.MarkdownString();
    tip.appendMarkdown(`\`${corto(c.sha)}\` · `);
    tip.appendText(`${c.autor} <${c.correo}> · ${new Date(c.fecha).toLocaleString(vscode.env.language)}\n\n${c.resumen}`);
    item.tooltip = tip;
    item.command = { command: 'gitLore.openChanges', title: t('Open changes'), arguments: [c.cambios] };
    return item;
  }

  async getChildren(padre) {
    if (padre || !this.objetivo) { return []; }
    const { uri, desde, hasta } = this.objetivo;
    this.alFallar(undefined);
    const repo = await git.repoDe(uri);
    if (!repo) { return []; }
    const raiz = repo.rootUri.fsPath;
    const rutaActual = git.rutaRelativa(repo, uri);
    try {
      const commits = await git.historial(repo, uri, { desde, hasta });
      return commits.map(c => {
        // con --follow cada commit trae la ruta que tenía entonces el fichero
        // shortcut: -L va con -s y no la trae; antes de un renombrado el diff abre la ruta actual
        const f = c.ficheros[0] || { ruta: rutaActual };
        return {
          ...c,
          raiz,
          cambios: {
            raiz, sha: c.sha, ruta: f.ruta, rutaAnterior: f.rutaAnterior, estado: f.estado,
            refAnterior: c.padres.length ? undefined : null,
          },
        };
      });
    } catch (e) {
      this.log(`history ${uri.fsPath}: ${e.message}`);
      this.alFallar(e.message);
      return [];
    }
  }
}

function registrar(context, log) {
  const proveedor = new Historial(log);
  const vista = vscode.window.createTreeView('gitLore.history', { treeDataProvider: proveedor });
  proveedor.alFallar = mensaje => { if (proveedor.objetivo) { vista.message = mensaje; } };

  const describir = () => {
    const o = proveedor.objetivo;
    vista.description = !o ? '' : path.basename(o.uri.fsPath) + (o.desde ? `:${o.desde}–${o.hasta}` : '');
    vista.message = o ? undefined : t('Open a file tracked by git to see its history.');
  };
  const seguirEditor = editor => {
    if (!editor || editor.document.uri.scheme !== 'file') { return; }
    const o = proveedor.objetivo;
    if (o && o.uri.toString() === editor.document.uri.toString()) { return; }
    proveedor.fijar({ uri: editor.document.uri });
    describir();
  };

  context.subscriptions.push(
    vista,
    vscode.window.onDidChangeActiveTextEditor(seguirEditor),
    vscode.commands.registerCommand('gitLore.fileHistory', async uri => {
      const destino = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri;
      if (!destino) { return; }
      proveedor.fijar({ uri: destino });
      describir();
      await vscode.commands.executeCommand('gitLore.history.focus');
    }),
    // shortcut: git log -L numera sobre HEAD; con cambios sin guardar o sin commit el rango puede no cuadrar
    // desde el hover llega { linea }; desde el menú, la selección
    vscode.commands.registerCommand('gitLore.lineHistory', async arg => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const s = editor.selection;
      const [desde, hasta] = arg && Number.isInteger(arg.linea)
        ? [arg.linea + 1, arg.linea + 1]
        : [s.start.line + 1, s.end.line > s.start.line && s.end.character === 0 ? s.end.line : s.end.line + 1];
      proveedor.fijar({ uri: editor.document.uri, desde, hasta });
      describir();
      await vscode.commands.executeCommand('gitLore.history.focus');
    }),
    vscode.commands.registerCommand('gitLore.refreshHistory', () => proveedor.cambio.fire()),
  );
  seguirEditor(vscode.window.activeTextEditor);
  describir();
}

module.exports = { registrar };
