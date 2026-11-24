'use strict';
// Refs que decora «git log --decorate=full» (%D) → nombre corto y tipo, sin adivinar por la «/» (feat/x es local).
const PREFIJOS = [['refs/heads/', 'rama'], ['refs/remotes/', 'remota'], ['refs/tags/', 'tag']];

function clasificarRef(decorada) {
  const esHead = decorada.startsWith('HEAD -> ');
  const completa = (esHead ? decorada.slice(8) : decorada).replace(/^tag: /, '');
  const prefijo = PREFIJOS.find(([p]) => completa.startsWith(p));
  if (!prefijo) { return null; } // «HEAD» suelto de un HEAD separado, stash, notas
  const nombre = completa.slice(prefijo[0].length);
  if (prefijo[1] === 'remota' && nombre.endsWith('/HEAD')) { return null; }
  return { nombre, tipo: prefijo[1], esHead };
}

// origin/feat/x → feat/x; el nombre del remoto puede llevar «/», por eso se busca entre los remotos reales
function ramaLocalDe(remota, remotos) {
  const r = remotos.filter(n => remota.startsWith(`${n}/`)).sort((a, b) => b.length - a.length)[0];
  return r ? remota.slice(r.length + 1) : remota.slice(remota.indexOf('/') + 1);
}

// lo más de git check-ref-format que pilla un nombre tecleado; el resto lo rechaza git con su mensaje
function nombreValido(n) {
  return !n.startsWith('-') && !n.startsWith('/') && !/[\s~^:?*[\\\x00-\x1f\x7f]|\.\.|@\{|\/\/|\/\.|\.lock$|\/$|\.$/.test(n);
}

module.exports = { clasificarRef, ramaLocalDe, nombreValido };
