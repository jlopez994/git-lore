// @ts-check
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const T = window.TEXTOS;
  const NS = 'http://www.w3.org/2000/svg';
  const FILA = 34;
  const BARRAS = 84;
  const MARGEN = 14;

  const grafica = document.getElementById('grafica');
  const globo = document.getElementById('globo');
  const titulo = document.getElementById('titulo');
  const resumen = document.getElementById('resumen');
  /** @type {any} */
  let datos = null;
  let animar = true;
  /** @type {SVGElement[]} */
  let puntos = [];
  let activo = 0;

  const fmt = (s, ...v) => v.reduce((r, x, i) => r.replace(`{${i}}`, String(x)), s);
  const lengua = document.documentElement.lang || undefined;

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

  // marcas de tiempo en límites de calendario (año, trimestre, mes o día) que quepan sin pisarse
  function marcas(min, max, ancho) {
    const DIA = 864e5;
    const caben = Math.max(2, Math.floor(ancho / 90));
    const pasos = [[1, 'd'], [7, 'd'], [1, 'm'], [3, 'm'], [6, 'm'], [1, 'y'], [2, 'y'], [5, 'y']];
    const largo = { d: DIA, m: 30.4 * DIA, y: 365.25 * DIA };
    const [n, u] = pasos.find(([k, v]) => (max - min) / (k * largo[v]) <= caben) || pasos[pasos.length - 1];
    const f = new Date(min);
    if (u === 'd') { f.setHours(0, 0, 0, 0); f.setDate(f.getDate() + 1); } else if (u === 'm') { f.setHours(0, 0, 0, 0); f.setDate(1); f.setMonth(Math.floor(f.getMonth() / n) * n + n); } else { f.setHours(0, 0, 0, 0); f.setMonth(0, 1); f.setFullYear(Math.floor(f.getFullYear() / n) * n + n); }
    const formato = new Intl.DateTimeFormat(lengua, u === 'y' ? { year: 'numeric' } : u === 'm' ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' });
    const r = [];
    while (f.getTime() <= max && r.length < 40) {
      r.push({ t: f.getTime(), texto: formato.format(f) });
      if (u === 'd') { f.setDate(f.getDate() + n); } else if (u === 'm') { f.setMonth(f.getMonth() + n); } else { f.setFullYear(f.getFullYear() + n); }
    }
    return r;
  }

  function pintar() {
    if (!datos) { return; }
    ocultarGlobo(); // el punto que lo abrió va a desaparecer y su focusout no siempre llega
    const conFoco = grafica.contains(document.activeElement);
    const { commits, autores } = datos;
    grafica.replaceChildren();
    grafica.removeAttribute('aria-busy');
    if (!commits.length) { grafica.appendChild(el('p', 'aviso', T.sinCommits)); return; }

    const lienzo = el('div', 'lienzo');
    const etiquetas = el('div', 'autores');
    const zona = el('div', 'zona');
    lienzo.append(etiquetas, zona);
    grafica.appendChild(lienzo);
    const ancho = Math.max(120, zona.clientWidth);
    const fechas = commits.map(c => c.fecha);
    const min = Math.min(...fechas);
    const max = Math.max(...fechas);
    const x = f => (max === min ? ancho / 2 : MARGEN + ((f - min) / (max - min)) * (ancho - 2 * MARGEN));
    const alto = autores.length * FILA;
    const ticks = marcas(min, max, ancho);

    autores.forEach((a, i) => {
      const fila = el('div', `autor${a.color === null ? ' otros' : ` c${a.color}`}`);
      fila.dataset.fila = String(i);
      const nombre = a.color === null ? fmt(T.otros, a.otros) : a.nombre;
      fila.append(el('span', 'muestra'), el('span', 'nombre', nombre), el('span', 'cuenta', String(a.commits)));
      fila.title = `${nombre} · ${fmt(T.commits, a.commits)}`;
      etiquetas.appendChild(fila);
    });
    const leyenda = el('div', 'autor leyenda-lineas');
    leyenda.append(el('span', 'nombre', T.lineas), el('span', 'cuenta signos', ''));
    leyenda.lastElementChild.append(el('b', 'mas', '+'), el('b', 'menos', '−'));
    etiquetas.appendChild(leyenda);

    // puntos: una fila por autor; el tamaño sigue a las líneas cambiadas (raíz: el área es lo que se lee)
    const lam = svg('svg', { class: 'puntos', width: ancho, height: alto, role: 'group' });
    ticks.forEach(k => lam.appendChild(svg('line', { class: 'rejilla', x1: x(k.t), x2: x(k.t), y1: 0, y2: alto })));
    autores.forEach((_, i) => i && lam.appendChild(svg('line', { class: 'separador', x1: 0, x2: ancho, y1: i * FILA, y2: i * FILA })));
    const maxLineas = Math.max(1, ...commits.map(c => c.mas + c.menos));
    const radio = c => (c.binario && !c.mas && !c.menos ? 4 : 3.5 + 9 * Math.sqrt((c.mas + c.menos) / maxLineas));
    const porTiempo = commits.map((c, i) => i).sort((a, b) => commits[a].fecha - commits[b].fecha);
    const orden = new Map(porTiempo.map((ci, k) => [ci, k]));
    puntos = new Array(commits.length);
    // los grandes primero: los pequeños quedan encima y se pueden señalar
    [...commits.keys()].sort((a, b) => radio(commits[b]) - radio(commits[a])).forEach(i => {
      const c = commits[i];
      const a = autores[c.fila];
      const p = svg('circle', {
        class: `punto ${a.color === null ? 'otros' : `c${a.color}`}`,
        cx: x(c.fecha), cy: c.fila * FILA + FILA / 2, r: radio(c),
        tabindex: -1, role: 'button', 'aria-label': `${c.resumen}, ${c.autor}, ${c.fechaCompleta}, +${c.mas} −${c.menos}`,
      });
      p.dataset.i = String(i);
      p.style.setProperty('--retardo', `${Math.round((orden.get(i) / commits.length) * 500)}ms`);
      lam.appendChild(p);
      puntos[orden.get(i)] = p;
    });
    if (puntos[activo]) { puntos[activo].setAttribute('tabindex', '0'); } else { activo = 0; puntos[0].setAttribute('tabindex', '0'); }

    // barras: añadidas hacia arriba, borradas hacia abajo, en la misma escala de tiempo
    const medio = BARRAS / 2;
    const maxBarra = Math.max(1, ...commits.map(c => Math.max(c.mas, c.menos)));
    const grosor = Math.max(2, Math.min(6, ((ancho - 2 * MARGEN) / commits.length) * 0.6));
    const barras = svg('svg', { class: 'barras', width: ancho, height: BARRAS, 'aria-hidden': 'true' });
    ticks.forEach(k => barras.appendChild(svg('line', { class: 'rejilla', x1: x(k.t), x2: x(k.t), y1: 0, y2: BARRAS })));
    barras.appendChild(svg('line', { class: 'base', x1: 0, x2: ancho, y1: medio, y2: medio }));
    commits.forEach((c, i) => {
      const cx = x(c.fecha) - grosor / 2;
      const g = svg('g', { class: 'barra' });
      g.dataset.i = String(i);
      // raíz: el commit que crea el fichero aplastaría a todos los demás; la cifra exacta va en el globo
      const h = v => Math.max(v ? 1.5 : 0, Math.sqrt(v / maxBarra) * (medio - 4));
      if (c.mas) { g.appendChild(svg('rect', { class: 'mas', x: cx, y: medio - 1 - h(c.mas), width: grosor, height: h(c.mas), rx: 1 })); }
      if (c.menos) { g.appendChild(svg('rect', { class: 'menos', x: cx, y: medio + 1, width: grosor, height: h(c.menos), rx: 1 })); }
      // diana invisible a todo lo alto: una barra de 2px no se puede señalar
      g.appendChild(svg('rect', { class: 'diana', x: x(c.fecha) - 4, y: 0, width: 8, height: BARRAS }));
      g.style.setProperty('--retardo', `${Math.round((orden.get(i) / commits.length) * 500)}ms`);
      barras.appendChild(g);
    });

    const eje = el('div', 'eje');
    ticks.forEach(k => {
      const m = el('span', 'marca', k.texto);
      m.style.left = `${x(k.t)}px`;
      eje.appendChild(m);
    });
    zona.append(lam, barras, eje);
    document.body.classList.toggle('animar', animar);
    animar = false;
    if (conFoco) { /** @type {any} */ (puntos[activo]).focus(); } // al redimensionar, el teclado no pierde su sitio
  }

  function mostrarGlobo(i, ancla) {
    const c = datos.commits[i];
    globo.replaceChildren(
      el('strong', '', c.resumen),
      el('span', 'quien', `${c.autor} · ${c.cuando}`),
      el('span', 'cuando', c.fechaCompleta),
    );
    const lineas = el('span', 'lineas');
    if (c.binario && !c.mas && !c.menos) { lineas.textContent = T.binario; } else { lineas.append(el('b', 'mas', `+${c.mas}`), el('b', 'menos', ` −${c.menos}`)); }
    lineas.appendChild(el('code', '', ` ${c.sha.slice(0, 7)}`));
    globo.appendChild(lineas);
    globo.hidden = false;
    const caja = ancla.getBoundingClientRect();
    const g = globo.getBoundingClientRect();
    const izq = Math.min(innerWidth - g.width - 8, Math.max(8, caja.left + caja.width / 2 - g.width / 2));
    const arriba = caja.top - g.height - 8 < 8 ? caja.bottom + 8 : caja.top - g.height - 8;
    globo.style.transform = `translate(${Math.round(izq)}px, ${Math.round(arriba + scrollY)}px)`;
    marcar(i);
  }

  // el commit señalado se resalta en las dos vistas a la vez
  function marcar(i) {
    document.querySelectorAll('.senalado').forEach(e => e.classList.remove('senalado'));
    if (i === null) { return; }
    document.querySelectorAll(`[data-i="${i}"]`).forEach(e => e.classList.add('senalado'));
  }

  function ocultarGlobo() {
    globo.hidden = true;
    marcar(null);
  }

  const indiceDe = e => {
    const n = /** @type {Element} */ (e.target).closest('[data-i]');
    return n ? Number(/** @type {HTMLElement} */ (n).dataset.i) : null;
  };

  grafica.addEventListener('pointerover', e => {
    const i = indiceDe(e);
    if (i !== null) { mostrarGlobo(i, /** @type {Element} */ (e.target).closest('[data-i]')); }
    const autor = /** @type {Element} */ (e.target).closest('.autor[data-fila]');
    grafica.classList.toggle('enfocando', !!autor);
    if (autor) {
      const f = Number(/** @type {HTMLElement} */ (autor).dataset.fila);
      puntos.forEach(p => p.classList.toggle('apagado', datos.commits[Number(p.dataset.i)].fila !== f));
    }
  });
  grafica.addEventListener('pointerout', e => {
    if (!(/** @type {Element} */ (e.relatedTarget))?.closest?.('[data-i]')) { ocultarGlobo(); }
    if (!(/** @type {Element} */ (e.relatedTarget))?.closest?.('.autor[data-fila]')) {
      grafica.classList.remove('enfocando');
      puntos.forEach(p => p.classList.remove('apagado'));
    }
  });
  grafica.addEventListener('click', e => {
    const i = indiceDe(e);
    if (i !== null) { vscode.postMessage({ tipo: 'abrir', sha: datos.commits[i].sha }); }
  });

  // teclado: un solo punto en el orden de tabulación; las flechas recorren los commits en el tiempo
  grafica.addEventListener('keydown', e => {
    const i = indiceDe(e);
    if (i === null) { return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); vscode.postMessage({ tipo: 'abrir', sha: datos.commits[i].sha }); return; }
    const paso = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[e.key];
    if (paso === undefined) { return; }
    e.preventDefault();
    puntos[activo].setAttribute('tabindex', '-1');
    activo = Math.max(0, Math.min(puntos.length - 1, activo + paso));
    puntos[activo].setAttribute('tabindex', '0');
    /** @type {any} */ (puntos[activo]).focus();
  });
  grafica.addEventListener('focusin', e => {
    const i = indiceDe(e);
    if (i !== null) {
      // un clic también mueve el único punto tabulable
      puntos[activo]?.setAttribute('tabindex', '-1');
      activo = puntos.indexOf(/** @type {any} */ (e.target));
      puntos[activo].setAttribute('tabindex', '0');
      mostrarGlobo(i, /** @type {Element} */ (e.target));
    }
  });
  grafica.addEventListener('focusout', ocultarGlobo);

  let espera;
  new ResizeObserver(() => { clearTimeout(espera); espera = setTimeout(pintar, 80); }).observe(grafica);

  window.addEventListener('message', ({ data: m }) => {
    if (m.tipo === 'error') {
      grafica.removeAttribute('aria-busy');
      grafica.replaceChildren(el('p', 'aviso', m.mensaje));
      return;
    }
    if (m.tipo !== 'datos') { return; }
    datos = m;
    titulo.textContent = m.fichero;
    const desde = m.commits.length ? new Date(Math.min(...m.commits.map(c => c.fecha))).toLocaleDateString(lengua, { year: 'numeric', month: 'short' }) : '';
    const partes = [fmt(T.commits, m.commits.length), fmt(T.autores, m.autores.reduce((n, a) => n + (a.otros || 1), 0))];
    if (desde) { partes.push(fmt(T.desde, desde)); }
    if (m.limitado) { partes.push(fmt(T.limite, m.commits.length)); }
    resumen.textContent = partes.join(' · ');
    pintar();
  });

  vscode.postMessage({ tipo: 'listo' });
}());
