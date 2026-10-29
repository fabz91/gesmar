'use strict';
// GESMAR - programme Windows : ouvre la fenêtre, lit/écrit les données sur le PC,
// gère l'export, l'import, l'impression, la mise à jour depuis GitHub et (v86) la lecture du dossier des factures.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { createCore } = require('./core');

if (!app.requestSingleInstanceLock()) { app.quit(); }

const appDir = __dirname;
let cfg = {};
try { cfg = require('./config.js'); } catch (e) { cfg = {}; }
// Données : %APPDATA%\GESMAR\donnees (jamais dans le dossier du programme : une réinstallation ne les touche pas).
const dataDir = process.env.GESMAR_DATA_DIR || path.join(app.getPath('userData'), 'donnees');
const core = createCore({ bundledDir: appDir, userDir: app.getPath('userData'), dataDir, fetchFn: (u, o) => net.fetch(u, o) });

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 860, minWidth: 900, minHeight: 600, show: false,
    title: 'GESMAR', icon: path.join(appDir, 'icon.png'), backgroundColor: '#2a2e32', autoHideMenuBar: true,
    webPreferences: { preload: path.join(appDir, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadFile(core.currentHtmlPath());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('page-title-updated', (e) => { e.preventDefault(); win.setTitle('GESMAR'); });
  // Ctrl+P : imprimer ; F5 : recharger ; Ctrl+Maj+I : outils de diagnostic.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = (input.key || '').toLowerCase();
    if (input.control && !input.shift && k === 'p') { e.preventDefault(); win.webContents.print({ printBackground: true }); }
    else if (k === 'f5') { e.preventDefault(); win.webContents.reload(); }
    else if (input.control && input.shift && k === 'i') { e.preventDefault(); win.webContents.toggleDevTools(); }
  });
}

ipcMain.on('gm:config', (e) => { e.returnValue = { updateUrl: cfg.updateUrl || '', supabaseUrl: cfg.supabaseUrl || '', supabaseKey: cfg.supabaseKey || '' }; });
ipcMain.on('gm:load', (e, name) => { try { e.returnValue = core.load(name); } catch (err) { e.returnValue = null; } });
ipcMain.on('gm:save', (e, name, text) => {
  try { e.returnValue = core.save(name, text); }
  catch (err) { e.returnValue = false; dialog.showErrorBox('GESMAR', 'Enregistrement impossible dans ' + dataDir + '\n' + err.message); }
});
ipcMain.handle('gm:export', async (e, text) => {
  const def = path.join(app.getPath('documents'), 'GESMAR-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json');
  const r = await dialog.showSaveDialog(win, { title: 'Exporter les données GESMAR', defaultPath: def, filters: [{ name: 'Sauvegarde GESMAR', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, text, 'utf8');
  return true;
});
ipcMain.handle('gm:import', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Importer une sauvegarde GESMAR', defaultPath: app.getPath('documents'), properties: ['openFile'], filters: [{ name: 'Sauvegarde GESMAR', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return fs.readFileSync(r.filePaths[0], 'utf8');
});
ipcMain.handle('gm:folder', async () => { fs.mkdirSync(dataDir, { recursive: true }); return shell.openPath(dataDir); });
ipcMain.handle('gm:print', async () => new Promise((res) => win.webContents.print({ printBackground: true }, (ok) => res(ok))));
ipcMain.handle('gm:updateInfo', async () => ({ version: core.installedVersion() }));
ipcMain.handle('gm:updateCheck', async (e, url) => core.updateCheck(url || cfg.updateUrl));
ipcMain.handle('gm:updateApply', async (e, url) => {
  const r = await core.updateApply(url || cfg.updateUrl);
  if (r.status === 'done') setTimeout(() => { app.relaunch(); app.exit(0); }, 1500);
  return r;
});
ipcMain.handle('gm:updateReset', async () => {
  const c = await dialog.showMessageBox(win, { type: 'question', buttons: ['Revenir à la version d\'origine', 'Annuler'], defaultId: 1, cancelId: 1, title: 'GESMAR', message: 'Revenir à la version fournie par l\'installateur ?', detail: 'Vos données ne sont pas touchées.' });
  if (c.response !== 0) return false;
  core.updateReset(); app.relaunch(); app.exit(0); return true;
});

// v86 : factures. GESMAR lit le dossier OneDrive choisi (par ex. « OneDrive - BREDIS\Documents ») et ses PDF.
// Le dossier choisi est retenu sur ce PC (factures.json, à côté des données). Lecture seule : rien n'est modifié ni déplacé.
const facCfgPath = path.join(app.getPath('userData'), 'factures.json');
function facCfg() { try { return JSON.parse(fs.readFileSync(facCfgPath, 'utf8')) || {}; } catch (e) { return {}; } }
function facSafe(rel) {
  const root = facCfg().dossier; if (!root) throw new Error('Dossier des factures non choisi');
  const p = path.resolve(root, String(rel || '')); const r = path.resolve(root);
  if (p !== r && !p.startsWith(r + path.sep)) throw new Error('Chemin refusé'); return p;
}
ipcMain.handle('gm:facDossier', async () => facCfg().dossier || '');
ipcMain.handle('gm:facChoisir', async () => {
  const c = facCfg();
  const r = await dialog.showOpenDialog(win, { title: 'Choisir le dossier des factures (celui qui contient 2026)', defaultPath: c.dossier || app.getPath('home'), properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return '';
  c.dossier = r.filePaths[0]; fs.writeFileSync(facCfgPath, JSON.stringify(c, null, 1), 'utf8'); return c.dossier;
});
ipcMain.handle('gm:facLister', async () => {
  const root = facCfg().dossier; if (!root) return { err: 'nodir' };
  if (!fs.existsSync(root)) return { err: 'absent', root };
  const files = [];
  const walk = async (dir, rel, depth) => {
    if (depth > 8 || files.length > 30000) return;
    let ents = []; try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) await walk(p, r, depth + 1);
      else if (e.isFile()) { try { const st = await fs.promises.stat(p); files.push({ rel: r, size: st.size, mtime: Math.round(st.mtimeMs) }); } catch (_) {} }
    }
  };
  await walk(root, '', 0);
  return { root, files };
});
ipcMain.handle('gm:facLire', async (e, rel) => { const b = await fs.promises.readFile(facSafe(rel)); return new Uint8Array(b.buffer, b.byteOffset, b.length); });
ipcMain.handle('gm:facOuvrir', async (e, rel) => shell.openPath(facSafe(rel)));
// v99 : CA de la caisse. Videor dépose chaque nuit la journée de la caisse dans C:\transfert\reception\001\VENT.TOT.AAAAMMJJ.
// Lecture seule. On ne renvoie que les lignes de totaux (pas le détail des articles) ; le calcul se fait dans la page.
function caDir() { return facCfg().caisse || 'C:\\transfert\\reception\\001'; }
const CA_NOM = /^VENT\.TOT\.\d{8}$/i;
ipcMain.handle('gm:caLister', async () => {
  const d = caDir(); let n = [];
  try { n = await fs.promises.readdir(d); } catch (e) { return { dir: d, err: 'absent' }; }
  const files = [];
  for (const f of n) { if (!CA_NOM.test(f)) continue; try { const st = await fs.promises.stat(path.join(d, f)); if (st.isFile()) files.push({ nom: f, size: st.size, mtime: Math.round(st.mtimeMs) }); } catch (_) {} }
  return { dir: d, files };
});
ipcMain.handle('gm:caLire', async (e, nom) => {
  if (!CA_NOM.test(String(nom))) throw new Error('Nom refusé');
  const t = await fs.promises.readFile(path.join(caDir(), String(nom)), 'latin1');
  return t.split(/\r?\n/).filter(l => !/^(001|054|055)\|/.test(l)).join('\n');
});
ipcMain.handle('gm:caChoisir', async () => {
  const c = facCfg();
  const r = await dialog.showOpenDialog(win, { title: 'Dossier des journées de caisse (fichiers VENT.TOT)', defaultPath: caDir(), properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return '';
  c.caisse = r.filePaths[0]; fs.writeFileSync(facCfgPath, JSON.stringify(c, null, 1), 'utf8'); return c.caisse;
});
// pdf.js (lecture des PDF), fourni avec le programme dans le dossier pdfjs
ipcMain.handle('gm:pdfjs', async () => ({
  lib: fs.readFileSync(path.join(appDir, 'pdfjs', 'pdf.min.mjs'), 'utf8'),
  worker: fs.readFileSync(path.join(appDir, 'pdfjs', 'pdf.worker.min.mjs'), 'utf8')
}));

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('fr.fabz91.gesmar');
  Menu.setApplicationMenu(null);
  createWindow();
});
app.on('window-all-closed', () => app.quit());
