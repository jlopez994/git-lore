'use strict';
// Menú contextual del Commit Graph: ramas, checkout, tags, cherry-pick, revert y reset.
// Los argumentos salen del data-vscode-context del webview: se validan aquí como entrada externa.
const vscode = require('vscode');
const git = require('./git');
const { ramaLocalDe, nombreValido } = require('./nucleo/refs');
const { copiarSha, corto } = require('./acciones');

const t = vscode.l10n.t;
const SHA = /^[0-9a-f]{40,64}$/;
const PREFIJO = { rama: 'refs/heads/', remota: 'refs/remotes/', tag: 'refs/tags/' };

function shaDe(arg) {
  if (typeof arg.sha !== 'string' || !SHA.test(arg.sha)) { throw new Error(t('No commit selected')); }
  return arg.sha;
}

// la fila puede estar desfasada: la ref tiene que seguir existiendo con ese tipo
async function refDe(repo, arg, tipos) {
  const { ref, tipo } = arg;
  if (!tipos.includes(tipo) || typeof ref !== 'string' || !ref || ref.startsWith('-')) {
    throw new Error(t('Not a valid ref: {0}', String(ref)));
  }
  const refs = await git.refs(repo);
  if (!refs.some(r => r.completo === PREFIJO[tipo] + ref)) { throw new Error(t('Not a valid ref: {0}', ref)); }
  return { ref, refs };
}

// GitError de vscode.git trae «Failed to execute git» en message y lo útil en stderr
function motivo(e) {
  return new Error((e && e.stderr && e.stderr.trim()) || (e && e.message) || String(e));
}

const validarNombre = v => (!v.trim() ? t('Enter a name') : nombreValido(v.trim()) ? null : t('Not a valid name for a git ref'));

async function pedirNombre(titulo) {
  const n = await vscode.window.showInputBox({ title: titulo, prompt: t('Name'), validateInput: validarNombre });
  return n && n.trim();
}

async function confirmar(mensaje, detalle, boton) {
  return (await vscode.window.showWarningMessage(mensaje, { modal: true, detail: detalle }, boton)) === boton;
}

const ACCIONES = {
  async checkout(repo, arg, con) {
    if (arg.webviewSection === 'commit') { return con(t('Checking out {0}…', corto(shaDe(arg))), () => repo.checkout(arg.sha)); }
    const { ref, refs } = await refDe(repo, arg, ['rama', 'remota', 'tag']);
    // el tag por su ref completa: con el nombre corto git preferiría una rama homónima
    if (arg.tipo !== 'remota') { return con(t('Checking out {0}…', ref), () => repo.checkout(arg.tipo === 'tag' ? PREFIJO.tag + ref : ref)); }
    // origin/x → x local que sigue a origin/x (o la que ya había)
    const local = ramaLocalDe(ref, repo.state.remotes.map(r => r.name));
    if (refs.some(r => r.completo === PREFIJO.rama + local)) { return con(t('Checking out {0}…', local), () => repo.checkout(local)); }
    return con(t('Checking out {0}…', local), async () => {
      await repo.createBranch(local, true, ref);
      return repo.setBranchUpstream(local, ref); // createBranch de la API la deja sin seguimiento
    });
  },

  async createBranch(repo, arg, con) {
    const sha = shaDe(arg);
    const nombre = await pedirNombre(t('Create branch at {0}', corto(sha)));
    if (!nombre) { return false; }
    return con(t('Creating branch {0}…', nombre), () => repo.createBranch(nombre, true, sha));
  },

  async createTag(repo, arg, con) {
    const sha = shaDe(arg);
    const nombre = await pedirNombre(t('Create tag at {0}', corto(sha)));
    if (!nombre) { return false; }
    return con(t('Creating tag {0}…', nombre), () => git.crearTag(repo, nombre, sha));
  },

  async merge(repo, arg, con) {
    const { ref } = await refDe(repo, arg, ['rama', 'remota']);
    // completa: una rama y un tag pueden llamarse igual
    return con(t('Merging {0}…', ref), () => repo.merge(PREFIJO[arg.tipo] + ref));
  },

  cherryPick: (repo, arg, con) => con(t('Cherry-picking {0}…', corto(shaDe(arg))), () => git.cherryPick(repo, arg.sha)),
  revert: (repo, arg, con) => con(t('Reverting {0}…', corto(shaDe(arg))), () => git.revertir(repo, arg.sha)),

  async reset(repo, arg, con) {
    const sha = shaDe(arg);
    const rama = (repo.state.HEAD && repo.state.HEAD.name) || 'HEAD';
    const modo = await vscode.window.showQuickPick([
      { label: 'soft', description: t('Keep the changes staged'), modo: 'soft' },
      { label: 'mixed', description: t('Keep the changes, unstaged'), modo: 'mixed' },
      { label: 'hard', description: t('Discard all changes'), modo: 'hard' },
    ], { title: t('Reset {0} to {1}', rama, corto(sha)) });
    if (!modo) { return false; }
    if (modo.modo === 'hard' && !await confirmar(t('Reset {0} to {1} and discard all changes?', rama, corto(sha)),
      t('Uncommitted changes and the commits after {0} on this branch are lost.', corto(sha)), t('Reset'))) { return false; }
    return con(t('Resetting {0} to {1}…', rama, corto(sha)), () => git.resetear(repo, sha, modo.modo));
  },

  async deleteBranch(repo, arg, con) {
    const { ref } = await refDe(repo, arg, ['rama']);
    if (!await confirmar(t('Delete branch {0}?', ref), undefined, t('Delete'))) { return false; }
    try {
      await con(t('Deleting branch {0}…', ref), () => repo.deleteBranch(ref, false));
    } catch (e) {
      if (!e || e.gitErrorCode !== 'BranchNotFullyMerged') { throw e; }
      if (!await confirmar(t('Branch {0} is not fully merged. Delete it anyway?', ref),
        t('Its commits that are on no other branch can only be recovered from the reflog.'), t('Delete'))) { return false; }
      await con(t('Deleting branch {0}…', ref), () => repo.deleteBranch(ref, true));
    }
  },

  applyStash: (repo, arg, con) => con(t('Applying stash…'), () => git.usarStash(repo, shaDe(arg), 'apply')),
  popStash: (repo, arg, con) => con(t('Popping stash…'), () => git.usarStash(repo, shaDe(arg), 'pop')),

  async dropStash(repo, arg, con) {
    const sha = shaDe(arg);
    if (!await confirmar(t('Drop this stash?'), t('Its changes can only be recovered by hand from git fsck.'), t('Drop'))) { return false; }
    return con(t('Dropping stash…'), () => git.usarStash(repo, sha, 'drop'));
  },

  // solo rutas que git da como worktree de este repo: el webview podría mandar cualquier cosa
  async openWorktree(repo, arg) {
    const w = (await git.worktrees(repo)).find(x => x.ruta === arg.worktree);
    if (!w) { throw new Error(t('That worktree no longer exists')); }
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(w.ruta), { forceNewWindow: true });
    return false; // no cambia nada de este repo
  },

  async deleteTag(repo, arg, con) {
    const { ref } = await refDe(repo, arg, ['tag']);
    if (!await confirmar(t('Delete tag {0}?', ref), t('Only the local tag is deleted.'), t('Delete'))) { return false; }
    return con(t('Deleting tag {0}…', ref), () => repo.deleteTag(ref));
  },
};

function registrar(context, protegido, vistaDe) {
  for (const [nombre, accion] of Object.entries(ACCIONES)) {
    context.subscriptions.push(vscode.commands.registerCommand(`gitLore.graph.${nombre}`, arg => protegido(async () => {
      const vista = arg && vistaDe(arg.panel);
      if (!vista) { throw new Error(t('The Commit Graph is no longer open')); }
      // con: la parte que espera a git, con la barra del grafo y el aviso en la barra de estado. Las preguntas de
      // antes (nombre, confirmación) no cuentan. Dura hasta que el grafo ha recargado
      let veces = 0;
      const con = (titulo, fn) => {
        veces++;
        vista.ocupado(1);
        return vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: titulo }, fn);
      };
      // crear o borrar una ref no cambia HEAD: el grafo no se enteraría solo. Cancelar no recarga (cerraría el detalle)
      try {
        if (await accion(vista.repo, arg, con) !== false) { await vista.recargar(); }
      } catch (e) {
        await vista.recargar().catch(() => { }); // un conflicto también cambia el repo; el error que cuenta es el de git
        throw motivo(e);
      } finally {
        if (veces) { vista.ocupado(-veces); }
      }
    })));
  }
  context.subscriptions.push(vscode.commands.registerCommand('gitLore.graph.copySha', arg => protegido(() => copiarSha(shaDe(arg || {})))));
}

module.exports = { registrar, shaDe, confirmar };
