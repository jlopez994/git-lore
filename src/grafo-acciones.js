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
  async checkout(repo, arg) {
    if (arg.webviewSection === 'commit') { return repo.checkout(shaDe(arg)); }
    const { ref, refs } = await refDe(repo, arg, ['rama', 'remota', 'tag']);
    if (arg.tipo !== 'remota') { return repo.checkout(ref); }
    // origin/x → x local que sigue a origin/x (o la que ya había)
    const local = ramaLocalDe(ref, repo.state.remotes.map(r => r.name));
    if (refs.some(r => r.completo === PREFIJO.rama + local)) { return repo.checkout(local); }
    await repo.createBranch(local, true, ref);
    return repo.setBranchUpstream(local, ref); // createBranch de la API la deja sin seguimiento
  },

  async createBranch(repo, arg) {
    const sha = shaDe(arg);
    const nombre = await pedirNombre(t('Create branch at {0}', corto(sha)));
    if (!nombre) { return false; }
    return repo.createBranch(nombre, true, sha);
  },

  async createTag(repo, arg) {
    const sha = shaDe(arg);
    const nombre = await pedirNombre(t('Create tag at {0}', corto(sha)));
    if (!nombre) { return false; }
    return git.crearTag(repo, nombre, sha);
  },

  async merge(repo, arg) {
    const { ref } = await refDe(repo, arg, ['rama', 'remota']);
    return repo.merge(ref);
  },

  cherryPick: (repo, arg) => git.cherryPick(repo, shaDe(arg)),
  revert: (repo, arg) => git.revertir(repo, shaDe(arg)),

  async reset(repo, arg) {
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
    return git.resetear(repo, sha, modo.modo);
  },

  async deleteBranch(repo, arg) {
    const { ref } = await refDe(repo, arg, ['rama']);
    if (!await confirmar(t('Delete branch {0}?', ref), undefined, t('Delete'))) { return false; }
    try {
      await repo.deleteBranch(ref, false);
    } catch (e) {
      if (!e || e.gitErrorCode !== 'BranchNotFullyMerged') { throw e; }
      if (!await confirmar(t('Branch {0} is not fully merged. Delete it anyway?', ref),
        t('Its commits that are on no other branch can only be recovered from the reflog.'), t('Delete'))) { return false; }
      await repo.deleteBranch(ref, true);
    }
  },

  async deleteTag(repo, arg) {
    const { ref } = await refDe(repo, arg, ['tag']);
    if (!await confirmar(t('Delete tag {0}?', ref), t('Only the local tag is deleted.'), t('Delete'))) { return false; }
    return repo.deleteTag(ref);
  },
};

function registrar(context, protegido, vistaDe) {
  for (const [nombre, accion] of Object.entries(ACCIONES)) {
    context.subscriptions.push(vscode.commands.registerCommand(`gitLore.graph.${nombre}`, arg => protegido(async () => {
      const vista = arg && vistaDe(arg.panel);
      if (!vista) { throw new Error(t('The Commit Graph is no longer open')); }
      // crear o borrar una ref no cambia HEAD: el grafo no se enteraría solo. Cancelar no recarga (cerraría el detalle)
      let hecho;
      try {
        hecho = await accion(vista.repo, arg);
      } catch (e) {
        vista.recargar(); // un conflicto también cambia el repo
        throw motivo(e);
      }
      if (hecho !== false) { vista.recargar(); }
    })));
  }
  context.subscriptions.push(vscode.commands.registerCommand('gitLore.graph.copySha', arg => protegido(() => copiarSha(shaDe(arg || {})))));
}

module.exports = { registrar };
