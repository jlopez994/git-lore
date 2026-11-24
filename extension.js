'use strict';
const vscode = require('vscode');
const git = require('./src/git');
const acciones = require('./src/acciones');
const blame = require('./src/blame');
const historial = require('./src/historial');
const comparar = require('./src/comparar');
const grafo = require('./src/grafo-vista');
const historia = require('./src/historia-vista');
const revisiones = require('./src/revisiones');
const contribuidores = require('./src/contribuidores');

const t = vscode.l10n.t;
let salida;

function log(texto) {
  salida.appendLine(`[${new Date().toISOString()}] ${texto}`);
}

async function protegido(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof vscode.CancellationError) { return; }
    log('ERROR ' + ((e && e.stack) || e));
    const ver = t('Show output');
    const r = await vscode.window.showErrorMessage(`Git Lore: ${(e && e.message) || e}`, ver);
    if (r === ver) { salida.show(); }
  }
}

// Los argumentos llegan de enlaces del hover (JSON) o de elementos de las vistas: ambos traen raiz y sha
function conCommit(fn) {
  return arg => protegido(async () => {
    if (!arg || typeof arg.raiz !== 'string' || !/^[0-9a-f]{40,64}$/.test(arg.sha || '')) {
      throw new Error(t('No commit selected'));
    }
    return fn(await acciones.repoPorRaiz(arg.raiz), arg);
  });
}

function activate(context) {
  salida = vscode.window.createOutputChannel('Git Lore');
  context.subscriptions.push(
    salida,
    vscode.commands.registerCommand('gitLore.showCommit', conCommit((repo, a) => acciones.mostrarCommit(repo, a.sha))),
    vscode.commands.registerCommand('gitLore.openOnRemote', conCommit((repo, a) => acciones.abrirEnRemoto(repo, a.sha))),
    vscode.commands.registerCommand('gitLore.copySha', a => protegido(() => acciones.copiarSha(a.sha))),
    vscode.commands.registerCommand('gitLore.openChanges', a => protegido(async () => {
      const repo = await acciones.repoPorRaiz(a.raiz);
      if (a.sinCommit) {
        const uri = git.uriEnRevision(repo, a.ruta);
        return vscode.commands.executeCommand('vscode.diff', git.uriEnRevision(repo, a.ruta, 'HEAD'), uri,
          `${a.ruta.split('/').pop()} (HEAD ↔ ${t('Working Tree')})`);
      }
      return acciones.abrirCambios(repo, a);
    })),
  );
  blame.registrar(context, log);
  const ficheroDelHistorial = historial.registrar(context, log);
  comparar.registrar(context, protegido);
  grafo.registrar(context, protegido);
  historia.registrar(context, protegido, ficheroDelHistorial);
  revisiones.registrar(context, protegido);
  contribuidores.registrar(context, log);
}

function deactivate() { }

module.exports = { activate, deactivate };
