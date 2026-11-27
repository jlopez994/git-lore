'use strict';
// Vista «Contributors» en el panel de Source Control: quién ha hecho commits en la rama actual y cuáles.
const path = require('path');
const vscode = require('vscode');
const git = require('./git');
const { relativa, corto } = require('./acciones');
const { claveDePersona } = require('./nucleo/parseo');
const { gruposPorNombre, unirEnMailmap, sugerencias, agrupar } = require('./nucleo/identidades');
const reparto = require('./reparto-vista');

const t = vscode.l10n.t;

class Contribuidores {
  constructor() {
    this.repo = null;
    this.alFallar = () => { };
    this.alSugerir = () => { };
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
        this.alSugerir(sugerencias(personas).filter(s => s.fuerte).length); // las dudosas no se anuncian
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
// uniones: [{ origenes, destino }], disjuntas. Todas en una escritura, con un solo aviso y un solo deshacer
const juntarVarias = (repo, uniones) => enCola(repo, () => juntarYa(repo, uniones));
const juntar = (repo, origenes, destino) => juntarVarias(repo, [{ origenes, destino }]);
// con el correo: dos «Ana» juntadas no se distinguirían en el aviso
const etiqueta = p => (p.correo ? `${p.nombre} <${p.correo}>` : p.nombre);

async function juntarYa(repo, uniones) {
  // git ignora una entrada sin correo de destino: no juntaría nada
  const sinCorreo = uniones.find(u => !u.destino.correo);
  if (sinCorreo) { throw new Error(t('{0} has no email: merge it the other way round', sinCorreo.destino.nombre)); }
  const todas = await git.identidades(repo);
  const antes = await git.leerMailmap(repo);
  let escrito = antes || `# ${t('Git Lore: identities merged in {0}. Same format as .mailmap (git help mailmap).', repo.rootUri.fsPath)}\n`;
  for (const { origenes, destino } of uniones) {
    const claves = new Set(origenes.map(clave));
    const crudas = todas.filter(i => claves.has(i.clave));
    if (!crudas.length) { throw new Error(t('No commits found for {0}', origenes.map(p => p.nombre).join(', '))); }
    escrito = unirEnMailmap(escrito, crudas, destino);
  }
  await git.escribirMailmap(repo, escrito);
  const texto = uniones.length === 1
    ? t('Merged {0} into {1}', uniones[0].origenes.map(etiqueta).join(', '), etiqueta(uniones[0].destino))
    : t('Merged {0} groups of identities', uniones.length);
  // sin esperar al aviso: la cola no se queda parada en él
  avisarUnion(repo, texto, antes, escrito).catch(e => vscode.window.showErrorMessage(e.message));
}

async function avisarUnion(repo, texto, antes, escrito) {
  const deshacer = t('Undo');
  const r = await vscode.window.showInformationMessage(texto, deshacer);
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
  proveedor.alSugerir = n => {
    vista.message = n ? (n === 1 ? t('1 possible duplicate: review it with the lightbulb') : t('{0} possible duplicates: review them with the lightbulb', n)) : undefined;
  };
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
      // desde la vista llega el elemento del árbol; desde el gráfico, el data-vscode-context de la burbuja o la fila
      const delGrafico = e && e.webviewSection === 'persona';
      const repo = delGrafico ? reparto.repoDePanel(e.panel) : proveedor.repo;
      const persona = delGrafico
        ? (typeof e.nombre === 'string' && { nombre: e.nombre, correo: typeof e.correo === 'string' ? e.correo : '' })
        : e && e.persona;
      if (!repo || !persona) { return; }
      const otras = (await git.autores(repo)).filter(p => p.correo && clave(p) !== clave(persona));
      if (!otras.length) { return vscode.window.showInformationMessage(t('There is no one else to merge with')); }
      const elegida = await vscode.window.showQuickPick(otras.map(p => ({
        label: p.nombre, description: p.correo, detail: p.commits === 1 ? t('1 commit') : t('{0} commits', p.commits), persona: p,
      })), { placeHolder: t('Merge {0} into…', persona.nombre), matchOnDescription: true });
      if (elegida) { await juntar(repo, [persona], elegida.persona); }
    })),
    vscode.commands.registerCommand('gitLore.suggestMerges', () => protegido(async () => {
      const repo = proveedor.repo;
      if (!repo) { return vscode.window.showWarningMessage(t('No git repository is open')); }
      const pares = sugerencias(await git.autores(repo));
      if (!pares.length) { return vscode.window.showInformationMessage(t('No likely duplicates found')); }
      const motivos = { nombre: t('Same name'), usuario: t('Same user in the email or login'), parecido: t('Similar name') };
      // las dudosas («Iker M» y «Iker Martínez») salen sin marcar: se juntan solo si se eligen
      // la flecha apunta a quien se queda los commits al final: A~B y B~C acaban todos en el destino del grupo
      const final = new Map(agrupar(pares).flatMap(u => [u.destino, ...u.origenes].map(p => [p, u.destino])));
      const elegidas = await vscode.window.showQuickPick(pares.map(s => {
        const destino = final.get(s.origen);
        const van = [s.origen, s.destino].filter(p => p !== destino);
        return {
          label: `${van.map(p => p.nombre).join(' + ')} → ${destino.nombre}`,
          description: `${van.map(p => p.correo || '<>').join(' + ')} → ${destino.correo}`,
          detail: motivos[s.motivo],
          picked: s.fuerte,
          par: s,
        };
      }), { canPickMany: true, matchOnDescription: true, placeHolder: t('Merges to apply: the arrow points to who keeps the commits') });
      if (elegidas && elegidas.length) { await juntarVarias(repo, agrupar(elegidas.map(x => x.par))); }
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
