'use strict';
// Gráfico de colaboradores en un webview: una burbuja por persona, del tamaño de sus commits en la rama actual, y la lista.
const crypto = require('crypto');
const path = require('path');
const vscode = require('vscode');
const git = require('./git');
const { claveDePersona } = require('./nucleo/parseo');
const { COLORES } = require('./nucleo/historia');
const { corto, elegirRepo } = require('./acciones');

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

function abrir(context, repo, log) {
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
  let hechas = null; // { commit, lineas }: recargar este panel sin cambiar de commit no recorre otra vez la historia
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
      const commit = head && head.commit;
      if (!hechas || hechas.commit !== commit) {
        // si fallan las líneas, el gráfico de commits ya pintado se queda: sus celdas salen vacías
        // shortcut: la salida de --numstat entera va a memoria; en repos enormes (Linux) puede fallar, y entonces
        // haría falta leerla por streaming
        const lineas = await git.lineasPorAutor(repo, token).catch(e => {
          if (e instanceof vscode.CancellationError) { throw e; }
          log(`contributors chart: ${e.message}`);
          return null;
        });
        if (mia !== generacion) { return; }
        hechas = lineas ? { commit, lineas: Object.fromEntries(lineas) } : null;
      }
      if (mia === generacion) { enviar({ tipo: 'lineas', lineas: hechas ? hechas.lineas : {} }); }
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

// como el grafo: el repo del editor activo y, sin él, se pregunta si hay varios
function registrar(context, protegido, log) {
  context.subscriptions.push(vscode.commands.registerCommand('gitLore.contributorsChart', arg => protegido(async () => {
    const api = await git.obtenerApi();
    if (!api.repositories.length) { return vscode.window.showWarningMessage(t('Open a folder with a git repository first')); }
    const repo = (arg && arg.rootUri && api.getRepository(arg.rootUri)) || await elegirRepo();
    if (!repo) { return; } // QuickPick cancelado
    abrir(context, repo, log);
  })));

  // junto al botón del grafo; sin repos abiertos no hay nada que contar
  const boton = vscode.window.createStatusBarItem('gitLore.contributorsChart', vscode.StatusBarAlignment.Left);
  boton.name = t('Contributors');
  boton.text = `$(pie-chart) ${t('Contributors')}`;
  boton.tooltip = t('Show Contributors Chart');
  boton.command = 'gitLore.contributorsChart';
  context.subscriptions.push(boton);
  git.obtenerApi().then(api => {
    const ver = () => (api.repositories.length ? boton.show() : boton.hide());
    context.subscriptions.push(api.onDidOpenRepository(ver), api.onDidCloseRepository(ver));
    ver();
  }, () => { });
}

module.exports = { registrar };
