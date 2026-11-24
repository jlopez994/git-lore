'use strict';
// Commit Graph en un webview: todas las ramas, por páginas, sin límite de repos privados.
const crypto = require('crypto');
const path = require('path');
const vscode = require('vscode');
const git = require('./git');
const { trazarGrafo } = require('./nucleo/grafo');
const { clasificarRef } = require('./nucleo/refs');
const grafoAcciones = require('./grafo-acciones');
const grafoFicheros = require('./grafo-ficheros');
const { nombreDeRemoto } = require('./nucleo/remotos');
const { elegirRepo, copiarSha, abrirEnRemoto, relativa } = require('./acciones');

const t = vscode.l10n.t;
const PAGINA = 300;
const MAX_RECARGA = 3 * PAGINA; // tras una acción no se vuelve a pedir todo lo que se haya cargado con scroll
const SHA = /^[0-9a-f]{40,64}$/;
// no es hexadecimal: nunca pasa por SHA ni llega a git
const PENDIENTES = 'pendientes';
const paneles = new Map(); // raíz → panel
const vistas = new Map(); // id opaco del panel → { repo, recargar }: el menú contextual dice de qué panel viene

function html(webview, raizExt, nonce, id) {
  const recurso = f => webview.asWebviewUri(vscode.Uri.joinPath(raizExt, 'media', f));
  const textos = {
    copiado: t('Copied'), sinCommits: t('No commits'), copiar: t('Copy SHA'), ficheros: t('Files'), padres: t('Parents'),
    verCambios: t('Show in Source Control'),
  };
  return `<!doctype html>
<html lang="${vscode.env.language}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${recurso('grafo.css')}">
</head>
<body>
<header class="barra">
  <input id="buscar" type="search" placeholder="${t('Filter by message, author, ref or SHA')}" aria-label="${t('Filter commits')}">
  <select id="alcance" aria-label="${t('Branches to show')}">
    <option value="todas">${t('All branches')}</option>
    <option value="locales">${t('Local branches')}</option>
    <option value="actual">${t('Current branch')}</option>
  </select>
  <span id="cuenta" class="cuenta" aria-live="polite"></span>
  <button id="fetch" class="boton" title="${t('Fetch from all remotes')}" aria-label="${t('Fetch from all remotes')}"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1v9m-4-4 4 4 4-4M2 14h12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  <button id="refrescar" class="boton" title="${t('Refresh')}" aria-label="${t('Refresh')}"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
</header>
<main id="lista" class="lista" role="list"></main>
<div id="fin" class="fin" aria-hidden="true"></div>
<div id="tirador" class="tirador" role="separator" aria-orientation="vertical" tabindex="0" aria-valuemin="24"
  aria-label="${t('Graph width')}" title="${t('Drag to resize the graph, double-click to reset')}"></div>
<script nonce="${nonce}">window.TEXTOS = ${JSON.stringify(textos)}; window.PANEL = ${JSON.stringify(id)};</script>
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
  let generacion = 0; // una recarga deja obsoleta cualquier página en camino
  let cerrado = false;
  const id = crypto.randomUUID();
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
      const commits = await git.grafo(repo, { saltar: desde, limite, alcance });
      if (mia !== generacion || cerrado) { return; }
      const head = repo.state.HEAD && repo.state.HEAD.commit;
      const n = reiniciar && head ? pendientes(repo) : 0;
      const falso = n ? [{ sha: PENDIENTES, padres: [head] }] : [];
      const traza = trazarGrafo([...falso, ...commits], reiniciar ? [] : carriles);
      carriles = traza.carriles;
      saltar = desde + commits.length;
      const filas = traza.filas.map((f, i) => {
        const c = commits[i - falso.length];
        if (!c) { return { ...f, pendiente: true, resumen: textoPendientes(n), autor: '', fecha: '', fechaCompleta: '', refs: [] }; }
        return {
          ...f,
          resumen: c.resumen,
          autor: c.autor,
          correo: c.correo,
          fecha: relativa(c.fecha),
          fechaCompleta: new Date(c.fecha).toLocaleString(vscode.env.language),
          refs: c.refs.map(clasificarRef).filter(Boolean),
          head: c.sha === head,
        };
      });
      enviar({ tipo: 'filas', filas, reiniciar, alcance, hayMas: commits.length === limite });
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
  // la acción ya recarga: que el cambio de HEAD que provoca no dispare una segunda recarga
  const recargar = () => {
    firma = firmaActual();
    clearTimeout(temporizador);
    return cargar(true, true);
  };
  vistas.set(id, { repo, recargar });
  const suscripciones = [
    repo.state.onDidChange(() => {
      const ahora = firmaActual();
      if (ahora === firma) { return enviar({ tipo: 'pendientes', texto: textoPendientes(pendientes(repo)) }); }
      firma = ahora;
      clearTimeout(temporizador);
      temporizador = setTimeout(() => cargar(true), 500);
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
  ];

  panel.onDidDispose(() => {
    cerrado = true;
    paneles.delete(raiz);
    vistas.delete(id);
    suscripciones.forEach(d => d.dispose());
    clearTimeout(temporizador);
  });

  panel.webview.html = html(panel.webview, context.extensionUri, crypto.randomBytes(16).toString('base64'), id);
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
