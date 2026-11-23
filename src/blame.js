'use strict';
// Blame de la línea actual (al final de la línea, con hover) y del fichero entero (margen con mapa de calor).
const vscode = require('vscode');
const git = require('./git');
const { relativa, corto } = require('./acciones');
const { urlDeCommit, nombreDeRemoto } = require('./nucleo/remotos');
const { calor } = require('./nucleo/tiempo');

const t = vscode.l10n.t;
const FIN = Number.MAX_SAFE_INTEGER;
const ANCHO = 42;
const COMANDOS = ['gitLore.showCommit', 'gitLore.openChanges', 'gitLore.copySha', 'gitLore.lineHistory'];

const cache = new Map(); // uri → { version, promesa }
const mensajes = new Map(); // sha → Promise<cuerpo>
const conBlameDeFichero = new Set(); // uri
let log = () => { };

const tipoLinea = vscode.window.createTextEditorDecorationType({
  after: { margin: '0 0 0 3em', color: new vscode.ThemeColor('gitLore.currentLineForeground') },
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
});
const tipoFichero = vscode.window.createTextEditorDecorationType({
  before: {
    width: `${ANCHO + 1}ch`,
    margin: '0 1.5em 0 0',
    color: new vscode.ThemeColor('gitLore.fileBlameForeground'),
    backgroundColor: new vscode.ThemeColor('gitLore.fileBlameBackground'),
  },
});

// Mapa de calor como barra en el margen: los adjuntos before no admiten borde de un solo lado
const CUBOS = 8;
const tiposCalor = Array.from({ length: CUBOS }, (_, i) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect x="11" width="4" height="16" fill="${colorDeCalor(i / (CUBOS - 1))}"/></svg>`;
  return vscode.window.createTextEditorDecorationType({
    gutterIconPath: vscode.Uri.parse(`data:image/svg+xml,${encodeURIComponent(svg)}`),
    gutterIconSize: 'contain',
  });
});

// k 1 = reciente (naranja), 0 = antiguo (azul), pasando por morado como el icono
function colorDeCalor(k) {
  return `hsla(${Math.round(215 + 170 * k) % 360}, ${Math.round(45 + 45 * k)}%, 60%, ${(0.45 + 0.55 * k).toFixed(2)})`;
}

function obtenerBlame(documento) {
  if (documento.uri.scheme !== 'file') { return Promise.resolve(null); }
  const clave = documento.uri.toString();
  const enCache = cache.get(clave);
  if (enCache && enCache.version === documento.version) { return enCache.promesa; }
  // una versión nueva deja obsoleto el blame en marcha: se mata el proceso
  if (enCache) { enCache.cancelar.cancel(); }
  const cancelar = new vscode.CancellationTokenSource();
  const entrada = { version: documento.version, cancelar };
  const olvidar = () => { if (cache.get(clave) === entrada) { cache.delete(clave); } };
  entrada.promesa = git.repoDe(documento.uri)
    .then(repo => {
      // sin repo puede ser que vscode.git aún no lo haya abierto: no se cachea
      if (!repo) { olvidar(); return null; }
      return git.blame(repo, documento, cancelar.token).then(b => ({ ...b, repo }));
    })
    // fuera de git, sin seguimiento o binario: sin blame, no es un error que enseñar
    .catch(e => {
      olvidar();
      if (!(e instanceof vscode.CancellationError)) { log(`blame ${documento.uri.fsPath}: ${e.message}`); }
      return null;
    });
  cache.set(clave, entrada);
  return entrada.promesa;
}

function cuerpoDe(repo, sha) {
  if (!mensajes.has(sha)) {
    mensajes.set(sha, git.mensaje(repo, sha).catch(() => ''));
  }
  return mensajes.get(sha);
}

const enlace = (comando, arg) => `command:${comando}?${encodeURIComponent(JSON.stringify([arg]))}`;

// `linea` (0-based) solo en el hover de la línea actual: el del fichero se comparte entre líneas
function hoverDe(repo, c, cuerpo, linea) {
  const md = new vscode.MarkdownString('', true);
  md.isTrusted = { enabledCommands: COMANDOS };
  const raiz = repo.rootUri.fsPath;
  if (c.sinCommit) {
    md.appendMarkdown(`$(edit) **${t('Uncommitted changes')}**\n\n`);
    md.appendMarkdown(`[$(git-compare) ${t('Open changes')}](${enlace('gitLore.openChanges', { raiz, ruta: c.fichero, sinCommit: true })})`);
    return md;
  }
  const fecha = new Date(c.fecha).toLocaleString(vscode.env.language, { dateStyle: 'medium', timeStyle: 'short' });
  md.appendMarkdown('$(account) **');
  md.appendText(c.autor || '');
  md.appendMarkdown(`** · ${relativa(c.fecha)} (${fecha})\n\n`);
  md.appendText(cuerpo || c.resumen || '');
  md.appendMarkdown('\n\n---\n\n');
  const cambios = { raiz, sha: c.sha, ruta: c.fichero, rutaAnterior: c.ficheroAnterior, refAnterior: c.anterior || null };
  const partes = [
    `[$(git-compare) ${t('Open changes')}](${enlace('gitLore.openChanges', cambios)})`,
    `[$(git-commit) ${corto(c.sha)}](${enlace('gitLore.showCommit', { raiz, sha: c.sha })} "${t('Show commit')}")`,
    `[$(copy)](${enlace('gitLore.copySha', { sha: c.sha })} "${t('Copy SHA')}")`,
  ];
  const web = git.webDe(repo);
  const url = urlDeCommit(web, c.sha);
  if (url) { partes.push(`[$(globe) ${t('Open on {0}', nombreDeRemoto(web) || t('remote'))}](${url})`); }
  if (linea !== undefined) {
    partes.push(`[$(history) ${t('Line history')}](${enlace('gitLore.lineHistory', { linea })} "${t('Line history')}")`);
  }
  md.appendMarkdown(partes.join('&nbsp;&nbsp;|&nbsp;&nbsp;'));
  return md;
}

// ——— línea actual ———

let turno = 0;
let temporizador;

function activaLineaActual() {
  return vscode.workspace.getConfiguration('gitLore').get('currentLine.enabled', true);
}

function programarLinea() {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => pintarLinea(vscode.window.activeTextEditor), 120);
}

async function pintarLinea(editor) {
  const mio = ++turno;
  for (const e of vscode.window.visibleTextEditors) { if (e !== editor) { e.setDecorations(tipoLinea, []); } }
  if (!editor) { return; }
  if (!activaLineaActual() || editor.selections.length !== 1) { return editor.setDecorations(tipoLinea, []); }
  const linea = editor.selection.active.line;
  const b = await obtenerBlame(editor.document);
  const c = b && b.commits.get(b.lineas[linea]);
  if (!c) { return mio === turno && editor.setDecorations(tipoLinea, []); }
  const cuerpo = c.sinCommit ? '' : await cuerpoDe(b.repo, c.sha);
  if (mio !== turno) { return; }
  const texto = c.sinCommit
    ? t('Uncommitted changes')
    : `${c.autor}, ${relativa(c.fecha)} • ${c.resumen}`;
  editor.setDecorations(tipoLinea, [{
    range: new vscode.Range(linea, FIN, linea, FIN),
    hoverMessage: hoverDe(b.repo, c, cuerpo, linea),
    renderOptions: { after: { contentText: texto } },
  }]);
}

// ——— fichero entero ———

function recortar(texto, n) {
  return texto.length > n ? texto.slice(0, n - 1) + '…' : texto.padEnd(n, ' ');
}

async function pintarFichero(editor) {
  const limpiar = () => [tipoFichero, ...tiposCalor].forEach(tipo => editor.setDecorations(tipo, []));
  if (!conBlameDeFichero.has(editor.document.uri.toString())) { return limpiar(); }
  const b = await obtenerBlame(editor.document);
  const vigente = cache.get(editor.document.uri.toString());
  // otra pintada más nueva ya está en camino: no pisarla con líneas viejas
  if (!vigente || vigente.version !== editor.document.version) { return; }
  if (!b || !conBlameDeFichero.has(editor.document.uri.toString())) { return limpiar(); }
  const ahora = Date.now();
  const porCubo = tiposCalor.map(() => []);
  const hovers = new Map();
  const decoraciones = b.lineas.map((sha, i) => {
    const c = b.commits.get(sha);
    const primera = i === 0 || b.lineas[i - 1] !== sha;
    if (!hovers.has(sha)) { hovers.set(sha, hoverDe(b.repo, c, '')); }
    const texto = !primera ? '' : c.sinCommit
      ? t('Uncommitted')
      : `${corto(sha)} ${c.autor} · ${relativa(c.fecha)} · ${c.resumen}`;
    const range = new vscode.Range(i, 0, i, 0);
    if (!c.sinCommit) { porCubo[Math.round(calor(c.fecha, ahora) * (CUBOS - 1))].push(range); }
    return {
      range,
      hoverMessage: primera ? hovers.get(sha) : undefined,
      renderOptions: { before: { contentText: recortar(texto, ANCHO) } },
    };
  });
  editor.setDecorations(tipoFichero, decoraciones);
  tiposCalor.forEach((tipo, i) => editor.setDecorations(tipo, porCubo[i]));
}

async function alternarBlameDeFichero() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return; }
  const clave = editor.document.uri.toString();
  if (conBlameDeFichero.has(clave)) { conBlameDeFichero.delete(clave); }
  else {
    if (!(await obtenerBlame(editor.document))) {
      return vscode.window.showWarningMessage(t('No blame for this file: it is not tracked by git'));
    }
    conBlameDeFichero.add(clave);
  }
  for (const e of vscode.window.visibleTextEditors) {
    if (e.document.uri.toString() === clave) { await pintarFichero(e); }
  }
}

function registrar(context, registrarLog) {
  log = registrarLog;
  let temporizadorFichero;
  const repintarFicheros = documento => {
    clearTimeout(temporizadorFichero);
    temporizadorFichero = setTimeout(() => {
      for (const e of vscode.window.visibleTextEditors) {
        if (!documento || e.document === documento) { pintarFichero(e); }
      }
    }, 300);
  };
  // el estado cambia a cada refresco; el blame solo caduca cuando se mueve HEAD
  const escuchar = repo => {
    let head = repo.state.HEAD && repo.state.HEAD.commit;
    context.subscriptions.push(repo.state.onDidChange(() => {
      const ahora = repo.state.HEAD && repo.state.HEAD.commit;
      if (ahora === head) { return; }
      head = ahora;
      cache.clear();
      programarLinea();
      repintarFicheros();
    }));
  };
  git.obtenerApi().then(api => {
    api.repositories.forEach(escuchar);
    context.subscriptions.push(api.onDidOpenRepository(repo => {
      escuchar(repo);
      cache.clear();
      programarLinea();
      repintarFicheros();
    }));
  }, e => log(e.message));
  context.subscriptions.push(
    tipoLinea, tipoFichero, ...tiposCalor,
    vscode.window.onDidChangeTextEditorSelection(programarLinea),
    vscode.window.onDidChangeActiveTextEditor(programarLinea),
    vscode.window.onDidChangeVisibleTextEditors(() => repintarFicheros()),
    vscode.workspace.onDidChangeTextDocument(e => { programarLinea(); repintarFicheros(e.document); }),
    vscode.workspace.onDidCloseTextDocument(d => cache.delete(d.uri.toString())),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('gitLore')) { programarLinea(); } }),
    vscode.commands.registerCommand('gitLore.toggleFileBlame', alternarBlameDeFichero),
    vscode.commands.registerCommand('gitLore.toggleCurrentLine', () => {
      const c = vscode.workspace.getConfiguration('gitLore');
      return c.update('currentLine.enabled', !c.get('currentLine.enabled', true), vscode.ConfigurationTarget.Global);
    }),
  );
  programarLinea();
}

module.exports = { registrar };
