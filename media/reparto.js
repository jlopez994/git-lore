// @ts-check
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const T = window.TEXTOS;
  const { repartir } = /** @type {any} */ (window).BURBUJAS;
  const NS = 'http://www.w3.org/2000/svg';
  // a partir de aquí las burbujas serían puntos: el resto va junto en «otros»
  const MAX_BURBUJAS = 40;

  const reparto = document.getElementById('reparto');
  const titulo = document.getElementById('titulo');
  const resumen = document.getElementById('resumen');
  const globo = document.getElementById('globo');
  const lengua = document.documentElement.lang || undefined;
  const numero = new Intl.NumberFormat(lengua);
  const compacto = new Intl.NumberFormat(lengua, { notation: 'compact', maximumFractionDigits: 1 });
  const quieto = matchMedia('(prefers-reduced-motion: reduce)');
  /** @type {any} */
  let datos = null;
  /** @type {Record<string, {mas: number, menos: number}> | null} */
  let lineas = null;
  let animar = true;
  let total = 0;
  /** @type {any[]} */
  let grupos = [];
  /** @type {HTMLElement | null} */
  let lienzo = null;
  let pintado = '';

  const fmt = (s, ...v) => v.reduce((r, x, i) => r.replace(`{${i}}`, String(x)), s);
  const cuantos = (n, uno, varios) => (n === 1 ? uno : fmt(varios, numero.format(n)));
  const porcentaje = n => {
    const p = (n / total) * 100;
    return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
  };
  const tono = color => (color === null ? 'otros' : `c${color}`);

  function el(tag, clase, texto) {
    const e = document.createElement(tag);
    if (clase) { e.className = clase; }
    if (texto !== undefined) { e.textContent = texto; }
    return e;
  }

  function svg(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) { e.setAttribute(k, String(v)); }
    return e;
  }

  function agrupar(personas) {
    if (personas.length <= MAX_BURBUJAS) { return personas.map(p => ({ ...p, miembros: [p] })); }
    const propios = personas.slice(0, MAX_BURBUJAS - 1).map(p => ({ ...p, miembros: [p] }));
    const resto = personas.slice(MAX_BURBUJAS - 1);
    return [...propios, { nombre: fmt(T.otros, resto.length), commits: resto.reduce((n, p) => n + p.commits, 0), color: null, miembros: resto }];
  }

  // recorta a lo que cabe dentro del círculo (≈ 7 px por letra a 12 px)
  const cabe = (texto, r) => {
    const n = Math.floor((r * 1.6) / 7);
    return texto.length <= n ? texto : `${texto.slice(0, Math.max(1, n - 1))}…`;
  };

  // radio por raíz de los commits: lo que se compara a ojo es el área
  function dibujarBurbujas() {
    if (!lienzo) { return; }
    const ancho = Math.round(lienzo.clientWidth);
    const alto = Math.round(lienzo.clientHeight);
    if (!ancho || !alto) { return; }
    pintado = `${ancho}x${alto}`;
    const sitios = repartir(grupos.map(g => Math.sqrt(g.commits)), ancho, alto, { hueco: 0.06 * Math.sqrt(grupos[0].commits) });
    const dibujo = svg('svg', { class: 'nube', width: ancho, height: alto, 'aria-hidden': 'true' });
    sitios.forEach((s, i) => {
      const g = grupos[i];
      const b = svg('g', { class: `burbuja ${tono(g.color)}` });
      b.dataset.b = String(i);
      b.style.setProperty('--retardo', `${Math.min(i, 30) * 25}ms`);
      b.appendChild(svg('circle', { cx: s.x, cy: s.y, r: Math.max(2, s.r - 1) }));
      if (s.r >= 28) {
        b.appendChild(svg('text', { x: s.x, y: s.y - 2, class: 'nombre' })).textContent = cabe(g.nombre, s.r);
        b.appendChild(svg('text', { x: s.x, y: s.y + 14, class: 'cuenta' })).textContent = numero.format(g.commits);
      } else if (s.r >= 14) {
        b.appendChild(svg('text', { x: s.x, y: s.y + 4, class: 'cuenta' })).textContent = compacto.format(g.commits);
      }
      dibujo.appendChild(b);
    });
    lienzo.replaceChildren(dibujo);
  }

  // hasOwn: alguien sin correo llamado «constructor» no debe leer lo heredado de Object
  const lineasDe = clave => (lineas && clave && Object.hasOwn(lineas, clave) ? lineas[clave] : null);

  function celdaLineas(td, p) {
    const l = lineasDe(p.clave);
    td.replaceChildren();
    td.removeAttribute('title');
    if (!lineas) { td.textContent = '…'; return; }
    if (!l) { td.textContent = '—'; return; }
    td.title = `+${numero.format(l.mas)} −${numero.format(l.menos)}`;
    td.append(el('span', 'mas', `+${compacto.format(l.mas)}`), el('span', 'menos', ` −${compacto.format(l.menos)}`));
  }

  function pintar() {
    ocultarGlobo();
    reparto.removeAttribute('aria-busy');
    reparto.replaceChildren();
    const personas = datos.personas;
    if (lienzo) { observador.unobserve(lienzo); }
    if (!personas.length) { lienzo = null; reparto.appendChild(el('p', 'aviso', T.sinCommits)); return; }
    total = personas.reduce((n, p) => n + p.commits, 0);
    grupos = agrupar(personas);
    lienzo = el('div', 'lienzo');
    lienzo.style.setProperty('--burbujas', String(grupos.length));

    const tabla = el('table', 'lista');
    tabla.appendChild(el('caption', 'oculto', T.titulo));
    const cabeza = el('tr');
    [[T.autor, 'autor'], [T.columnaCommits, 'num'], ['%', 'num'], [T.lineas, 'num lineas']].forEach(([texto, clase]) => {
      const th = el('th', clase, texto);
      th.scope = 'col';
      cabeza.appendChild(th);
    });
    tabla.appendChild(el('thead')).appendChild(cabeza);
    const cuerpo = tabla.appendChild(el('tbody'));
    const veces = new Map();
    personas.forEach(p => veces.set(p.nombre, (veces.get(p.nombre) || 0) + 1));
    const max = personas[0].commits;
    personas.forEach((p, i) => {
      const fila = el('tr', `persona ${tono(p.color)}`);
      fila.tabIndex = 0;
      fila.dataset.p = String(i);
      fila.dataset.b = String(Math.min(i, grupos.length - 1));
      const autor = el('td', 'autor');
      const nombre = el('span', 'nombre');
      nombre.append(el('span', 'muestra'), el('span', 'texto', p.nombre));
      // dos personas con el mismo nombre solo se distinguen por el correo
      if (veces.get(p.nombre) > 1) { nombre.appendChild(el('span', 'correo', p.correo)); }
      nombre.title = `${p.nombre} <${p.correo}>`;
      const barra = el('span', 'barra');
      const relleno = barra.appendChild(el('i'));
      relleno.style.setProperty('--parte', String(p.commits / max));
      relleno.style.setProperty('--retardo', `${Math.min(i, 20) * 25}ms`);
      autor.append(nombre, barra);
      const lin = el('td', 'num lineas');
      celdaLineas(lin, p);
      fila.append(autor, el('td', 'num', numero.format(p.commits)), el('td', 'num', porcentaje(p.commits)), lin);
      cuerpo.appendChild(fila);
    });

    reparto.append(lienzo, tabla);
    reparto.classList.toggle('animar', animar && !quieto.matches);
    animar = false;
    pintado = ''; // lienzo nuevo: si ahora mide 0 (panel oculto), el ResizeObserver lo dibuja al volver
    observador.observe(lienzo);
    dibujarBurbujas();
  }

  function mostrarGlobo(g, persona) {
    const quien = persona || g;
    const partes = [el('strong', '', quien.nombre)];
    if (quien.correo) { partes.push(el('span', 'suave', quien.correo)); }
    partes.push(el('span', '', `${cuantos(quien.commits, T.unCommit, T.commits)} · ${porcentaje(quien.commits)}`));
    const l = lineasDe(quien.clave);
    if (l) {
      const s = el('span');
      s.append(el('span', 'mas', `+${numero.format(l.mas)}`), el('span', 'menos', ` −${numero.format(l.menos)}`));
      partes.push(s);
    }
    globo.replaceChildren(...partes);
    globo.hidden = false;
    const ancla = reparto.querySelector(`.burbuja[data-b="${grupos.indexOf(g)}"] circle`);
    if (!ancla) { return; }
    const caja = ancla.getBoundingClientRect();
    const m = globo.getBoundingClientRect();
    const izq = Math.min(innerWidth - m.width - 8, Math.max(8, caja.left + caja.width / 2 - m.width / 2));
    const arriba = caja.top - m.height - 8 < 8 ? caja.bottom + 8 : caja.top - m.height - 8;
    globo.style.transform = `translate(${Math.round(izq)}px, ${Math.round(arriba + scrollY)}px)`;
  }

  function ocultarGlobo() { globo.hidden = true; }

  function senalar(fila, burbuja) {
    reparto.querySelectorAll('.activo').forEach(e => e.classList.remove('activo'));
    reparto.classList.toggle('enfocando', burbuja !== null);
    if (burbuja === null) { ocultarGlobo(); return; }
    const g = grupos[burbuja];
    reparto.querySelector(`.burbuja[data-b="${burbuja}"]`)?.classList.add('activo');
    const filas = fila !== null ? [fila] : g.miembros.map(p => datos.personas.indexOf(p));
    filas.forEach(i => reparto.querySelector(`tr[data-p="${i}"]`)?.classList.add('activo'));
    mostrarGlobo(g, fila !== null ? datos.personas[fila] : g.miembros.length === 1 ? g.miembros[0] : null);
  }

  function objetivo(e) {
    const t = /** @type {Element} */ (e.target);
    const fila = t.closest && t.closest('tr[data-p]');
    if (fila) { return [Number(/** @type {HTMLElement} */ (fila).dataset.p), Number(/** @type {HTMLElement} */ (fila).dataset.b)]; }
    const b = t.closest && t.closest('.burbuja');
    if (b) { return [null, Number(/** @type {HTMLElement} */ (b).dataset.b)]; }
    return null;
  }

  reparto.addEventListener('pointerover', e => {
    const o = objetivo(e);
    if (o) { senalar(o[0], o[1]); }
  });
  reparto.addEventListener('pointerout', e => {
    const a = /** @type {Element} */ (e.relatedTarget);
    if (!(a && a.closest && (a.closest('tr[data-p]') || a.closest('.burbuja')))) { senalar(null, null); }
  });
  reparto.addEventListener('focusin', e => {
    const o = objetivo(e);
    if (o) { senalar(o[0], o[1]); }
  });
  reparto.addEventListener('focusout', e => {
    if (!reparto.contains(/** @type {Node} */ (e.relatedTarget))) { senalar(null, null); }
  });
  // flechas: de una persona a la siguiente sin tabular por toda la lista
  reparto.addEventListener('keydown', e => {
    const fila = /** @type {Element} */ (e.target).closest('tr[data-p]');
    const destino = fila && { ArrowDown: fila.nextElementSibling, ArrowUp: fila.previousElementSibling }[e.key];
    if (destino) { e.preventDefault(); /** @type {HTMLElement} */ (destino).focus(); }
  });

  // el alto también depende de la ventana (vh); un panel abierto oculto mide 0 y se dibuja cuando se ve
  let espera;
  const observador = new ResizeObserver(() => {
    if (!lienzo) { return; }
    const w = Math.round(lienzo.clientWidth);
    const h = Math.round(lienzo.clientHeight);
    if (!w || !h || `${w}x${h}` === pintado) { return; }
    clearTimeout(espera);
    espera = setTimeout(() => { ocultarGlobo(); dibujarBurbujas(); }, 80);
  });

  window.addEventListener('message', ({ data: m }) => {
    if (m.tipo === 'error') {
      reparto.removeAttribute('aria-busy');
      reparto.replaceChildren(el('p', 'aviso', m.mensaje));
      return;
    }
    if (m.tipo === 'lineas') {
      lineas = m.lineas;
      reparto.querySelectorAll('tr[data-p]').forEach(f => {
        celdaLineas(/** @type {HTMLElement} */ (f.querySelector('td.lineas')), datos.personas[Number(/** @type {HTMLElement} */ (f).dataset.p)]);
      });
      return;
    }
    if (m.tipo !== 'personas') { return; }
    datos = m;
    lineas = null;
    titulo.textContent = m.repo;
    const suma = m.personas.reduce((n, p) => n + p.commits, 0);
    const partes = [cuantos(suma, T.unCommit, T.commits), cuantos(m.personas.length, T.unAutor, T.autores)];
    if (m.rama) { partes.push(fmt(T.enRama, m.rama)); }
    resumen.textContent = partes.join(' · ');
    pintar();
  });

  vscode.postMessage({ tipo: 'listo' });
}());
