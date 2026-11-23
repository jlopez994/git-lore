// @ts-check
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const T = window.TEXTOS;
  const ALTO = 28;
  const CARRIL = 16;
  const NS = 'http://www.w3.org/2000/svg';
  const COLORES = 8;

  const lista = document.getElementById('lista');
  const buscar = /** @type {HTMLInputElement} */ (document.getElementById('buscar'));
  const cuenta = document.getElementById('cuenta');
  const fin = document.getElementById('fin');
  let filas = [];
  let hayMas = false;
  let pidiendo = false;
  let anchoMax = 1;

  const x = c => c * CARRIL + CARRIL / 2;
  const y = v => v * ALTO;

  function el(tag, clase, texto) {
    const e = document.createElement(tag);
    if (clase) { e.className = clase; }
    if (texto !== undefined) { e.textContent = texto; }
    return e;
  }

  function trazo(s) {
    const p = document.createElementNS(NS, 'path');
    const [x1, y1, x2, y2] = [x(s.x1), y(s.y1), x(s.x2), y(s.y2)];
    const m = (y1 + y2) / 2;
    p.setAttribute('d', x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${m} ${x2} ${m} ${x2} ${y2}`);
    p.setAttribute('class', `c${s.carril % COLORES}`);
    p.setAttribute('pathLength', '1');
    return p;
  }

  function grafico(f) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'grafo');
    svg.setAttribute('width', String(anchoMax * CARRIL));
    svg.setAttribute('height', String(ALTO));
    svg.setAttribute('aria-hidden', 'true');
    f.segmentos.forEach(s => svg.appendChild(trazo(s)));
    const nodo = document.createElementNS(NS, 'circle');
    nodo.setAttribute('cx', String(x(f.col)));
    nodo.setAttribute('cy', String(ALTO / 2));
    nodo.setAttribute('r', f.head ? '5' : '4');
    nodo.setAttribute('class', `nodo c${f.col % COLORES}${f.head ? ' head' : ''}`);
    svg.appendChild(nodo);
    return svg;
  }

  function insignia(ref) {
    const head = ref.startsWith('HEAD -> ');
    const nombre = head ? ref.slice(8) : ref;
    const tipo = nombre.startsWith('tag: ') ? 'tag' : head ? 'head' : nombre.includes('/') ? 'remota' : 'rama';
    return el('span', `ref ${tipo}`, nombre.replace(/^tag: /, ''));
  }

  function fila(f, i) {
    const r = el('div', 'fila');
    r.setAttribute('role', 'listitem');
    r.tabIndex = 0;
    r.dataset.sha = f.sha;
    r.style.setProperty('--retardo', `${Math.min(i, 20) * 30}ms`);
    if (f.head) { r.classList.add('es-head'); }
    const texto = el('div', 'texto');
    f.refs.filter(ref => ref !== 'HEAD' && !ref.endsWith('/HEAD')).forEach(ref => texto.appendChild(insignia(ref)));
    texto.appendChild(el('span', 'resumen', f.resumen));
    const sha = el('button', 'sha', f.sha.slice(0, 7));
    sha.title = T.copiar;
    sha.dataset.accion = 'copiar';
    const fecha = el('span', 'fecha', f.fecha);
    fecha.title = f.fechaCompleta;
    r.append(grafico(f), texto, el('span', 'autor', f.autor), fecha, sha);
    r.dataset.busqueda = `${f.resumen} ${f.autor} ${f.refs.join(' ')} ${f.sha}`.toLowerCase();
    return r;
  }

  function filtrar() {
    const q = buscar.value.trim().toLowerCase();
    let visibles = 0;
    for (const r of lista.children) {
      const ok = !q || (/** @type {HTMLElement} */ (r)).dataset.busqueda.includes(q);
      (/** @type {HTMLElement} */ (r)).hidden = !ok;
      if (ok) { visibles++; }
    }
    cuenta.textContent = q ? `${visibles} / ${filas.length}` : `${filas.length}${hayMas ? '+' : ''}`;
  }

  // Con el filtro los grafos dejarían huecos; se ocultan y queda la lista plana
  buscar.addEventListener('input', () => {
    document.body.classList.toggle('filtrando', !!buscar.value.trim());
    filtrar();
  });

  function esqueleto() {
    lista.replaceChildren(...Array.from({ length: 12 }, () => el('div', 'fila esqueleto')));
  }

  window.addEventListener('message', ({ data: m }) => {
    if (m.tipo === 'error') {
      pidiendo = false;
      lista.replaceChildren(el('p', 'aviso', m.mensaje));
      return;
    }
    if (m.tipo !== 'filas') { return; }
    pidiendo = false;
    hayMas = m.hayMas;
    const antes = anchoMax;
    anchoMax = Math.max(anchoMax, ...m.filas.map(f => f.ancho));
    if (m.reiniciar) {
      filas = [];
      lista.replaceChildren();
      document.body.classList.remove('dibujado');
      requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('dibujado')));
    }
    if (anchoMax !== antes && !m.reiniciar) {
      // carriles nuevos: todas las filas comparten ancho de grafo para que las columnas cuadren
      lista.querySelectorAll('svg.grafo').forEach(s => s.setAttribute('width', String(anchoMax * CARRIL)));
    }
    filas = filas.concat(m.filas);
    const frag = document.createDocumentFragment();
    m.filas.forEach((f, i) => frag.appendChild(fila(f, i)));
    lista.appendChild(frag);
    if (!filas.length) { lista.replaceChildren(el('p', 'aviso', T.sinCommits)); }
    filtrar();
  });

  lista.addEventListener('click', e => {
    const objetivo = /** @type {HTMLElement} */ (e.target);
    const r = /** @type {HTMLElement} */ (objetivo.closest('.fila'));
    if (!r || !r.dataset.sha) { return; }
    if (objetivo.dataset.accion === 'copiar') {
      vscode.postMessage({ tipo: 'copiar', sha: r.dataset.sha });
      objetivo.classList.remove('copiado');
      void objetivo.offsetWidth;
      objetivo.classList.add('copiado');
      objetivo.dataset.texto = T.copiado;
      return;
    }
    lista.querySelectorAll('.seleccionada').forEach(s => s.classList.remove('seleccionada'));
    r.classList.add('seleccionada');
    vscode.postMessage({ tipo: 'commit', sha: r.dataset.sha });
  });
  lista.addEventListener('keydown', e => {
    const r = /** @type {HTMLElement} */ (e.target);
    if (!r.classList || !r.classList.contains('fila')) { return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); r.click(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      let s = e.key === 'ArrowDown' ? r.nextElementSibling : r.previousElementSibling;
      while (s && (/** @type {HTMLElement} */ (s)).hidden) { s = e.key === 'ArrowDown' ? s.nextElementSibling : s.previousElementSibling; }
      if (s) { (/** @type {HTMLElement} */ (s)).focus(); }
    }
  });

  document.getElementById('refrescar').addEventListener('click', () => {
    esqueleto();
    vscode.postMessage({ tipo: 'refrescar' });
  });

  new IntersectionObserver(entradas => {
    if (entradas.some(en => en.isIntersecting) && hayMas && !pidiendo && !buscar.value.trim()) {
      pidiendo = true;
      vscode.postMessage({ tipo: 'mas' });
    }
  }, { rootMargin: '400px' }).observe(fin);

  esqueleto();
  vscode.postMessage({ tipo: 'listo' });
}());
