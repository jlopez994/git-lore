'use strict';
// Vista «Contributors» en el panel de Source Control: quién ha hecho commits en la rama actual y cuáles.
const path = require('path');
const vscode = require('vscode');
const git = require('./git');
const { relativa, corto } = require('./acciones');
const { claveDePersona } = require('./nucleo/parseo');
const { gruposPorNombre, unirEnMailmap } = require('./nucleo/identidades');

const t = vscode.l10n.t;

class Contribuidores {
  constructor() {
    this.repo = null;
    this.alFallar = () => { };
    this.cambio = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.cambio.event;
  }

  // HEAD cambia al cambiar de rama, hacer commit o hacer pull, y al arrancar llega después de abrir el repo
  fijar(repo) {
    this.repo = repo;
    if (this.vigia) { this.vigia.dispose(); }
    const firma = () => repo && repo.state.HEAD && `${repo.state.HEAD.name}@${repo.state.HEAD.commit}`;
    let vista = firma();
    this.vigia = repo && repo.state.onDidChange(() => {
      if (firma() === vista) { return; }
      vista = firma();
      this.cambio.fire();
    });
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
      // mismo nombre y otro correo: seguramente la misma persona, se ofrece juntarlas de un clic
      item.contextValue = e.grupo ? 'autorDuplicado' : 'autor';
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
        const grupoDe = new Map(gruposPorNombre(personas).flatMap(g => g.map(p => [p, g])));
        return personas.map(persona => ({ persona, repetido: grupoDe.has(persona), grupo: grupoDe.get(persona) }));
      }
      if (!e.persona) { return []; }
      return (await git.commitsDeAutor(repo, e.persona)).map(c => ({ ...c, raiz }));
    } catch (err) {
      this.alFallar(err.message); // un error en getChildren dejaría la vista vacía sin decir por qué
      return [];
    }
  }
}

const clave = p => claveDePersona(p.correo, p.nombre);

// los commits de origenes pasan a destino. Se remapean las identidades escritas en los commits, no las que se ven:
// el mailmap no encadena, y lo que ya se había juntado con un origen tiene que seguirle
// uniones y deshacer leen y reescriben el mismo fichero: en cola por repo, o uno borraría lo del otro
const colas = new Map();
function enCola(repo, fn) {
  const raiz = repo.rootUri.fsPath;
  const hecha = (colas.get(raiz) || Promise.resolve()).then(fn);
  colas.set(raiz, hecha.catch(() => { }));
  return hecha;
}
const juntar = (repo, origenes, destino) => enCola(repo, () => juntarYa(repo, origenes, destino));

async function juntarYa(repo, origenes, destino) {
  // git ignora una entrada sin correo de destino: no juntaría nada
  if (!destino.correo) { throw new Error(t('{0} has no email: merge it the other way round', destino.nombre)); }
  const claves = new Set(origenes.map(clave));
  const crudas = (await git.identidades(repo)).filter(i => claves.has(i.clave));
  if (!crudas.length) { throw new Error(t('No commits found for {0}', origenes.map(p => p.nombre).join(', '))); }
  const antes = await git.leerMailmap(repo);
  const base = antes || `# ${t('Git Lore: identities merged in {0}. Same format as .mailmap (git help mailmap).', repo.rootUri.fsPath)}\n`;
  const escrito = unirEnMailmap(base, crudas, destino);
  await git.escribirMailmap(repo, escrito);
  // sin esperar al aviso: la cola no se queda parada en él
  avisarUnion(repo, origenes, destino, antes, escrito).catch(e => vscode.window.showErrorMessage(e.message));
}

async function avisarUnion(repo, origenes, destino, antes, escrito) {
  const deshacer = t('Undo');
  const r = await vscode.window.showInformationMessage(t('Merged {0} into {1}', origenes.map(p => p.nombre).join(', '), destino.nombre), deshacer);
  if (r !== deshacer) { return; }
  const hecho = await enCola(repo, async () => {
    // otra unión o una edición a mano mientras el aviso seguía abierto: deshacer las borraría
    if (await git.leerMailmap(repo) !== escrito) { return false; }
    await git.escribirMailmap(repo, antes);
    return true;
  });
  if (!hecho) { vscode.window.showWarningMessage(t('The merged identities changed since then: edit them to undo')); }
}

function registrar(context, protegido, log) {
  const proveedor = new Contribuidores();
  const vista = vscode.window.createTreeView('gitLore.contributors', { treeDataProvider: proveedor });
  proveedor.alFallar = mensaje => { vista.message = mensaje; };
  let api = null;
  // repo elegido a mano (su raíz): manda sobre el editor hasta que se vuelva a «seguir el editor». Por workspace
  const FIJADO = 'gitLore.contributors.repo';
  const fijado = () => {
    const raiz = context.workspaceState.get(FIJADO);
    return (raiz && api && api.repositories.find(r => r.rootUri.fsPath === raiz)) || null;
  };
  // el fijado; si no, el del editor activo; sin editor de un repo, el seleccionado en Source Control o el primero
  // forzar: el usuario acaba de elegir repo, aunque el editor activo sea el de las identidades
  const elegir = forzar => {
    if (!api) { return; }
    const ed = vscode.window.activeTextEditor;
    if (forzar !== true && ed && git.esMailmap(ed.document.uri.fsPath)) { return; } // está editando las identidades del repo de la vista
    const fijo = fijado();
    const repo = fijo || (ed && api.getRepository(ed.document.uri)) || api.repositories.find(r => r.ui && r.ui.selected)
      || api.repositories[0] || null;
    const nombre = repo ? path.basename(repo.rootUri.fsPath) : '';
    vista.description = fijo ? t('{0} (pinned)', nombre) : nombre;
    if (repo === proveedor.repo) { return; }
    proveedor.fijar(repo);
  };
  git.obtenerApi().then(a => {
    api = a;
    // sin editor de un repo manda el seleccionado en Source Control: hay que enterarse cuando cambia
    const selecciones = new Map();
    const vigilar = r => { if (!selecciones.has(r) && r.ui && r.ui.onDidChange) { selecciones.set(r, r.ui.onDidChange(() => elegir())); } };
    a.repositories.forEach(vigilar);
    context.subscriptions.push(
      a.onDidOpenRepository(r => { vigilar(r); elegir(); }),
      a.onDidCloseRepository(r => { const s = selecciones.get(r); if (s) { s.dispose(); selecciones.delete(r); } elegir(); }),
      { dispose: () => selecciones.forEach(s => s.dispose()) },
    );
    elegir();
  }, e => log(`contributors: ${e.message}`));
  context.subscriptions.push(
    vista,
    { dispose: () => proveedor.vigia && proveedor.vigia.dispose() },
    vscode.window.onDidChangeActiveTextEditor(elegir),
    vscode.commands.registerCommand('gitLore.refreshContributors', () => proveedor.cambio.fire()),
    vscode.commands.registerCommand('gitLore.contributorsRepository', () => protegido(async () => {
      if (!api || !api.repositories.length) { return vscode.window.showWarningMessage(t('No git repository is open')); }
      const fijo = fijado();
      const elegido = await vscode.window.showQuickPick([
        { label: `$(${fijo ? 'eye' : 'check'}) ${t('Follow the active editor')}`, repo: null },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        ...api.repositories.map(r => ({
          label: `$(${r === fijo ? 'pinned' : 'repo'}) ${path.basename(r.rootUri.fsPath)}`, description: r.rootUri.fsPath, repo: r,
        })),
      ], { placeHolder: t('Show contributors of…'), matchOnDescription: true });
      if (!elegido) { return; }
      await context.workspaceState.update(FIJADO, elegido.repo ? elegido.repo.rootUri.fsPath : undefined);
      elegir(true);
    })),
    git.onDidChangeMailmap(() => proveedor.cambio.fire()),
    vscode.commands.registerCommand('gitLore.mergeContributor', e => protegido(async () => {
      const repo = proveedor.repo;
      if (!repo || !e || !e.persona) { return; }
      const otras = (await git.autores(repo)).filter(p => p.correo && clave(p) !== clave(e.persona));
      if (!otras.length) { return vscode.window.showInformationMessage(t('There is no one else to merge with')); }
      const elegida = await vscode.window.showQuickPick(otras.map(p => ({
        label: p.nombre, description: p.correo, detail: p.commits === 1 ? t('1 commit') : t('{0} commits', p.commits), persona: p,
      })), { placeHolder: t('Merge {0} into…', e.persona.nombre), matchOnDescription: true });
      if (elegida) { await juntar(repo, [e.persona], elegida.persona); }
    })),
    // al de más commits: es el nombre y correo que más usa
    vscode.commands.registerCommand('gitLore.mergeSameName', e => protegido(async () => {
      if (!proveedor.repo || !e || !e.grupo) { return; }
      const destino = e.grupo.find(p => p.correo) || e.grupo[0];
      await juntar(proveedor.repo, e.grupo.filter(p => p !== destino), destino);
    })),
    // el mismo fichero es el deshacer de todo: se borra la línea y listo
    vscode.commands.registerCommand('gitLore.editMergedContributors', () => protegido(async () => {
      const repo = proveedor.repo;
      if (!repo) { return vscode.window.showWarningMessage(t('No git repository is open')); }
      if (!(await git.leerMailmap(repo))) {
        await git.escribirMailmap(repo, `# ${t('Git Lore: identities merged in {0}. Same format as .mailmap (git help mailmap).', repo.rootUri.fsPath)}\n`);
      }
      await vscode.window.showTextDocument(vscode.Uri.file(git.rutaMailmap(repo)));
    })),
    vscode.workspace.onDidSaveTextDocument(d => {
      const r = api && git.esMailmap(d.uri.fsPath) && api.repositories.find(x => git.rutaMailmap(x) === d.uri.fsPath);
      if (r) { git.avisarMailmap(r.rootUri.fsPath); }
    }),
  );
}

module.exports = { registrar };
