// Logique du programme PC GESMAR, sans dépendance à Electron (testable avec Node).
'use strict';
const fs = require('fs');
const path = require('path');

function versionOf(html) {
  const m = /<meta\s+name="gm-version"\s+content="(\d+)"/i.exec(html || '');
  return m ? parseInt(m[1], 10) : 0;
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function createCore({ bundledDir, userDir, dataDir, fetchFn }) {
  const majDir = path.join(userDir, 'maj');
  const majHtml = path.join(majDir, 'index.html');
  const bundledHtml = path.join(bundledDir, 'index.html');
  const seedFile = path.join(bundledDir, 'seed.json');
  const backupDir = path.join(dataDir, 'sauvegardes');

  // Page à afficher : la version téléchargée si elle existe et est valide, sinon celle fournie à l'installation.
  function currentHtmlPath() {
    try {
      if (fs.existsSync(majHtml) && versionOf(fs.readFileSync(majHtml, 'utf8')) > 0) return majHtml;
    } catch (e) { /* on retombe sur la version d'origine */ }
    return bundledHtml;
  }
  function installedVersion() { return versionOf(fs.readFileSync(currentHtmlPath(), 'utf8')); }

  function dataFile(name) { return path.join(dataDir, String(name).replace(/[^a-z0-9_-]/gi, '_') + '.json'); }

  function load(name) {
    const f = dataFile(name);
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
    if (name === 'gesmar' && fs.existsSync(seedFile)) return fs.readFileSync(seedFile, 'utf8'); // données de départ (privées, livrées avec le programme)
    return null;
  }

  function save(name, text) {
    writeAtomic(dataFile(name), text);
    // Une copie de sécurité par jour, on garde les 30 dernières.
    try {
      const day = new Date().toISOString().slice(0, 10);
      const b = path.join(backupDir, name + '-' + day + '.json');
      if (!fs.existsSync(b)) {
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(b, text, 'utf8');
        const old = fs.readdirSync(backupDir).filter(x => x.startsWith(name + '-') && x.endsWith('.json')).sort();
        while (old.length > 30) fs.unlinkSync(path.join(backupDir, old.shift()));
      }
    } catch (e) { /* la sauvegarde du jour est facultative */ }
    return true;
  }

  async function getText(url) {
    const r = await fetchFn(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('le serveur a répondu ' + r.status);
    return await r.text();
  }

  async function updateCheck(base) {
    const version = installedVersion();
    if (!base) return { status: 'noconfig', version };
    try {
      const info = JSON.parse(await getText(base.replace(/\/$/, '') + '/version.json'));
      const remote = parseInt(info.version, 10) || 0;
      return remote > version ? { status: 'new', version, remote, note: info.note || '' } : { status: 'none', version, remote };
    } catch (e) {
      return { status: 'error', version, msg: e.message };
    }
  }

  async function updateApply(base) {
    const chk = await updateCheck(base);
    if (chk.status !== 'new') return { status: chk.status === 'none' ? 'none' : 'error', msg: chk.msg || 'aucune nouvelle version' };
    try {
      const html = await getText(base.replace(/\/$/, '') + '/index.html');
      const v = versionOf(html);
      if (html.length < 20000 || v !== chk.remote) return { status: 'error', msg: 'fichier téléchargé incomplet, réessayez plus tard' };
      writeAtomic(majHtml, html);
      return { status: 'done', version: v };
    } catch (e) {
      return { status: 'error', msg: e.message };
    }
  }

  function updateReset() {
    try { fs.rmSync(majDir, { recursive: true, force: true }); } catch (e) { /* rien à effacer */ }
    return true;
  }

  return { currentHtmlPath, installedVersion, load, save, updateCheck, updateApply, updateReset, dataFile, majHtml, versionOf };
}

module.exports = { createCore, versionOf };
