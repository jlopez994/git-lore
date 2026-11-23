'use strict';
// Commit Graph en un webview: todas las ramas, por páginas, sin límite de repos privados.
const crypto = require('crypto');
const path = require('path');
const vscode = require('vscode');
const git = require('./git');
const { trazarGrafo } = require('./nucleo/grafo');
const { elegirRepo, mostrarCommit, copiarSha, relativa } = require('./acciones');

const t = vscode.l10n.t;
const PAGINA = 300;
const paneles = new Map(); // raíz → panel

function html(webview, raizExt, nonce) {
  const recurso = f => webview.asWebviewUri(vscode.Uri.joinPath(raizExt, 'media', f));
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
  <span id="cuenta" class="cuenta" aria-live="polite"></span>
  <button id="refrescar" class="boton" title="${t('Refresh')}" aria-label="${t('Refresh')}">↻</button>
</header>
<main id="lista" class="lista" role="list"></main>
<div id="fin" class="fin" aria-hidden="true"></div>
<script nonce="${nonce}">window.TEXTOS = ${JSON.stringify({ copiado: t('Copied'), sinCommits: t('No commits'), copiar: t('Copy SHA') })};</script>
<script nonce="${nonce}" src="${recurso('grafo.js')}"></script>
</body>
</html>`;
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
  const enviar = m => { if (!cerrado) { panel.webview.postMessage(m).then(undefined, () => { }); } };

  async function cargar(reiniciar) {
    if (!reiniciar && cargandoMas) { return; }
    if (reiniciar) { generacion++; }
    const mia = generacion;
    const desde = reiniciar ? 0 : saltar;
    cargandoMas = !reiniciar;
    try {
      const commits = await git.grafo(repo, { saltar: desde, limite: PAGINA });
      if (mia !== generacion || cerrado) { return; }
      const traza = trazarGrafo(commits, reiniciar ? [] : carriles);
      carriles = traza.carriles;
      saltar = desde + commits.length;
      const head = repo.state.HEAD && repo.state.HEAD.commit;
      const filas = traza.filas.map((f, i) => {
        const c = commits[i];
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
      enviar({ tipo: 'filas', filas, reiniciar, hayMas: commits.length === PAGINA });
    } catch (e) {
      if (mia === generacion) { enviar({ tipo: 'error', mensaje: e.message }); }
    } finally {
      if (mia === generacion) { cargandoMas = false; }
    }
  }

  let firma = '';
  let temporizador;
  const suscripciones = [
    repo.state.onDidChange(() => {
      const ahora = `${repo.state.HEAD && repo.state.HEAD.name}@${repo.state.HEAD && repo.state.HEAD.commit}`;
      if (ahora === firma) { return; }
      firma = ahora;
      clearTimeout(temporizador);
      temporizador = setTimeout(() => cargar(true), 500);
    }),
    panel.webview.onDidReceiveMessage(m => {
      if (!m || typeof m !== 'object') { return; }
      if (m.tipo === 'listo' || m.tipo === 'refrescar') { return cargar(true); }
      if (m.tipo === 'mas') { return cargar(false); }
      if (typeof m.sha !== 'string' || !/^[0-9a-f]{40,64}$/.test(m.sha)) { return; }
      if (m.tipo === 'commit') { return mostrarCommit(repo, m.sha).catch(e => vscode.window.showErrorMessage(e.message)); }
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
