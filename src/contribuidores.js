'use strict';
// Vista «Contributors» en el panel de Source Control: quién ha hecho commits en la rama actual y cuáles.
const path = require('path');
const vscode = require('vscode');
const git = require('./git');
const { relativa, corto } = require('./acciones');

const t = vscode.l10n.t;

class Contribuidores {
  constructor() {
    this.repo = null;
    this.alFallar = () => { };
    this.cambio = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.cambio.event;
  }

  fijar(repo) {
    this.repo = repo;
    this.cambio.fire();
  }

  getTreeItem(e) {
    // «persona» y no «autor»: los commits ya traen un campo autor (texto)
    if (e.persona) {
      const a = e.persona;
      const item = new vscode.TreeItem(a.nombre, vscode.TreeItemCollapsibleState.Collapsed);
      // dos personas con el mismo nombre (o una con dos correos) solo se distinguen por el correo
      const n = a.commits === 1 ? t('1 commit') : t('{0} commits', a.commits);
      item.description = e.repetido ? `${n} · ${a.correo}` : n;
      item.tooltip = `${a.nombre} <${a.correo}>`;
      item.iconPath = new vscode.ThemeIcon('person');
      item.contextValue = 'autor';
      return item;
    }
    const c = e;
    const item = new vscode.TreeItem(c.resumen || corto(c.sha));
    item.description = relativa(c.fecha);
    item.iconPath = new vscode.ThemeIcon('git-commit');
    item.contextValue = 'commit'; // los mismos menús que en File History: ficheros, copiar SHA, abrir en remoto
    const tip = new vscode.MarkdownString();
    tip.appendMarkdown(`\`${corto(c.sha)}\` · `);
    tip.appendText(`${new Date(c.fecha).toLocaleString(vscode.env.language)}\n\n${c.resumen}`);
    item.tooltip = tip;
    item.command = { command: 'gitLore.showCommit', title: t('Show Commit Files'), arguments: [c] };
    return item;
  }

  async getChildren(e) {
    const repo = this.repo;
    if (!repo) { return []; }
    const raiz = repo.rootUri.fsPath;
    try {
      if (!e) {
        this.alFallar(undefined);
        const personas = await git.autores(repo);
        const veces = new Map();
        personas.forEach(p => veces.set(p.nombre, (veces.get(p.nombre) || 0) + 1));
        return personas.map(persona => ({ persona, repetido: veces.get(persona.nombre) > 1 }));
      }
      if (!e.persona) { return []; }
      return (await git.commitsDeAutor(repo, e.persona)).map(c => ({ ...c, raiz }));
    } catch (err) {
      this.alFallar(err.message); // un error en getChildren dejaría la vista vacía sin decir por qué
      return [];
    }
  }
}

function registrar(context, log) {
  const proveedor = new Contribuidores();
  const vista = vscode.window.createTreeView('gitLore.contributors', { treeDataProvider: proveedor });
  proveedor.alFallar = mensaje => { vista.message = mensaje; };
  let api = null;
  // el repo del editor activo; sin editor de un repo, el primero que haya
  const elegir = () => {
    if (!api) { return; }
    const ed = vscode.window.activeTextEditor;
    const repo = (ed && api.getRepository(ed.document.uri)) || api.repositories[0] || null;
    if (repo === proveedor.repo) { return; }
    proveedor.fijar(repo);
    vista.description = repo ? path.basename(repo.rootUri.fsPath) : '';
  };
  git.obtenerApi().then(a => {
    api = a;
    context.subscriptions.push(a.onDidOpenRepository(elegir), a.onDidCloseRepository(elegir));
    elegir();
  }, e => log(`contributors: ${e.message}`));
  context.subscriptions.push(
    vista,
    vscode.window.onDidChangeActiveTextEditor(elegir),
    vscode.commands.registerCommand('gitLore.refreshContributors', () => proveedor.cambio.fire()),
  );
}

module.exports = { registrar };
