'use strict';
// Historial visual de un fichero: a qué fila (autor) va cada commit. Una persona es su correo, aunque cambie de nombre.

// Colores en orden fijo por número de commits; a partir del máximo, todo cae en «otros» (sin color propio).
// 7 filas: los 6 colores del tema que se distinguen entre sí con daltonismo, más «otros»
function agruparAutores(commits, max = 7) {
  const porClave = new Map();
  for (const c of commits) {
    const clave = (c.correo || c.autor || '').toLowerCase();
    const a = porClave.get(clave) || { clave, nombre: c.autor, commits: 0 };
    a.commits++;
    porClave.set(clave, a);
  }
  const lista = [...porClave.values()].sort((a, b) => b.commits - a.commits || a.nombre.localeCompare(b.nombre));
  const propios = lista.slice(0, max - 1); // max - 1 colores: con justo max autores, el último también va a «otros»
  const resto = lista.slice(propios.length);
  const autores = propios.map((a, i) => ({ nombre: a.nombre, commits: a.commits, color: i }));
  if (resto.length) { autores.push({ nombre: null, commits: resto.reduce((n, a) => n + a.commits, 0), otros: resto.length, color: null }); }
  const fila = new Map(propios.map((a, i) => [a.clave, i]));
  const filaDe = c => {
    const i = fila.get((c.correo || c.autor || '').toLowerCase());
    return i === undefined ? propios.length : i;
  };
  return { autores, filaDe };
}

// un merge sale de --follow sin name-status: su ruta es la del commit anterior que tocó el fichero, no la actual
// (si se renombró después, «sha:rutaActual» no existiría en esa revisión)
function cambiosDe(commits, rutaActual) {
  const cambios = new Map();
  let ruta = null;
  for (let i = commits.length - 1; i >= 0; i--) {
    const c = commits[i];
    const f = c.ficheros[0] || { ruta: ruta || rutaActual, estado: 'M' };
    ruta = f.ruta;
    cambios.set(c.sha, { sha: c.sha, ruta: f.ruta, rutaAnterior: f.rutaAnterior, estado: f.estado, refAnterior: c.padres.length ? undefined : null });
  }
  return cambios;
}

module.exports = { agruparAutores, cambiosDe };
