'use strict';
// Reparto de commits en carriles para dibujar el grafo. Los commits llegan de hijo a padre (git log --date-order).
// Cada fila trae su nodo y segmentos en coordenadas de carril; y: 0 arriba, 0.5 el nodo, 1 abajo.

function libre(carriles) {
  const i = carriles.indexOf(null);
  return i < 0 ? carriles.length : i;
}

function recortar(carriles) {
  const r = carriles.slice();
  while (r.length && r[r.length - 1] === null) { r.pop(); }
  return r;
}

// `carriles` permite seguir donde lo dejó una página anterior
function trazarGrafo(commits, carrilesIniciales = []) {
  let carriles = carrilesIniciales.slice();
  const filas = commits.map(c => {
    const antes = carriles;
    let col = antes.indexOf(c.sha);
    const despues = antes.slice();
    if (col < 0) {
      col = libre(despues);
      despues[col] = c.sha;
    }
    const segmentos = [];
    // carriles que esperaban este commit (sus hijos) terminan en el nodo
    antes.forEach((s, j) => {
      if (s === null) { return; }
      if (s === c.sha) {
        segmentos.push({ x1: j, y1: 0, x2: col, y2: 0.5, carril: j });
        if (j !== col) { despues[j] = null; }
      }
    });
    despues[col] = null;
    const salidas = [];
    c.padres.forEach((p, k) => {
      const existente = despues.indexOf(p);
      let destino = existente;
      // el primer padre se queda en este carril aunque otro más a la derecha ya lo esperase: el grafo no deriva
      if (k === 0 && (existente < 0 || existente > col)) {
        if (existente >= 0) { despues[existente] = null; }
        destino = col;
        despues[col] = p;
      } else if (existente < 0) {
        destino = libre(despues);
        despues[destino] = p;
      }
      salidas.push(destino);
    });
    // los que no tocan este commit siguen hasta donde quede su sha (recto salvo que se haya fusionado arriba)
    antes.forEach((s, j) => {
      if (s !== null && s !== c.sha) {
        const x2 = despues.indexOf(s);
        segmentos.push({ x1: j, y1: 0, x2, y2: 1, carril: x2 });
      }
    });
    salidas.forEach(d => segmentos.push({ x1: col, y1: 0.5, x2: d, y2: 1, carril: d === col ? col : d }));
    carriles = recortar(despues);
    return { sha: c.sha, col, segmentos, ancho: Math.max(antes.length, carriles.length, col + 1) };
  });
  return { filas, carriles };
}

module.exports = { trazarGrafo };
