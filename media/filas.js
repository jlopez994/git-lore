// @ts-check
// Qué filas del grafo siguen igual tras una recarga, para no repintarlas. Lo carga el webview como script y los
// tests con require.
(function (exportar) {
  'use strict';

  // la fecha relativa cambia sola con el tiempo y el texto de los cambios sin commit cambia con cada guardado: no
  // obligan a rehacer la fila, se cambian en su sitio
  const firma = f => JSON.stringify({ ...f, fecha: undefined, resumen: f.pendiente ? undefined : f.resumen });

  function iguales(vieja, nueva) {
    return !!vieja && firma(vieja) === firma(nueva);
  }

  exportar({ iguales });
}(typeof module !== 'undefined' ? f => { module.exports = f; } : f => { /** @type {any} */ (window).FILAS = f; }));
