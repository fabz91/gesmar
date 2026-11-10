'use strict';
// GESTIME dans GES : reprise du programme GESTIME 1.2.0 (main.js), sans la fenêtre (GES s'en occupe).
// Données et réglages : %APPDATA%\GESTIME (comme avant), page mise à jour dans %APPDATA%\GESTIME\app.
const { dialog, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');

module.exports = function (ctx) {
  const ipcMain = ctx.ipc;
  let win = null;
  const NEW_DIR = ctx.userDir;
  const OLD_DIR = path.join(ctx.app.getPath('appData'), 'Horaires');
  const DATA_DIR = path.join(NEW_DIR, 'donnees');
  // Ancien dossier « Horaires » (avant GESTIME 1.2.0) : recopié une fois, comme le faisait GESTIME.
  (function migrate() {
    try {
      if (!fs.existsSync(OLD_DIR)) return;
      if (!fs.existsSync(path.join(NEW_DIR, 'donnees', 'gestime-bredis.json'))) fs.cpSync(OLD_DIR, NEW_DIR, { recursive: true, force: false });
      fs.mkdirSync(DATA_DIR, { recursive: true });
      let ok = true;
      for (const f of fs.readdirSync(NEW_DIR)) {
        const m = /^horaires-data(?:-([a-z0-9]+))?\.json$/i.exec(f); if (!m) continue;
        const to = path.join(DATA_DIR, 'gestime-' + (m[1] || 'bredis').toLowerCase() + '.json');
        if (!fs.existsSync(to)) fs.copyFileSync(path.join(NEW_DIR, f), to);
        if (fs.statSync(to).size !== fs.statSync(path.join(NEW_DIR, f)).size) { ok = false; continue; }
        fs.unlinkSync(path.join(NEW_DIR, f));
      }
      if (ok && fs.existsSync(path.join(DATA_DIR, 'gestime-bredis.json'))) fs.rmSync(OLD_DIR, { recursive: true, force: true });
    } catch (e) {}
  })();

  const dataDir = () => DATA_DIR;
  const sid = (s) => (String(s || 'bredis').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bredis');
  const dataFile = (s) => path.join(dataDir(), 'gestime-' + sid(s) + '.json');

  ipcMain.on('load', (e, s) => { try { e.returnValue = fs.existsSync(dataFile(s)) ? fs.readFileSync(dataFile(s), 'utf8') : null; } catch (err) { e.returnValue = null; } });
  ipcMain.on('save', (e, s, json) => {
    try { fs.mkdirSync(dataDir(), { recursive: true }); const tmp = dataFile(s) + '.tmp'; fs.writeFileSync(tmp, json); fs.renameSync(tmp, dataFile(s)); } catch (err) {}
  });

  function autoBackupWrite(dir, appName, text) {
    const t = String(text || '');
    JSON.parse(t); if (t.length < 50) throw new Error('sauvegarde vide');
    const d = path.join(dir, 'sauvegardes'); fs.mkdirSync(d, { recursive: true });
    const n = new Date(), day = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
    const f = path.join(d, appName + '-' + day + '.json');
    fs.writeFileSync(f + '.tmp', t, 'utf8'); fs.renameSync(f + '.tmp', f);
    const re = new RegExp('^' + appName + '-\\d{4}-\\d{2}-\\d{2}\\.json$');
    const all = fs.readdirSync(d);
    for (const x of all) if (/\.json$/i.test(x) && !re.test(x)) { try { fs.unlinkSync(path.join(d, x)); } catch (e) {} }
    const mine = all.filter(x => re.test(x)).sort();
    while (mine.length > 60) { try { fs.unlinkSync(path.join(d, mine.shift())); } catch (e) {} }
    return f;
  }
  ipcMain.handle('autobackup', (e, text) => { try { return autoBackupWrite(dataDir(), 'GESTIME', text); } catch (err) { return false; } });
  ipcMain.handle('export', async (e, json, s) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: 'horaires-' + sid(s) + '-' + new Date().toISOString().slice(0, 10) + '.json', filters: [{ name: 'Sauvegarde GESTIME', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, json); return true;
  });
  ipcMain.handle('import', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Sauvegarde GESTIME', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return fs.readFileSync(r.filePaths[0], 'utf8');
  });
  ipcMain.handle('openFolder', () => shell.openPath(dataDir()));
  ipcMain.handle('print', () => new Promise((resolve) => { if (!win) return resolve(false); win.webContents.print({ silent: false, printBackground: false, landscape: true, pageSize: 'A4' }, (ok) => resolve(ok)); }));

  // ===== Mise à jour sans réinstaller : page téléchargée dans %APPDATA%\GESTIME\app =====
  const here = __dirname;
  const appDir = () => path.join(NEW_DIR, 'app');
  const verOf = (f) => { try { const m = /name="gt-version"\s+content="(\d+)"/.exec(fs.readFileSync(f, 'utf8').slice(0, 4000)); return m ? +m[1] : 0; } catch (e) { return 0; } };
  function pickPage() {
    const b = path.join(here, 'index.html'), u = path.join(appDir(), 'index.html');
    try {
      if (fs.existsSync(u) && verOf(u) > verOf(b)) {
        for (const f of ['config.js', 'icon.png']) fs.copyFileSync(path.join(here, f), path.join(appDir(), f));
        return u;
      }
    } catch (e) {}
    return b;
  }
  const curVersion = () => verOf(pickPage());
  const baseUrl = (u) => { u = String(u || ''); return /^(https:\/\/|http:\/\/127\.0\.0\.1)/.test(u) && !/VOTRE/i.test(u) ? (u.endsWith('/') ? u : u + '/') : null; };
  async function getText(url) {
    const r = await net.fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }
  ipcMain.handle('update-info', () => ({ version: curVersion() }));
  ipcMain.handle('update-check', async (e, u) => {
    const b = baseUrl(u); if (!b) return { status: 'noconfig', version: curVersion() };
    try { const v = JSON.parse(await getText(b + 'version.json')); const cur = curVersion();
      return { status: +v.version > cur ? 'new' : 'none', version: cur, remote: +v.version, note: v.note || '' };
    } catch (err) { return { status: 'error', version: curVersion(), msg: String(err.message || err) }; }
  });
  ipcMain.handle('update-apply', async (e, u) => {
    const b = baseUrl(u); if (!b) return { status: 'noconfig' };
    try {
      const v = JSON.parse(await getText(b + 'version.json')); const html = await getText(b + 'index.html');
      const mv = /name="gt-version"\s+content="(\d+)"/.exec(html.slice(0, 4000));
      if (!mv || +mv[1] !== +v.version || html.length < 100000 || !/<\/html>\s*$/i.test(html) || !html.includes('window.api'))
        return { status: 'error', msg: 'Fichier de mise à jour incomplet ou invalide (rien n’a été modifié).' };
      fs.mkdirSync(appDir(), { recursive: true });
      const f = path.join(appDir(), 'index.html');
      if (fs.existsSync(f)) fs.copyFileSync(f, path.join(appDir(), 'index.prev.html'));
      fs.writeFileSync(f + '.tmp', html); fs.renameSync(f + '.tmp', f);
      setTimeout(() => ctx.recharger(), 900);
      return { status: 'done', version: +v.version };
    } catch (err) { return { status: 'error', msg: String(err.message || err) }; }
  });
  ipcMain.handle('update-reset', () => { try { fs.rmSync(appDir(), { recursive: true, force: true }); } catch (err) {} setTimeout(() => ctx.recharger(), 300); return true; });

  return {
    setWin: (w) => { win = w; },
    page: pickPage,
    pageOrigine: () => path.join(here, 'index.html'),
    oublierMaj: () => { try { fs.rmSync(appDir(), { recursive: true, force: true }); } catch (e) {} }
  };
};
