'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { createCore } = require('./core');

if (!app.requestSingleInstanceLock()) { app.quit(); }

const bundledDir = __dirname;
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(bundledDir, 'config.json'), 'utf8')); } catch (e) { cfg = {}; }
const dataDir = process.env.GESMAR_DATA_DIR || path.join(app.getPath('documents'), 'GESMAR');
const core = createCore({ bundledDir, userDir: app.getPath('userData'), dataDir, fetchFn: (u, o) => net.fetch(u, o) });

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 860, minWidth: 900, minHeight: 600,
    title: 'GESMAR', icon: path.join(bundledDir, 'icon.png'), backgroundColor: '#2a2e32',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(bundledDir, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  win.loadFile(core.currentHtmlPath());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('page-title-updated', (e) => { e.preventDefault(); win.setTitle('GESMAR'); });
}

// Raccourcis Bureau et menu Démarrer au premier lancement (Windows).
function ensureShortcuts() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const flag = path.join(app.getPath('userData'), 'raccourcis.ok');
  if (fs.existsSync(flag)) return;
  const opts = { target: process.execPath, cwd: path.dirname(process.execPath), icon: path.join(bundledDir, 'icon.ico'), iconIndex: 0, description: 'GESMAR – marges et avoirs', appUserModelId: 'fr.fabz91.gesmar' };
  try { shell.writeShortcutLink(path.join(app.getPath('desktop'), 'GESMAR.lnk'), 'create', opts); } catch (e) {}
  try {
    const sm = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    shell.writeShortcutLink(path.join(sm, 'GESMAR.lnk'), 'create', opts);
  } catch (e) {}
  try { fs.mkdirSync(path.dirname(flag), { recursive: true }); fs.writeFileSync(flag, new Date().toISOString()); } catch (e) {}
}

ipcMain.on('gm:config', (e) => { e.returnValue = { updateUrl: cfg.updateUrl || '' }; });
ipcMain.on('gm:load', (e, name) => { try { e.returnValue = core.load(name); } catch (err) { e.returnValue = null; } });
ipcMain.on('gm:save', (e, name, text) => {
  try { e.returnValue = core.save(name, text); }
  catch (err) { e.returnValue = false; dialog.showErrorBox('GESMAR', 'Enregistrement impossible dans ' + dataDir + '\n' + err.message); }
});
ipcMain.handle('gm:export', async (e, text, name) => {
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
ipcMain.handle('gm:updateInfo', async () => ({ version: core.installedVersion() }));
ipcMain.handle('gm:updateCheck', async (e, url) => core.updateCheck(url || cfg.updateUrl));
ipcMain.handle('gm:updateApply', async (e, url) => {
  const r = await core.updateApply(url || cfg.updateUrl);
  if (r.status === 'done') setTimeout(() => { app.relaunch(); app.exit(0); }, 1500);
  return r;
});
ipcMain.handle('gm:updateReset', async () => {
  const c = await dialog.showMessageBox(win, { type: 'question', buttons: ['Revenir à la version d\'origine', 'Annuler'], defaultId: 1, cancelId: 1, title: 'GESMAR', message: 'Revenir à la version fournie à l\'installation ?', detail: 'Vos données ne sont pas touchées.' });
  if (c.response !== 0) return false;
  core.updateReset(); app.relaunch(); app.exit(0); return true;
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('fr.fabz91.gesmar');
  Menu.setApplicationMenu(null);
  ensureShortcuts();
  createWindow();
});
app.on('window-all-closed', () => app.quit());
