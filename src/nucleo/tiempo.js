'use strict';

const UNIDADES = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

function fechaRelativa(ms, ahora, idioma) {
  const rtf = new Intl.RelativeTimeFormat(idioma, { numeric: 'auto' });
  const seg = Math.round((ms - ahora) / 1000);
  for (const [unidad, s] of UNIDADES) {
    if (Math.abs(seg) >= s) { return rtf.format(Math.trunc(seg / s), unidad); }
  }
  return rtf.format(0, 'minute');
}

// 1 = de hoy, 0 = de hace dos años o más; logarítmico para que el último mes se distinga bien
function calor(ms, ahora) {
  const dias = Math.max(0, (ahora - ms) / 86400000);
  return Math.max(0, 1 - Math.log1p(dias) / Math.log1p(730));
}

module.exports = { fechaRelativa, calor };
