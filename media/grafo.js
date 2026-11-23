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
  const alcance = /** @type {HTMLSelectElement} */ (document.getElementById('alcance'));
  const cuenta = document.getElementById('cuenta');
  const fin = document.getElementById('fin');
  const refrescar = document.getElementById('refrescar');
  let filas = [];
  const porSha = new Map();
  let hayMas = false;
  let pidiendo = false;
  let anchoMax = 1;
  /** @type {HTMLElement | null} */
  let detalle = null;

  const x = c => c * CARRIL + CARRIL / 2;
  const y = v => v * ALTO;
  const esFila = n => n && n.classList.contains('fila') && !n.classList.contains('esqueleto');

  function el(tag, clase, texto) {
    const e = document.createElement(tag);
    if (clase) { e.className = clase; }
    if (texto !== undefined) { e.textContent = texto; }
    return e;
  }

  function svg(clase, alto) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', clase);
    s.setAttribute('width', String(anchoMax * CARRIL));
    if (alto) { s.setAttribute('height', String(alto)); }
    s.setAttribute('aria-hidden', 'true');
    return s;
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
    const g = svg('grafo', ALTO);
    f.segmentos.forEach(s => g.appendChild(trazo(s)));
    const nodo = document.createElementNS(NS, 'circle');
    nodo.setAttribute('cx', String(x(f.col)));
    nodo.setAttribute('cy', String(ALTO / 2));
    nodo.setAttribute('r', f.head ? '5' : '4');
    nodo.setAttribute('class', `nodo c${f.col % COLORES}${f.head ? ' head' : ''}${f.pendiente ? ' pendiente' : ''}`);
    g.appendChild(nodo);
    return g;
  }

  // los carriles que salen por abajo de la fila siguen rectos a lo largo del panel de detalles
  function carrilesDe(f) {
    const g = svg('carriles');
    const vistos = new Set();
    f.segmentos.filter(s => s.y2 === 1 && !vistos.has(s.x2) && vistos.add(s.x2)).forEach(s => {
      const l = document.createElementNS(NS, 'line');
      for (const [k, v] of [['x1', x(s.x2)], ['x2', x(s.x2)], ['y1', '0'], ['y2', '100%']]) { l.setAttribute(k, String(v)); }
      l.setAttribute('class', `c${s.carril % COLORES}`);
      g.appendChild(l);
    });
    return g;
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
    r.dataset.busqueda = `${f.resumen} ${f.autor} ${f.refs.join(' ')} ${f.sha}`.toLowerCase();
    if (f.pendiente) {
      r.classList.add('pendiente');
      r.dataset.pendiente = '1';
      r.title = T.verCambios;
      r.append(grafico(f), texto);
      return r;
    }
    const sha = el('button', 'sha', f.sha.slice(0, 7));
    sha.title = T.copiar;
    sha.dataset.accion = 'copiar';
    const fecha = el('span', 'fecha', f.fecha);
    fecha.title = f.fechaCompleta;
    r.append(grafico(f), texto, el('span', 'autor', f.autor), fecha, sha);
    r.setAttribute('aria-expanded', 'false');
    return r;
  }

  function filtrar() {
    const q = buscar.value.trim().toLowerCase();
    let visibles = 0;
    for (const r of lista.querySelectorAll('.fila')) {
      // la fila de cambios sin commit no es un commit: fuera mientras se filtra y fuera de la cuenta
      if ((/** @type {HTMLElement} */ (r)).dataset.pendiente) { (/** @type {HTMLElement} */ (r)).hidden = !!q; continue; }
      const ok = !q || (/** @type {HTMLElement} */ (r)).dataset.busqueda.includes(q);
      (/** @type {HTMLElement} */ (r)).hidden = !ok;
      if (ok) { visibles++; }
    }
    if (detalle) { detalle.hidden = /** @type {HTMLElement} */ (detalle.previousElementSibling).hidden; }
    cuenta.textContent = q ? `${visibles} / ${filas.length}` : `${filas.length}${hayMas ? '+' : ''}`;
  }

  // Con el filtro los grafos dejarían huecos; se ocultan y queda la lista plana
  buscar.addEventListener('input', () => {
    document.body.classList.toggle('filtrando', !!buscar.value.trim());
    filtrar();
  });

  alcance.addEventListener('change', () => {
    cerrarDetalle();
    esqueleto();
    vscode.postMessage({ tipo: 'alcance', valor: alcance.value });
  });

  // filas falsas con la forma de las de verdad; los anchos varían para que no parezca una rejilla
  function esqueletos(n) {
    return Array.from({ length: n }, (_, i) => {
      const r = el('div', 'fila esqueleto');
      r.setAttribute('aria-hidden', 'true');
      r.style.setProperty('--retardo', `${i * 45}ms`);
      const texto = el('span', 'hueso');
      texto.style.width = `${35 + ((i * 37) % 50)}%`;
      r.append(el('span', 'hueso punto'), texto, el('span', 'hueso autor'), el('span', 'hueso fecha'), el('span', 'hueso corto'));
      return r;
    });
  }

  function cargando(si) {
    refrescar.classList.toggle('girando', si);
    lista.setAttribute('aria-busy', String(si));
  }

  function esqueleto() {
    cargando(true);
    lista.replaceChildren(...esqueletos(12));
  }

  function cerrarDetalle() {
    if (!detalle) { return; }
    const r = /** @type {HTMLElement} */ (detalle.previousElementSibling);
    if (r) { r.setAttribute('aria-expanded', 'false'); }
    detalle.remove();
    detalle = null;
  }

  function abrirDetalle(r) {
    const abierto = detalle && detalle.dataset.sha === r.dataset.sha;
    cerrarDetalle();
    if (abierto) { return; }
    detalle = el('div', 'detalle');
    detalle.dataset.sha = r.dataset.sha;
    detalle.setAttribute('role', 'region');
    detalle.setAttribute('aria-busy', 'true');
    const espera = el('div', 'cuerpo cargando');
    const huesos = anchos => {
      const c = el('div');
      anchos.forEach(a => { const h = el('span', 'hueso'); h.style.width = a; c.appendChild(h); });
      return c;
    };
    espera.append(huesos(['55%', '90%', '70%', '40%']), huesos(['45%', '60%', '35%']));
    detalle.append(carrilesDe(porSha.get(r.dataset.sha)), espera);
    r.after(detalle);
    r.setAttribute('aria-expanded', 'true');
    vscode.postMessage({ tipo: 'detalle', sha: r.dataset.sha });
  }

  function pintarDetalle(m) {
    if (!detalle || detalle.dataset.sha !== m.sha) { return; } // respuesta de un commit que ya se cerró
    detalle.removeAttribute('aria-busy');
    const cuerpo = el('div', 'cuerpo');
    if (m.error) {
      cuerpo.appendChild(el('p', 'aviso', m.error));
      detalle.lastElementChild.replaceWith(cuerpo);
      return;
    }
    const info = el('div', 'info');
    info.appendChild(el('p', 'mensaje', m.cuerpo));
    const meta = el('p', 'meta');
    meta.append(el('span', '', m.autor), el('span', '', m.fecha));
    if (m.padres.length) { meta.appendChild(el('span', 'padres', `${T.padres}: ${m.padres.join(', ')}`)); }
    info.appendChild(meta);
    const acciones = el('div', 'acciones');
    const copiar = el('button', 'enlace', T.copiar);
    copiar.dataset.accion = 'copiar';
    acciones.appendChild(copiar);
    if (m.remoto) {
      const remoto = el('button', 'enlace', m.remoto);
      remoto.dataset.accion = 'remoto';
      acciones.appendChild(remoto);
    }
    info.appendChild(acciones);
    const ficheros = el('ul', 'ficheros');
    ficheros.setAttribute('aria-label', T.ficheros);
    m.ficheros.forEach((f, i) => {
      const b = el('button', `fichero e${f.estado}`);
      b.dataset.indice = String(i);
      const corte = f.ruta.lastIndexOf('/');
      b.append(el('span', 'estado', f.estado), el('span', 'nombre', f.ruta.slice(corte + 1)),
        el('span', 'ruta', f.rutaAnterior ? `${f.rutaAnterior} →` : f.ruta.slice(0, Math.max(corte, 0))));
      b.title = f.rutaAnterior ? `${f.rutaAnterior} → ${f.ruta}` : f.ruta;
      const li = el('li');
      li.appendChild(b);
      ficheros.appendChild(li);
    });
    cuerpo.append(info, ficheros);
    detalle.lastElementChild.replaceWith(cuerpo);
  }

  window.addEventListener('message', ({ data: m }) => {
    if (m.tipo === 'error') {
      pidiendo = false;
      cargando(false);
      fin.replaceChildren();
      lista.replaceChildren(el('p', 'aviso', m.mensaje));
      return;
    }
    if (m.tipo === 'detalle') { return pintarDetalle(m); }
    if (m.tipo === 'pendientes') {
      const r = lista.querySelector('.fila.pendiente .resumen');
      if (r) { r.textContent = m.texto; }
      return;
    }
    if (m.tipo !== 'filas') { return; }
    pidiendo = false;
    cargando(false);
    fin.replaceChildren();
    hayMas = m.hayMas;
    const antes = anchoMax;
    anchoMax = Math.max(anchoMax, ...m.filas.map(f => f.ancho));
    if (m.reiniciar) {
      filas = [];
      porSha.clear();
      detalle = null;
      alcance.value = m.alcance;
      lista.replaceChildren();
      document.body.classList.remove('dibujado');
      requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('dibujado')));
    }
    if (anchoMax !== antes && !m.reiniciar) {
      // carriles nuevos: todas las filas comparten ancho de grafo para que las columnas cuadren
      lista.querySelectorAll('svg.grafo, svg.carriles').forEach(s => s.setAttribute('width', String(anchoMax * CARRIL)));
    }
    filas = filas.concat(m.filas.filter(f => !f.pendiente));
    m.filas.forEach(f => porSha.set(f.sha, f));
    const frag = document.createDocumentFragment();
    m.filas.forEach((f, i) => frag.appendChild(fila(f, i)));
    lista.appendChild(frag);
    if (!filas.length) { lista.replaceChildren(el('p', 'aviso', T.sinCommits)); }
    filtrar();
  });

  function avisarCopiado(boton) {
    boton.classList.remove('copiado');
    void boton.offsetWidth;
    boton.classList.add('copiado');
    boton.dataset.texto = T.copiado;
  }

  lista.addEventListener('click', e => {
    const objetivo = /** @type {HTMLElement} */ (e.target);
    const boton = /** @type {HTMLElement | null} */ (objetivo.closest('button'));
    const enDetalle = /** @type {HTMLElement | null} */ (objetivo.closest('.detalle'));
    if (enDetalle) {
      if (!boton) { return; }
      const sha = enDetalle.dataset.sha;
      if (boton.dataset.indice) { return vscode.postMessage({ tipo: 'fichero', sha, indice: Number(boton.dataset.indice) }); }
      if (boton.dataset.accion === 'copiar') { avisarCopiado(boton); }
      return vscode.postMessage({ tipo: boton.dataset.accion, sha });
    }
    const r = /** @type {HTMLElement} */ (objetivo.closest('.fila'));
    if (!esFila(r)) { return; }
    if (r.dataset.pendiente) { return vscode.postMessage({ tipo: 'verCambios' }); }
    if (boton && boton.dataset.accion === 'copiar') {
      vscode.postMessage({ tipo: 'copiar', sha: r.dataset.sha });
      return avisarCopiado(boton);
    }
    lista.querySelectorAll('.seleccionada').forEach(s => s.classList.remove('seleccionada'));
    r.classList.add('seleccionada');
    abrirDetalle(r);
  });

  lista.addEventListener('keydown', e => {
    if (e.key === 'Escape' && detalle) {
      const r = /** @type {HTMLElement} */ (detalle.previousElementSibling);
      cerrarDetalle();
      r.focus();
      return;
    }
    const r = /** @type {HTMLElement} */ (e.target);
    if (!esFila(r)) { return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); r.click(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const paso = n => (e.key === 'ArrowDown' ? n.nextElementSibling : n.previousElementSibling);
      let s = paso(r);
      while (s && (!esFila(s) || (/** @type {HTMLElement} */ (s)).hidden)) { s = paso(s); }
      if (s) { (/** @type {HTMLElement} */ (s)).focus(); }
    }
  });

  refrescar.addEventListener('click', () => {
    cerrarDetalle();
    esqueleto();
    vscode.postMessage({ tipo: 'refrescar' });
  });

  new IntersectionObserver(entradas => {
    if (entradas.some(en => en.isIntersecting) && hayMas && !pidiendo && !buscar.value.trim()) {
      pidiendo = true;
      fin.replaceChildren(...esqueletos(3));
      vscode.postMessage({ tipo: 'mas' });
    }
  }, { rootMargin: '400px' }).observe(fin);

  esqueleto();
  vscode.postMessage({ tipo: 'listo' });
}());
