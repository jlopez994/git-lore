'use strict';
// Commit Graph en un webview: todas las ramas, por páginas, sin límite de repos privados.
const crypto = require('crypto');
const path = require('path');
const vscode = require('vscode');
const git = require('./git');
const { trazarGrafo } = require('./nucleo/grafo');
const { nombreDeRemoto } = require('./nucleo/remotos');
const { elegirRepo, copiarSha, abrirEnRemoto, abrirCambios, relativa } = require('./acciones');

const t = vscode.l10n.t;
const PAGINA = 300;
const SHA = /^[0-9a-f]{40,64}$/;
// no es hexadecimal: nunca pasa por SHA ni llega a git
const PENDIENTES = 'pendientes';
const paneles = new Map(); // raíz → panel

function html(webview, raizExt, nonce) {
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
  <button id="refrescar" class="boton" title="${t('Refresh')}" aria-label="${t('Refresh')}">↻</button>
</header>
<main id="lista" class="lista" role="list"></main>
<div id="fin" class="fin" aria-hidden="true"></div>
<script nonce="${nonce}">window.TEXTOS = ${JSON.stringify(textos)};</script>
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

// el webview manda un índice, no una ruta: se vuelve a sacar del commit
async function abrirFichero(repo, sha, indice) {
  const c = await git.ficherosDeCommit(repo, sha);
  const f = Number.isInteger(indice) && c.ficheros[indice];
  if (!f) { return; }
  return abrirCambios(repo, { sha, ...f, refAnterior: c.padres.length ? undefined : null });
}

function abrir(context, repo) {
  const raiz = repo.rootUri.fsPath;
  const existente = paneles.get(raiz);
  if (existente) { return existente.reveal(); }

  const panel = vscode.window.createWebviewPanel('gitLore.graph', `${t('Commit Graph')}: ${path.basename(raiz)}`,
    vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    });
  panel.iconPath = new vscode.ThemeIcon('git-merge');
  paneles.set(raiz, panel);

  let saltar = 0;
  let carriles = [];
  let cargandoMas = false;
  let generacion = 0; // una recarga deja obsoleta cualquier página en camino
  let cerrado = false;
  let alcance = 'todas'; // aquí y no en el webview: sin retainContextWhenHidden se reinicia al ocultarlo
  const enviar = m => { if (!cerrado) { panel.webview.postMessage(m).then(undefined, () => { }); } };
  const textoPendientes = n => t('Uncommitted changes ({0})', n);

  async function cargar(reiniciar) {
    if (!reiniciar && cargandoMas) { return; }
    if (reiniciar) { generacion++; }
    const mia = generacion;
    const desde = reiniciar ? 0 : saltar;
    cargandoMas = !reiniciar;
    try {
      const commits = await git.grafo(repo, { saltar: desde, limite: PAGINA, alcance });
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
          fecha: relativa(c.fecha),
          fechaCompleta: new Date(c.fecha).toLocaleString(vscode.env.language),
          refs: c.refs,
          head: c.sha === head,
        };
      });
      enviar({ tipo: 'filas', filas, reiniciar, alcance, hayMas: commits.length === PAGINA });
    } catch (e) {
      if (mia === generacion) { enviar({ tipo: 'error', mensaje: e.message }); }
    } finally {
      if (mia === generacion) { cargandoMas = false; }
    }
  }

  // recarga solo si cambia HEAD o aparecen/desaparecen cambios; el número se actualiza sin perder el scroll
  const firmaActual = () => {
    const h = repo.state.HEAD;
    return `${h && h.name}@${h && h.commit}:${pendientes(repo) > 0}`;
  };
  let firma = firmaActual();
  let temporizador;
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
      if (typeof m.sha !== 'string' || !SHA.test(m.sha)) { return; }
      const fallo = e => vscode.window.showErrorMessage(e.message);
      if (m.tipo === 'detalle') {
        return detalle(repo, m.sha).then(d => enviar({ tipo: 'detalle', ...d }),
          e => enviar({ tipo: 'detalle', sha: m.sha, error: e.message }));
      }
      if (m.tipo === 'fichero') { return abrirFichero(repo, m.sha, m.indice).catch(fallo); }
      if (m.tipo === 'remoto') { return abrirEnRemoto(repo, m.sha).then(undefined, fallo); }
      if (m.tipo === 'copiar') { return copiarSha(m.sha); }
    }),
  ];

  panel.onDidDispose(() => {
    cerrado = true;
    paneles.delete(raiz);
    suscripciones.forEach(d => d.dispose());
    clearTimeout(temporizador);
  });

  panel.webview.html = html(panel.webview, context.extensionUri, crypto.randomBytes(16).toString('base64'));
}

function registrar(context, protegido) {
  context.subscriptions.push(vscode.commands.registerCommand('gitLore.showGraph', arg => protegido(async () => {
    const api = await git.obtenerApi();
    const repo = (arg && arg.rootUri && api.getRepository(arg.rootUri)) || await elegirRepo();
    if (!repo) { return vscode.window.showWarningMessage(t('No git repository is open')); }
    abrir(context, repo);
  })));
}

module.exports = { registrar };
