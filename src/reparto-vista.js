'use strict';
// Gráfico de colaboradores en un webview: una burbuja por persona, del tamaño de sus commits en la rama actual, y la lista.
const crypto = require('crypto');
const path = require('path');
const vscode = require('vscode');
const git = require('./git');
const { claveDePersona } = require('./nucleo/parseo');
const { COLORES } = require('./nucleo/historia');
const { corto } = require('./acciones');

const t = vscode.l10n.t;
const paneles = new Map(); // raíz del repo → { panel, cargar }

function html(webview, raizExt, nonce) {
  const recurso = f => webview.asWebviewUri(vscode.Uri.joinPath(raizExt, 'media', f));
  const textos = {
    commits: t('{0} commits'), unCommit: t('1 commit'), autores: t('{0} authors'), unAutor: t('1 author'), otros: t('Others ({0})'),
    sinCommits: t('No commits'), enRama: t('on {0}'), autor: t('Author'), columnaCommits: t('Commits'), lineas: t('Lines changed'),
    titulo: t('Share of commits per author'),
  };
  return `<!doctype html>
<html lang="${vscode.env.language}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${recurso('paleta.css')}">
<link rel="stylesheet" href="${recurso('reparto.css')}">
</head>
<body>
<header class="cabecera">
  <h1 id="titulo"></h1>
  <p id="resumen" class="resumen" aria-live="polite"></p>
</header>
<main id="reparto" class="reparto" aria-busy="true"></main>
<div id="globo" class="globo" role="tooltip" hidden></div>
<script nonce="${nonce}">window.TEXTOS = ${JSON.stringify(textos)};</script>
<script nonce="${nonce}" src="${recurso('burbujas.js')}"></script>
<script nonce="${nonce}" src="${recurso('reparto.js')}"></script>
</body>
</html>`;
}

function abrir(context, repo) {
  const raiz = repo.rootUri.fsPath;
  const existente = paneles.get(raiz);
  if (existente) {
    existente.panel.reveal();
    return existente.cargar();
  }
  const panel = vscode.window.createWebviewPanel('gitLore.contributorsChart', `${t('Contributors')}: ${path.basename(raiz)}`,
    vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    });
  panel.iconPath = new vscode.ThemeIcon('pie-chart');
  let cerrado = false;
  let generacion = 0;
  let cancelar = null;
  const enviar = m => { if (!cerrado) { panel.webview.postMessage(m).then(undefined, () => { }); } };

  // primero los commits (shortlog es rápido) y luego las líneas, que recorren toda la historia
  async function cargar() {
    const mia = ++generacion;
    if (cancelar) { cancelar.cancel(); cancelar.dispose(); }
    cancelar = new vscode.CancellationTokenSource();
    const token = cancelar.token;
    try {
      const personas = await git.autores(repo);
      if (mia !== generacion) { return; }
      const head = repo.state.HEAD;
      enviar({
        tipo: 'personas',
        repo: path.basename(raiz),
        rama: head ? head.name || (head.commit && corto(head.commit)) : '',
        personas: personas.map((p, i) => ({ ...p, clave: claveDePersona(p.correo, p.nombre), color: i < COLORES ? i : null })),
      });
      // si fallan las líneas, el gráfico de commits ya pintado se queda: sus celdas salen vacías
      const lineas = await git.lineasPorAutor(repo, token).catch(e => {
        if (e instanceof vscode.CancellationError) { throw e; }
        return new Map();
      });
      if (mia === generacion) { enviar({ tipo: 'lineas', lineas: Object.fromEntries(lineas) }); }
    } catch (e) {
      if (e instanceof vscode.CancellationError || mia !== generacion) { return; }
      enviar({ tipo: 'error', mensaje: e.message });
    }
  }

  // como la vista Contributors: otra rama u otro commit cambian las cifras
  const firma = () => repo.state.HEAD && `${repo.state.HEAD.name}@${repo.state.HEAD.commit}`;
  let vista = firma();
  const vigia = repo.state.onDidChange(() => {
    if (firma() === vista) { return; }
    vista = firma();
    cargar();
  });

  paneles.set(raiz, { panel, cargar });
  const suscripcion = panel.webview.onDidReceiveMessage(m => {
    if (m && m.tipo === 'listo') { cargar(); }
  });
  panel.onDidDispose(() => {
    cerrado = true;
    paneles.delete(raiz);
    if (cancelar) { cancelar.cancel(); cancelar.dispose(); }
    vigia.dispose();
    suscripcion.dispose();
  });
  panel.webview.html = html(panel.webview, context.extensionUri, crypto.randomBytes(16).toString('base64'));
}

// sin argumento va el repo que enseña la vista Contributors; desde la paleta sin esa vista, el del editor o el primero
function registrar(context, protegido, repoDeContribuidores) {
  context.subscriptions.push(vscode.commands.registerCommand('gitLore.contributorsChart', () => protegido(async () => {
    const api = await git.obtenerApi();
    const editor = vscode.window.activeTextEditor;
    const repo = repoDeContribuidores() || (editor && api.getRepository(editor.document.uri)) || api.repositories[0];
    if (!repo) { return vscode.window.showWarningMessage(t('Open a folder with a git repository first')); }
    abrir(context, repo);
  })));
}

module.exports = { registrar };
