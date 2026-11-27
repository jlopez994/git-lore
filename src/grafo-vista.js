'use strict';
// Commit Graph en un webview: todas las ramas, por páginas, sin límite de repos privados.
const crypto = require('crypto');
const path = require('path');
const vscode = require('vscode');
const git = require('./git');
const { trazarGrafo, intercalarStashes } = require('./nucleo/grafo');
const { clasificarRef } = require('./nucleo/refs');
const grafoAcciones = require('./grafo-acciones');
const grafoFicheros = require('./grafo-ficheros');
const { nombreDeRemoto } = require('./nucleo/remotos');
const { elegirRepo, copiarSha, abrirEnRemoto, relativa } = require('./acciones');

const t = vscode.l10n.t;
const PAGINA = 300;
const MAX_RECARGA = 3 * PAGINA; // tras una acción no se vuelve a pedir todo lo que se haya cargado con scroll
const SHA = /^[0-9a-f]{40,64}$/;
const RESALTAR = 'graph.highlightCurrentBranch';
const resaltarAhora = () => vscode.workspace.getConfiguration('gitLore').get(RESALTAR, false) === true;
// no es hexadecimal: nunca pasa por SHA ni llega a git
const PENDIENTES = 'pendientes';
const paneles = new Map(); // raíz → panel
const vistas = new Map(); // id opaco del panel → { repo, recargar }: el menú contextual dice de qué panel viene

function html(webview, raizExt, nonce, id, resaltar) {
  const recurso = f => webview.asWebviewUri(vscode.Uri.joinPath(raizExt, 'media', f));
  const textos = {
    copiado: t('Copied'), sinCommits: t('No commits'), copiar: t('Copy SHA'), ficheros: t('Files'), padres: t('Parents'),
    verCambios: t('Show in Source Control'), irAqui: t('Go to the current commit'), enWorktree: t('Checked out in worktree {0}'),
  };
  return `<!doctype html>
<html lang="${vscode.env.language}" data-vscode-context='{"preventDefaultContextMenuItems": true}'>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${recurso('grafo.css')}">
</head>
<body>
<header class="barra">
  <input id="buscar" type="search" data-vscode-context='{"preventDefaultContextMenuItems": false}' placeholder="${t('Filter by message, author, ref or SHA')}" aria-label="${t('Filter commits')}">
  <select id="alcance" aria-label="${t('Branches to show')}">
    <option value="todas">${t('All branches')}</option>
    <option value="locales">${t('Local branches')}</option>
    <option value="actual">${t('Current branch')}</option>
  </select>
  <span id="cuenta" class="cuenta" aria-live="polite"></span>
  <button id="resaltar" class="boton" aria-pressed="${resaltar}" title="${t('Highlight the history of the current branch')}" aria-label="${t('Highlight the history of the current branch')}"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg></button>
  <button id="fetch" class="boton" title="${t('Fetch from all remotes')}" aria-label="${t('Fetch from all remotes')}"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1v9m-4-4 4 4 4-4M2 14h12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  <button id="refrescar" class="boton" title="${t('Refresh')}" aria-label="${t('Refresh')}"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
</header>
<main id="lista" class="lista" role="list"></main>
<div id="fin" class="fin" aria-hidden="true"></div>
<button id="aqui" class="aqui" hidden></button>
<div id="tirador" class="tirador" role="separator" aria-orientation="vertical" tabindex="0" aria-valuemin="24"
  aria-label="${t('Graph width')}" title="${t('Drag to resize the graph, double-click to reset')}"></div>
<script nonce="${nonce}">window.TEXTOS = ${JSON.stringify(textos)}; window.PANEL = ${JSON.stringify(id)}; window.RESALTAR = ${resaltar};</script>
<script nonce="${nonce}" src="${recurso('filas.js')}"></script>
<script nonce="${nonce}" src="${recurso('grafo.js')}"></script>
</body>
</html>`;
}

// un fichero en índice y árbol de trabajo cuenta una vez
function pendientes(repo) {
  const s = repo.state;
  const todos = [s.indexChanges, s.workingTreeChanges, s.mergeChanges, s.untrackedChanges].flatMap(l => l || []);
  return new Set(todos.map(c => c.uri.fsPath)).size;
}

async function detalle(repo, sha) {
  const [c, cuerpo] = await Promise.all([git.ficherosDeCommit(repo, sha), git.mensaje(repo, sha)]);
  const web = git.webDe(repo);
  return {
    sha,
    cuerpo,
    autor: `${c.autor} <${c.correo}>`,
    fecha: new Date(c.fecha).toLocaleString(vscode.env.language),
    padres: c.padres.map(p => p.slice(0, 7)),
    ficheros: c.ficheros.map(f => ({ estado: f.estado, ruta: f.ruta, rutaAnterior: f.rutaAnterior })),
    remoto: web ? t('Open on {0}', nombreDeRemoto(web) || t('remote')) : null,
  };
}

function abrir(context, repo) {
  const raiz = repo.rootUri.fsPath;
  const existente = paneles.get(raiz);
  if (existente) { return existente.reveal(); }

  const panel = vscode.window.createWebviewPanel('gitLore.graph', `${t('Commit Graph')}: ${path.basename(raiz)}`,
    vscode.ViewColumn.Active, {
      enableScripts: true,
      // como Git Graph: al volver de un diff siguen el scroll, el filtro y el commit abierto (cuesta algo de memoria)
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    });
  panel.iconPath = new vscode.ThemeIcon('git-merge');
  paneles.set(raiz, panel);

  let saltar = 0;
  let carriles = [];
  let cargandoMas = false;
  let recargando = false;
  let stashSinColocar = []; // stash cuya base aún no ha salido en ninguna página
  let otrosWorktrees = [];
  let generacion = 0; // una recarga deja obsoleta cualquier página en camino
  let cerrado = false;
  const id = crypto.randomUUID();
  // escrituras del ajuste de resaltar pedidas por este panel y sin acabar: sus avisos de cambio llegarían con el valor
  // de un clic anterior y harían parpadear el botón
  let resaltando = 0;
  let alcance = 'todas'; // aquí y no en el webview: si VS Code recrea el webview, se envía con las filas
  const enviar = m => { if (!cerrado) { panel.webview.postMessage(m).then(undefined, () => { }); } };
  const textoPendientes = n => t('Uncommitted changes ({0})', n);

  // mantener: tras una acción se recargan los commits que ya había (hasta MAX_RECARGA) para no perder el scroll
  async function cargar(reiniciar, mantener) {
    // una página pedida durante una recarga saldría con el desplazamiento viejo: la recarga ya trae lo que toca
    if (!reiniciar && (cargandoMas || recargando)) { return; }
    if (reiniciar) { generacion++; recargando = true; }
    const mia = generacion;
    const desde = reiniciar ? 0 : saltar;
    const limite = mantener ? Math.min(MAX_RECARGA, Math.max(PAGINA, saltar)) : PAGINA;
    cargandoMas = !reiniciar;
    try {
      // stash y worktrees se leen al recargar; las páginas siguientes tiran de lo leído
      if (reiniciar) {
        const [st, wts, refs] = await Promise.all([git.stashes(repo).catch(() => []), git.worktrees(repo).catch(() => []),
          git.firmaDeRefs(repo).catch(() => null)]);
        if (mia !== generacion || cerrado) { return; }
        stashSinColocar = st;
        otrosWorktrees = wts;
        firmaRefs = refs; // lo que se pinta ahora: un cambio posterior lo detecta comprobarRefs
      }
      const extra = otrosWorktrees.filter(w => !w.rama).map(w => w.head); // un HEAD separado no sale con --branches
      const commits = await git.grafo(repo, { saltar: desde, limite, alcance, extra });
      if (mia !== generacion || cerrado) { return; }
      const { lista, colocados } = intercalarStashes(commits, stashSinColocar);
      stashSinColocar = stashSinColocar.filter(s => !colocados.has(s.sha));
      const head = repo.state.HEAD && repo.state.HEAD.commit;
      const n = reiniciar && head ? pendientes(repo) : 0;
      const todos = [...(n ? [{ sha: PENDIENTES, padres: [head] }] : []), ...lista];
      const traza = trazarGrafo(todos, reiniciar ? [] : carriles);
      carriles = traza.carriles;
      saltar = desde + commits.length;
      const porRama = new Map(otrosWorktrees.filter(w => w.rama).map(w => [w.rama, w.ruta]));
      const sueltos = otrosWorktrees.filter(w => !w.rama);
      const filas = traza.filas.map((f, i) => {
        const c = todos[i];
        if (c.sha === PENDIENTES) { return { ...f, pendiente: true, resumen: textoPendientes(n), autor: '', fecha: '', fechaCompleta: '', refs: [] }; }
        const refs = c.stash ? [{ nombre: c.nombre, tipo: 'stash', esHead: false }] : [
          ...c.refs.map(clasificarRef).filter(Boolean)
            .map(r => (r.tipo === 'rama' && porRama.has(r.nombre) ? { ...r, worktree: porRama.get(r.nombre) } : r)),
          ...sueltos.filter(w => w.head === c.sha).map(w => ({ nombre: path.basename(w.ruta), tipo: 'worktree', esHead: false, worktree: w.ruta })),
        ];
        return {
          ...f,
          resumen: c.resumen,
          autor: c.autor,
          correo: c.correo,
          fecha: relativa(c.fecha),
          fechaCompleta: new Date(c.fecha).toLocaleString(vscode.env.language),
          refs,
          stash: !!c.stash,
          head: !c.stash && c.sha === head,
          padres: c.padres, // para saber en el webview qué es historia de HEAD
        };
      });
      const h = repo.state.HEAD;
      const actual = h && h.commit ? { sha: h.commit, nombre: h.name || h.commit.slice(0, 7) } : null;
      enviar({ tipo: 'filas', filas, reiniciar, alcance, actual, hayMas: commits.length === limite });
    } catch (e) {
      if (mia === generacion) { enviar({ tipo: 'error', mensaje: e.message }); }
    } finally {
      if (mia === generacion) { cargandoMas = false; recargando = false; }
    }
  }

  // recarga solo si cambia HEAD o aparecen/desaparecen cambios; el número se actualiza sin perder el scroll
  const firmaActual = () => {
    const h = repo.state.HEAD;
    return `${h && h.name}@${h && h.commit}:${pendientes(repo) > 0}`;
  };
  let firma = firmaActual();
  let temporizador;
  let firmaRefs = null;
  let esperaRefs;
  // con retardo: onDidChange llega a ráfagas (cada guardado refresca el estado) y esto lanza un git
  const comprobarRefs = () => {
    clearTimeout(esperaRefs);
    esperaRefs = setTimeout(async () => {
      if (firmaRefs === null || cerrado) { return; }
      // la recarga en curso leyó las refs al empezar: lo que se mueva después se mira cuando acabe
      if (recargando) { return comprobarRefs(); }
      const ahora = await git.firmaDeRefs(repo).catch(() => null);
      if (recargando) { return comprobarRefs(); }
      if (ahora === null || ahora === firmaRefs) { return; }
      firmaRefs = ahora;
      cargar(true, true);
    }, 400);
  };
  // la acción ya recarga: que el cambio de HEAD que provoca no dispare una segunda recarga
  const recargar = () => {
    firma = firmaActual();
    clearTimeout(temporizador);
    return cargar(true, true);
  };
  vistas.set(id, { repo, recargar, ocupado: valor => enviar({ tipo: 'ocupado', valor }) });
  const suscripciones = [
    repo.state.onDidChange(() => {
      const ahora = firmaActual();
      if (ahora === firma) {
        comprobarRefs(); // un fetch en segundo plano mueve remotas sin tocar HEAD
        return enviar({ tipo: 'pendientes', texto: textoPendientes(pendientes(repo)) });
      }
      firma = ahora;
      clearTimeout(temporizador);
      temporizador = setTimeout(() => cargar(true, true), 500);
    }),
    panel.webview.onDidReceiveMessage(m => {
      if (!m || typeof m !== 'object') { return; }
      if (m.tipo === 'listo' || m.tipo === 'refrescar') { return cargar(true); }
      if (m.tipo === 'mas') { return cargar(false); }
      if (m.tipo === 'alcance') {
        if (!Object.hasOwn(git.ALCANCES, m.valor)) { return; }
        alcance = m.valor;
        return cargar(true);
      }
      // el botón del grafo cambia el ajuste: así lo recuerdan los demás paneles y las próximas sesiones
      if (m.tipo === 'resaltar' && typeof m.valor === 'boolean') {
        const cfg = vscode.workspace.getConfiguration('gitLore');
        const enWorkspace = cfg.inspect(RESALTAR).workspaceValue !== undefined;
        resaltando++;
        return cfg.update(RESALTAR, m.valor, enWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global)
          .then(undefined, e => vscode.window.showErrorMessage(e.message))
          // al acabar la última, el valor guardado de verdad: si alguna falló, el botón vuelve a él
          .finally(() => { if (--resaltando === 0) { enviar({ tipo: 'resaltar', valor: resaltarAhora() }); } });
      }
      if (m.tipo === 'verCambios') { return vscode.commands.executeCommand('workbench.view.scm'); }
      if (m.tipo === 'fetch') {
        return repo.fetch({ all: true })
          .catch(e => { vscode.window.showErrorMessage((e.stderr && e.stderr.trim()) || e.message); }) // sin esperar al aviso
          .finally(recargar);
      }
      if (typeof m.sha !== 'string' || !SHA.test(m.sha)) { return; }
      const fallo = e => vscode.window.showErrorMessage(e.message);
      if (m.tipo === 'detalle') {
        return detalle(repo, m.sha).then(d => enviar({ tipo: 'detalle', ...d }),
          e => enviar({ tipo: 'detalle', sha: m.sha, error: e.message }));
      }
      if (m.tipo === 'fichero') { return grafoFicheros.abrirFichero(repo, m.sha, m.indice).catch(fallo); }
      if (m.tipo === 'remoto') { return abrirEnRemoto(repo, m.sha).then(undefined, fallo); }
      if (m.tipo === 'copiar') { return copiarSha(m.sha); }
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration(`gitLore.${RESALTAR}`) && !resaltando) { enviar({ tipo: 'resaltar', valor: resaltarAhora() }); }
    }),
  ];

  // crear una rama o un tag desde la terminal no dispara onDidChange: se vigilan los ficheros de refs
  git.dirComun(repo).then(dir => {
    if (cerrado) { return; }
    const vigia = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(dir), '{refs/**,packed-refs,FETCH_HEAD,logs/refs/stash}'));
    vigia.onDidCreate(comprobarRefs);
    vigia.onDidChange(comprobarRefs);
    vigia.onDidDelete(comprobarRefs);
    suscripciones.push(vigia);
  }, () => { }); // sin vigía el grafo sigue recargando con los cambios de HEAD y el botón de refrescar

  panel.onDidDispose(() => {
    cerrado = true;
    paneles.delete(raiz);
    vistas.delete(id);
    suscripciones.forEach(d => d.dispose());
    clearTimeout(temporizador);
    clearTimeout(esperaRefs);
  });

  panel.webview.html = html(panel.webview, context.extensionUri, crypto.randomBytes(16).toString('base64'), id, resaltarAhora());
}

function registrar(context, protegido) {
  context.subscriptions.push(vscode.commands.registerCommand('gitLore.showGraph', arg => protegido(async () => {
    const api = await git.obtenerApi();
    const repo = (arg && arg.rootUri && api.getRepository(arg.rootUri)) || await elegirRepo();
    if (!repo) { return vscode.window.showWarningMessage(t('No git repository is open')); }
    abrir(context, repo);
  })));

  grafoAcciones.registrar(context, protegido, id => vistas.get(id));
  grafoFicheros.registrar(context, protegido, id => vistas.get(id));

  // como el de Git Graph: un clic en la barra de estado abre el grafo del repo activo
  const boton = vscode.window.createStatusBarItem('gitLore.graph', vscode.StatusBarAlignment.Left);
  boton.name = t('Commit Graph');
  boton.text = `$(git-merge) ${t('Graph')}`;
  boton.tooltip = t('Show Commit Graph');
  boton.command = 'gitLore.showGraph';
  context.subscriptions.push(boton);
  git.obtenerApi().then(api => {
    const ver = () => (api.repositories.length ? boton.show() : boton.hide());
    context.subscriptions.push(api.onDidOpenRepository(ver), api.onDidCloseRepository(ver));
    ver();
  }, () => { }); // sin la extensión git no hay grafo que abrir: el botón no se enseña
}

module.exports = { registrar };
