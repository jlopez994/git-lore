'use strict';
// node --test test/
const test = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parsearBlame, parsearLog, parsearDiff, desentrecomillar, FORMATO_LOG } = require('../src/nucleo/parseo');
const { webDeRemoto, urlDeCommit, elegirRemoto } = require('../src/nucleo/remotos');
const { trazarGrafo } = require('../src/nucleo/grafo');
const { fechaRelativa, calor } = require('../src/nucleo/tiempo');

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'git-lore-'));
const git = (...args) => cp.execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: raiz, encoding: 'utf8' });
const escribir = (f, t) => fs.writeFileSync(path.join(raiz, f), t);
const commit = (msg, autor = 'Ana') => git('-c', `user.name=${autor}`, '-c', 'user.email=a@example.com', 'commit', '-qam', msg);

git('init', '-q', '-b', 'main');
escribir('a.txt', 'uno\ndos\ntres\n');
git('add', '-A');
commit('primero');
escribir('a.txt', 'uno\nDOS\ntres\n');
commit('segundo', 'Bea');
git('mv', 'a.txt', 'b con espacio.txt');
commit('renombrar');

test('blame: un sha por línea y datos del commit', () => {
  const { lineas, commits } = parsearBlame(git('blame', '--porcelain', '--', 'b con espacio.txt'));
  assert.strictEqual(lineas.length, 3);
  assert.strictEqual(lineas[0], lineas[2]);
  assert.notStrictEqual(lineas[0], lineas[1]);
  const c = commits.get(lineas[1]);
  assert.strictEqual(c.autor, 'Bea');
  assert.strictEqual(c.resumen, 'segundo');
  assert.strictEqual(c.correo, 'a@example.com');
  assert.strictEqual(c.fichero, 'a.txt');
  assert.ok(c.anterior && c.ficheroAnterior === 'a.txt');
  assert.ok(c.fecha > 1e12);
});

test('blame con --contents marca las líneas sin commit', () => {
  const salida = cp.execFileSync('git', ['blame', '--porcelain', '--contents', '-', '--', 'b con espacio.txt'],
    { cwd: raiz, encoding: 'utf8', input: 'uno\nnueva\nDOS\ntres\n' });
  const { lineas, commits } = parsearBlame(salida);
  assert.strictEqual(lineas.length, 4);
  assert.strictEqual(commits.get(lineas[1]).sinCommit, true);
  assert.strictEqual(commits.get(lineas[0]).sinCommit, false);
});

test('log con --follow da la ruta de cada commit', () => {
  const log = parsearLog(git('log', '--follow', '-M', '--name-status', `--format=${FORMATO_LOG}`, '--', 'b con espacio.txt'));
  assert.deepStrictEqual(log.map(c => c.resumen), ['renombrar', 'segundo', 'primero']);
  assert.deepStrictEqual(log[0].ficheros[0], { estado: 'R', rutaAnterior: 'a.txt', ruta: 'b con espacio.txt' });
  assert.strictEqual(log[1].ficheros[0].ruta, 'a.txt');
  assert.strictEqual(log[2].padres.length, 0);
  assert.strictEqual(log[1].padres[0], log[2].sha);
  assert.ok(log[0].refs.some(r => r.includes('main')));
});

test('log -L de una línea ignora el parche', () => {
  const log = parsearLog(git('log', '-L', '2,2:b con espacio.txt', `--format=${FORMATO_LOG}`));
  assert.deepStrictEqual(log.map(c => c.resumen), ['segundo', 'primero']);
});

test('diff --name-status', () => {
  const d = parsearDiff('M\tx.js\nR087\tviejo.js\tnuevo.js\nA\t"a\\303\\261o.txt"\n');
  assert.deepStrictEqual(d, [
    { estado: 'M', ruta: 'x.js' },
    { estado: 'R', rutaAnterior: 'viejo.js', ruta: 'nuevo.js' },
    { estado: 'A', ruta: 'año.txt' },
  ]);
  assert.strictEqual(desentrecomillar('"tab\\there"'), 'tab\there');
  assert.strictEqual(desentrecomillar('"🎉 \\"x\\""'), '🎉 "x"');
});

test('remotos → web', () => {
  const casos = {
    'git@github.com:jlopez994/git-lore.git': 'https://github.com/jlopez994/git-lore/commit/abc',
    'https://github.com/jlopez994/git-lore': 'https://github.com/jlopez994/git-lore/commit/abc',
    'ssh://git@gitlab.example.com:2222/grupo/sub/repo.git': 'https://gitlab.example.com/grupo/sub/repo/-/commit/abc',
    'https://user@bitbucket.org/eq/repo.git': 'https://bitbucket.org/eq/repo/commits/abc',
    'git@ssh.dev.azure.com:v3/org/proy/repo': 'https://dev.azure.com/org/proy/_git/repo/commit/abc',
    'https://git.example.org/a/b.git': 'https://git.example.org/a/b/commit/abc',
  };
  for (const [remoto, esperado] of Object.entries(casos)) {
    assert.strictEqual(urlDeCommit(webDeRemoto(remoto), 'abc'), esperado, remoto);
  }
  assert.strictEqual(webDeRemoto('/ruta/local/repo'), null);
  assert.strictEqual(webDeRemoto('git@github.com:a/b) [x](https://evil'), null);
  assert.strictEqual(webDeRemoto('git@ssh.dev.azure.com:v3/org'), null);
  assert.strictEqual(webDeRemoto('file:///ruta/local'), null);
  const r = [{ name: 'fork', fetchUrl: 'x' }, { name: 'origin', fetchUrl: 'y' }];
  assert.strictEqual(elegirRemoto(r, undefined).name, 'origin');
  assert.strictEqual(elegirRemoto(r, 'fork').name, 'fork');
});

test('grafo: lineal en un carril, rama y merge en dos', () => {
  const lineal = trazarGrafo([{ sha: 'c', padres: ['b'] }, { sha: 'b', padres: ['a'] }, { sha: 'a', padres: [] }]);
  assert.deepStrictEqual(lineal.filas.map(f => f.col), [0, 0, 0]);
  assert.deepStrictEqual(lineal.carriles, []);

  // m = merge(d, f); d → b; f → b; b → a
  const { filas } = trazarGrafo([
    { sha: 'm', padres: ['d', 'f'] },
    { sha: 'f', padres: ['b'] },
    { sha: 'd', padres: ['b'] },
    { sha: 'b', padres: ['a'] },
    { sha: 'a', padres: [] },
  ]);
  assert.deepStrictEqual(filas.map(f => f.col), [0, 1, 0, 0, 0]);
  assert.ok(filas[0].segmentos.some(s => s.y1 === 0.5 && s.x2 === 1), 'el merge abre el carril 1');
  assert.ok(filas[2].segmentos.some(s => s.x1 === 1 && s.x2 === 0 && s.y2 === 1), 'el carril 1 se funde en el 0 camino de b');
  assert.strictEqual(filas[4].ancho, 1);
});

test('grafo: continúa desde los carriles de la página anterior', () => {
  const todos = [{ sha: 'm', padres: ['d', 'f'] }, { sha: 'f', padres: ['b'] }, { sha: 'd', padres: ['b'] }, { sha: 'b', padres: [] }];
  const entero = trazarGrafo(todos).filas.map(f => f.col);
  const p1 = trazarGrafo(todos.slice(0, 2));
  const p2 = trazarGrafo(todos.slice(2), p1.carriles);
  assert.deepStrictEqual([...p1.filas, ...p2.filas].map(f => f.col), entero);
});

test('grafo: la fila de cambios sin commit cae en HEAD aunque HEAD no sea la primera', () => {
  // x es la punta de otra rama, más reciente que HEAD (h)
  const { filas } = trazarGrafo([
    { sha: 'pendientes', padres: ['h'] },
    { sha: 'x', padres: ['b'] },
    { sha: 'h', padres: ['b'] },
    { sha: 'b', padres: [] },
  ]);
  assert.deepStrictEqual(filas.map(f => f.col), [0, 1, 0, 0]);
  assert.ok(filas[1].segmentos.some(s => s.x1 === 0 && s.x2 === 0 && s.y1 === 0 && s.y2 === 1), 'el carril 0 baja recto hasta HEAD');
});

test('tiempo', () => {
  const ahora = Date.UTC(2026, 10, 23);
  assert.strictEqual(fechaRelativa(ahora - 3 * 86400000, ahora, 'en'), '3 days ago');
  assert.strictEqual(fechaRelativa(ahora - 400 * 86400000, ahora, 'es'), 'el año pasado');
  assert.ok(calor(ahora, ahora) === 1 && calor(ahora - 800 * 86400000, ahora) === 0);
  assert.ok(calor(ahora - 7 * 86400000, ahora) > calor(ahora - 60 * 86400000, ahora));
});

test.after(() => fs.rmSync(raiz, { recursive: true, force: true }));

test('cada texto de la interfaz tiene traducción al español', () => {
  const es = require('../l10n/bundle.l10n.es.json');
  const fuentes = ['extension.js', ...fs.readdirSync(path.join(__dirname, '../src')).filter(f => f.endsWith('.js')).map(f => `src/${f}`)];
  const textos = new Set();
  for (const f of fuentes) {
    for (const m of fs.readFileSync(path.join(__dirname, '..', f), 'utf8').matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) { textos.add(m[1]); }
  }
  assert.ok(textos.size > 20);
  assert.deepStrictEqual([...textos].filter(x => !(x in es)), []);
  const nls = require('../package.nls.json');
  const nlsEs = require('../package.nls.es.json');
  assert.deepStrictEqual(Object.keys(nlsEs).sort(), Object.keys(nls).sort());
  const claves = [...fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8').matchAll(/"%([^%]+)%"/g)].map(m => m[1]);
  assert.deepStrictEqual(claves.filter(k => !(k in nls)), []);
});

test('refs: tipo por el prefijo completo, no por la barra', () => {
  const { clasificarRef, ramaLocalDe } = require('../src/nucleo/refs');
  assert.deepStrictEqual(clasificarRef('HEAD -> refs/heads/feat/x'), { nombre: 'feat/x', tipo: 'rama', esHead: true });
  assert.deepStrictEqual(clasificarRef('refs/remotes/origin/main'), { nombre: 'origin/main', tipo: 'remota', esHead: false });
  assert.deepStrictEqual(clasificarRef('tag: refs/tags/v1.0'), { nombre: 'v1.0', tipo: 'tag', esHead: false });
  assert.strictEqual(clasificarRef('HEAD'), null);
  assert.strictEqual(clasificarRef('refs/remotes/origin/HEAD'), null);
  assert.strictEqual(clasificarRef('refs/stash'), null);
  assert.strictEqual(ramaLocalDe('origin/feat/x', ['origin']), 'feat/x');
  assert.strictEqual(ramaLocalDe('mi/remoto/main', ['mi', 'mi/remoto']), 'main');
});

test('refs: nombres de rama o tag que git no aceptaría', () => {
  const { nombreValido } = require('../src/nucleo/refs');
  for (const ok of ['feat/x', 'v1.2.0', 'arreglo-ñ']) { assert.ok(nombreValido(ok), ok); }
  for (const mal of ['-x', 'a b', 'a..b', 'a~1', 'x.lock', 'x/', '/x', 'a//b', 'a/.b', 'x@{1}', 'a:b', 'x.']) {
    assert.ok(!nombreValido(mal), mal);
  }
});

test('historia: numstat por commit, con binarios', () => {
  const { parsearNumstat } = require('../src/nucleo/parseo');
  const l = parsearNumstat('\x1eaaa\n\n3\t1\ta.txt\n\x1ebbb\n\n-\t-\tlogo.png\n\x1eccc\n');
  assert.deepStrictEqual(l.get('aaa'), { mas: 3, menos: 1, binario: false });
  assert.deepStrictEqual(l.get('bbb'), { mas: 0, menos: 0, binario: true });
  assert.deepStrictEqual(l.get('ccc'), { mas: 0, menos: 0, binario: false });
  // real: el commit «segundo» cambió una línea de a.txt
  const real = parsearNumstat(git('log', '--follow', '--numstat', '--format=%x1e%H', '--', 'b con espacio.txt'));
  assert.strictEqual(real.size, 3);
  assert.ok([...real.values()].some(v => v.mas === 1 && v.menos === 1));
});

test('historia: autores por correo, ordenados y con «otros» a partir del máximo', () => {
  const { agruparAutores } = require('../src/nucleo/historia');
  const c = (autor, correo) => ({ autor, correo });
  const commits = [c('Ana', 'a@x'), c('Ana López', 'A@x'), c('Bea', 'b@x'), c('Ana', 'a@x'), c('Cris', 'c@x'), c('Dani', 'd@x')];
  const { autores, filaDe } = agruparAutores(commits, 3);
  assert.deepStrictEqual(autores.map(a => [a.nombre, a.commits, a.color]), [['Ana', 3, 0], ['Bea', 1, 1], [null, 2, null]]);
  assert.strictEqual(autores[2].otros, 2);
  assert.deepStrictEqual(commits.map(filaDe), [0, 0, 1, 0, 2, 2]);
  assert.strictEqual(agruparAutores(commits, 8).autores.length, 4);
  // con justo max autores no hay color para el último: cae en «otros»
  const cuatro = agruparAutores(commits, 4).autores;
  assert.deepStrictEqual(cuatro.map(a => a.color), [0, 1, 2, null]);
  assert.ok(cuatro.every(a => a.color === null || a.color < 3));
});

test('stash: parseo de stash list y colocación sobre su base', () => {
  const { parsearStash, parsearWorktrees, FORMATO_STASH } = require('../src/nucleo/parseo');
  const { intercalarStashes } = require('../src/nucleo/grafo');
  escribir('b con espacio.txt', 'cambio sin commit\n');
  git('-c', 'user.name=Ana', '-c', 'user.email=a@example.com', 'stash', 'push', '-q', '-m', 'a medias');
  const [s] = parsearStash(git('stash', 'list', `--format=${FORMATO_STASH}`));
  assert.strictEqual(s.nombre, 'stash@{0}');
  assert.match(s.resumen, /a medias/);
  assert.strictEqual(s.base, git('rev-parse', 'HEAD').trim());
  git('stash', 'drop', '-q');

  const c = (sha, fecha) => ({ sha, fecha, padres: [] });
  const commits = [c('h', 50), c('b', 30), c('a', 10)];
  const nuevo = { sha: 's1', base: 'a', fecha: 40 }; // más nuevo que b: va antes de b aunque su base sea a
  const viejo = { sha: 's2', base: 'b', fecha: 5 }; // más viejo que todo: como muy tarde encima de su base
  const fuera = { sha: 's3', base: 'zz', fecha: 60 }; // base en otra página: no se coloca todavía
  const { lista, colocados } = intercalarStashes(commits, [viejo, nuevo, fuera]);
  assert.deepStrictEqual(lista.map(x => x.sha), ['h', 's1', 's2', 'b', 'a']);
  assert.deepStrictEqual(lista[1].padres, ['a']);
  assert.ok(lista[1].stash && !colocados.has('s3'));

  const wts = parsearWorktrees('worktree /r\nHEAD 111\nbranch refs/heads/main\n\nworktree /r-wt\nHEAD 222\ndetached\n\nworktree /bare\nbare\n\nworktree /borrado\nHEAD 333\nprunable gitdir file points to non-existent location\n');
  assert.deepStrictEqual(wts, [{ ruta: '/r', head: '111', rama: 'main' }, { ruta: '/r-wt', head: '222' }]);
});

test('historia: un merge sin name-status toma la ruta del commit anterior, no la actual', () => {
  const { cambiosDe } = require('../src/nucleo/historia');
  const commits = [ // de nuevo a viejo, como git log
    { sha: 'c3', padres: ['c2'], ficheros: [{ estado: 'M', ruta: 'nuevo.txt' }] },
    { sha: 'c2', padres: ['c1'], ficheros: [{ estado: 'R', ruta: 'nuevo.txt', rutaAnterior: 'viejo.txt' }] },
    { sha: 'm', padres: ['c0', 'x'], ficheros: [] },
    { sha: 'c0', padres: [], ficheros: [{ estado: 'A', ruta: 'viejo.txt' }] },
  ];
  const c = cambiosDe(commits, 'nuevo.txt');
  assert.strictEqual(c.get('m').ruta, 'viejo.txt');
  assert.strictEqual(c.get('c2').rutaAnterior, 'viejo.txt');
  assert.strictEqual(c.get('c0').refAnterior, null);
});

test('contribuidores: shortlog agrupado por correo, con el nombre más usado', () => {
  const { parsearShortlog } = require('../src/nucleo/parseo');
  const a = parsearShortlog('    10\tAna López <ana@x.com>\n     3\tBea <bea@x.com>\n     2\tana <ANA@x.com>\n');
  assert.deepStrictEqual(a, [{ nombre: 'Ana López', correo: 'ana@x.com', commits: 12 }, { nombre: 'Bea', correo: 'bea@x.com', commits: 3 }]);
  // real: en el repo de prueba Ana (2) y Bea (1) firman con el mismo correo, así que son una persona: Ana
  const real = parsearShortlog(git('shortlog', '-sne', 'HEAD'));
  assert.deepStrictEqual(real.map(x => [x.nombre, x.commits]), [['Ana', 3]]);
});
