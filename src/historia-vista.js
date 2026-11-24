'use strict';
// Historial visual de un fichero en un webview: un punto por commit, una fila por autor, y las líneas que cambió.
const crypto = require('crypto');
const path = require('path');
const vscode = require('vscode');
const git = require('./git');
const { agruparAutores, cambiosDe } = require('./nucleo/historia');
const { abrirCambios, relativa } = require('./acciones');

const t = vscode.l10n.t;
const LIMITE = 1000;
const paneles = new Map(); // fsPath → { panel, cargar }

function html(webview, raizExt, nonce) {
  const recurso = f => webview.asWebviewUri(vscode.Uri.joinPath(raizExt, 'media', f));
  const textos = {
    commits: t('{0} commits'), unCommit: t('1 commit'), autores: t('{0} authors'), unAutor: t('1 author'), otros: t('Others ({0})'), sinCommits: t('No commits'),
    lineas: t('Lines changed'), desde: t('since {0}'), binario: t('binary'), limite: t('Showing the last {0} commits'),
  };
  return `<!doctype html>
<html lang="${vscode.env.language}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${recurso('paleta.css')}">
<link rel="stylesheet" href="${recurso('historia.css')}">
</head>
<body>
<header class="cabecera">
  <h1 id="titulo"></h1>
  <p id="resumen" class="resumen" aria-live="polite"></p>
</header>
<main id="grafica" class="grafica" aria-busy="true"></main>
<div id="globo" class="globo" role="tooltip" hidden></div>
<script nonce="${nonce}">window.TEXTOS = ${JSON.stringify(textos)};</script>
<script nonce="${nonce}" src="${recurso('historia.js')}"></script>
</body>
</html>`;
}

async function datos(repo, uri) {
  const [commits, lineas] = await Promise.all([git.historial(repo, uri, { limite: LIMITE }), git.lineasDeFichero(repo, uri, LIMITE)]);
  const { autores, filaDe } = agruparAutores(commits);
  return {
    autores,
    limitado: commits.length === LIMITE,
    commits: commits.map(c => {
      const l = lineas.get(c.sha) || { mas: 0, menos: 0, binario: false };
      return {
        sha: c.sha, resumen: c.resumen, autor: c.autor, fecha: c.fecha, fila: filaDe(c), ...l,
        cuando: relativa(c.fecha), fechaCompleta: new Date(c.fecha).toLocaleString(vscode.env.language),
      };
    }),
    // lo que hace falta para abrir el diff se queda aquí: el webview solo manda el sha
    cambios: cambiosDe(commits, git.rutaRelativa(repo, uri)),
  };
}

function abrir(context, repo, uri) {
  const existente = paneles.get(uri.fsPath);
  if (existente) {
    existente.panel.reveal();
    return existente.cargar(); // pudo haber commits, checkouts o renombrados desde que se abrió
  }
  const nombre = path.basename(uri.fsPath);
  const panel = vscode.window.createWebviewPanel('gitLore.visualHistory', `${t('Visual History')}: ${nombre}`,
    vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true, // como el grafo: volver de un diff no redibuja
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    });
  panel.iconPath = new vscode.ThemeIcon('graph-scatter');
  let cambios = new Map();
  let cerrado = false;
  let generacion = 0; // al reabrir puede haber dos cargas en vuelo: gana la última pedida
  const enviar = m => { if (!cerrado) { panel.webview.postMessage(m).then(undefined, () => { }); } };

  async function cargar() {
    const mia = ++generacion;
    try {
      const d = await datos(repo, uri);
      if (mia !== generacion) { return; }
      cambios = d.cambios;
      enviar({ tipo: 'datos', fichero: git.rutaRelativa(repo, uri), autores: d.autores, commits: d.commits, limitado: d.limitado });
    } catch (e) {
      if (mia === generacion) { enviar({ tipo: 'error', mensaje: e.message }); }
    }
  }

  paneles.set(uri.fsPath, { panel, cargar });
  const suscripcion = panel.webview.onDidReceiveMessage(m => {
    if (!m || typeof m !== 'object') { return; }
    if (m.tipo === 'listo') { return cargar(); }
    // solo shas que salieron de este historial
    if (m.tipo === 'abrir' && typeof m.sha === 'string' && cambios.has(m.sha)) {
      return abrirCambios(repo, cambios.get(m.sha)).then(undefined, e => vscode.window.showErrorMessage(e.message));
    }
  });
  panel.onDidDispose(() => {
    cerrado = true;
    paneles.delete(uri.fsPath);
    suscripcion.dispose();
  });
  panel.webview.html = html(panel.webview, context.extensionUri, crypto.randomBytes(16).toString('base64'));
}

// sin argumento (icono de la vista File History, paleta) va el fichero que enseña esa vista, que no tiene por qué
// ser el del editor activo
function registrar(context, protegido, ficheroDelHistorial) {
  context.subscriptions.push(vscode.commands.registerCommand('gitLore.visualFileHistory', arg => protegido(async () => {
    const editor = vscode.window.activeTextEditor;
    const uri = arg instanceof vscode.Uri ? arg : ficheroDelHistorial() || (editor && editor.document.uri);
    const repo = await git.repoDe(uri);
    if (!repo) { return vscode.window.showWarningMessage(t('Open a file in a git repository first')); }
    abrir(context, repo, uri);
  })));
}

module.exports = { registrar };
