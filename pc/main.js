'use strict';
// GESMAR - programme Windows : ouvre la fenêtre, lit/écrit les données sur le PC,
// gère l'export, l'import, l'impression et la mise à jour depuis GitHub.
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

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('fr.fabz91.gesmar');
  Menu.setApplicationMenu(null);
  createWindow();
});
app.on('window-all-closed', () => app.quit());
