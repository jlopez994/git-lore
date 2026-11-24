// @ts-check
// Empaquetado de burbujas: cada círculo, del más grande al más pequeño, en el primer hueco libre de una espiral.
// Lo carga el webview como script y los tests con require.
(function (exportar) {
  'use strict';

  // radios en cualquier unidad → centros {x, y, r} sin solaparse, alrededor de (0, 0). aspecto > 1 estira la
  // espiral a lo ancho para llenar un panel apaisado
  function empaquetar(radios, { hueco = 2, aspecto = 1 } = {}) {
    const sitios = [];
    const positivos = radios.filter(r => r > 0);
    // relativo también al mayor: con 10.000 commits frente a 1, un paso del menor daría millones de vueltas
    const paso = positivos.length ? Math.max(0.5, Math.min(...positivos), Math.max(...positivos) / 50) / 4 : 1;
    for (const r of radios) {
      let x = 0;
      let y = 0;
      if (sitios.length) {
        // sin tope: la espiral acaba saliendo de todo lo ya colocado
        for (let a = 0; ; a += 0.05) {
          const d = paso * a;
          x = d * Math.cos(a) * aspecto;
          y = d * Math.sin(a);
          if (sitios.every(s => Math.hypot(s.x - x, s.y - y) >= s.r + r + hueco)) { break; }
        }
      }
      sitios.push({ x, y, r });
    }
    return sitios;
  }

  // escala y centra los sitios en una caja de ancho × alto (píxeles), con un margen
  function encajar(sitios, ancho, alto, margen = 4) {
    const izq = Math.min(...sitios.map(s => s.x - s.r));
    const der = Math.max(...sitios.map(s => s.x + s.r));
    const arr = Math.min(...sitios.map(s => s.y - s.r));
    const aba = Math.max(...sitios.map(s => s.y + s.r));
    const k = Math.min((ancho - 2 * margen) / (der - izq), (alto - 2 * margen) / (aba - arr));
    const dx = ancho / 2 - ((izq + der) / 2) * k;
    const dy = alto / 2 - ((arr + aba) / 2) * k;
    return sitios.map(s => ({ x: s.x * k + dx, y: s.y * k + dy, r: s.r * k }));
  }

  exportar({ empaquetar, encajar });
}(typeof module !== 'undefined' ? f => { module.exports = f; } : f => { /** @type {any} */ (window).BURBUJAS = f; }));
