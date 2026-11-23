'use strict';
// URL de un remoto git → página web del repo y de un commit.

// git@host:owner/repo.git, ssh://git@host:22/owner/repo.git, https://user@host/owner/repo.git
function webDeRemoto(url) {
  if (!url) { return null; }
  let host, ruta;
  const scp = /^[\w.-]+@([^:/]+):(?!\/)(.+)$/.exec(url);
  if (scp) {
    [, host, ruta] = scp;
  } else {
    let u;
    try { u = new URL(url); } catch { return null; }
    if (!/^(https?|ssh|git):$/.test(u.protocol)) { return null; }
    host = u.hostname;
    ruta = u.pathname.replace(/^\//, '');
  }
  ruta = ruta.replace(/\.git$/, '').replace(/\/$/, '');
  // la URL acaba en un enlace de un hover de confianza: nada de ), espacios ni ]
  const segmentos = ruta.split('/');
  if (!/^[\w.-]+$/.test(host || '') || !ruta || !segmentos.every(s => /^[\w.~%-]+$/.test(s))) { return null; }
  // Azure DevOps por SSH: ssh.dev.azure.com:v3/org/proyecto/repo
  if (host === 'ssh.dev.azure.com') {
    const [, org, proyecto, repo] = segmentos;
    return repo ? { tipo: 'azure', base: `https://dev.azure.com/${org}/${proyecto}/_git/${repo}` } : null;
  }
  const tipo = host === 'github.com' ? 'github'
    : host === 'bitbucket.org' ? 'bitbucket'
      : host === 'dev.azure.com' || host.endsWith('.visualstudio.com') ? 'azure'
        : /gitlab/.test(host) ? 'gitlab'
          : 'otro';
  return { tipo, base: `https://${host}/${ruta}` };
}

function urlDeCommit(web, sha) {
  if (!web) { return null; }
  const tramo = { gitlab: '-/commit', bitbucket: 'commits', azure: 'commit' }[web.tipo] || 'commit';
  return `${web.base}/${tramo}/${sha}`;
}

const NOMBRES = { github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket', azure: 'Azure DevOps' };
function nombreDeRemoto(web) {
  return (web && NOMBRES[web.tipo]) || null;
}

// remoto del upstream de la rama, si no origin, si no el primero
function elegirRemoto(remotos, upstream) {
  const conUrl = remotos.filter(r => r.fetchUrl || r.pushUrl);
  return conUrl.find(r => r.name === upstream)
    || conUrl.find(r => r.name === 'origin')
    || conUrl[0]
    || null;
}

module.exports = { webDeRemoto, urlDeCommit, nombreDeRemoto, elegirRemoto };
