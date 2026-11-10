'use strict';
// GES - programme Windows unique qui réunit GESMAR, GESTIME, GESTAT et GESCOUNT (10/11/2026).
// - démarre avec Windows, en petite icône (zone de notification, en bas à droite) ;
// - TOUT est rangé dans %APPDATA%\GES : un dossier par logiciel (%APPDATA%\GES\GESMAR, \GESTIME, \GESTAT, \GESCOUNT).
//   Au 1er lancement, les dossiers des anciens programmes (%APPDATA%\GESMAR…) y sont RECOPIÉS (données, réglages,
//   connexion G20, page à jour) ; les anciens dossiers ne sont pas touchés (copie de secours, à supprimer plus tard) ;
// - un clic sur l'icône du logiciel (en haut à gauche) ouvre le choix du logiciel ;
// - fermer la fenêtre (croix) la range dans la petite icône : les lectures automatiques continuent
//   (factures de GESMAR, caisse Casio de GESTAT…). « Quitter GES » dans le menu de la petite icône arrête tout.
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const ROOT = __dirname;
const enFond = process.argv.includes('--cache'); // lancé par Windows à l'ouverture de la session
let cfg = {}; try { cfg = require('./config.js'); } catch (e) { cfg = {}; }

// Les 4 logiciels. « admin » = rangé à part, en bas, dans le choix du logiciel.
const APPS = [
  { id: 'gesmar', nom: 'GESMAR', suffixe: 'MAR', dossier: 'GESMAR', desc: 'Marges, factures et avoirs' },
  { id: 'gestime', nom: 'GESTIME', suffixe: 'TIME', dossier: 'GESTIME', desc: 'Personnel, plannings et congés' },
  { id: 'gestat', nom: 'GESTAT', suffixe: 'TAT', dossier: 'GESTAT', desc: 'Ventes et contrôle caisse' },
  { id: 'gescount', nom: 'GESCOUNT', suffixe: 'COUNT', dossier: 'GESCOUNT', desc: 'Salaires et comptes', admin: true }
];
const parId = Object.fromEntries(APPS.map(a => [a.id, a]));

// Réglages de GES sur ce PC : dernier logiciel ouvert, taille de la fenêtre, message de la petite icône déjà vu.
const reglagesPath = () => path.join(app.getPath('userData'), 'ges.json');
function reglages() { try { return JSON.parse(fs.readFileSync(reglagesPath(), 'utf8')) || {}; } catch (e) { return {}; } }
function reglagesSave(r) { try { fs.mkdirSync(path.dirname(reglagesPath()), { recursive: true }); fs.writeFileSync(reglagesPath(), JSON.stringify(r, null, 1), 'utf8'); } catch (e) {} }

let quitting = false, tray = null, courant = null;
const fenetres = {}; // id -> { win, mod }

// ---------- dossier d'un logiciel dans %APPDATA%\GES (recopie de l'ancien programme au 1er lancement) ----------
const CACHES = new Set(['cache', 'code cache', 'gpucache', 'dawncache', 'dawngraphitecache', 'dawnwebgpucache', 'crashpad', 'shadercache', 'grshadercache']);
function dossierDe(a) {
  const dir = path.join(app.getPath('userData'), a.dossier), ok = path.join(dir, 'ges-reprise.txt');
  if (fs.existsSync(ok)) return dir;
  const ancien = path.join(app.getPath('appData'), a.dossier);
  try {
    if (fs.existsSync(ancien) && !fs.existsSync(dir)) {
      const tmp = dir + '.copie';
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.cpSync(ancien, tmp, { recursive: true, filter: (src) => !CACHES.has(path.basename(src).toLowerCase()) });
      fs.renameSync(tmp, dir);
      fs.writeFileSync(ok, 'Recopié depuis ' + ancien + ' le ' + new Date().toLocaleString('fr-FR') + '.\r\nL\'ancien dossier n\'est plus utilisé par GES : il peut être supprimé quand tout marche.\r\n', 'utf8');
      return dir;
    }
  } catch (e) {
    // copie impossible (disque plein, fichier bloqué…) : on travaille cette fois dans l'ancien dossier, la copie sera retentée au prochain lancement
    console.error('reprise ' + a.nom, e); try { fs.rmSync(dir + '.copie', { recursive: true, force: true }); } catch (_) {}
    return ancien;
  }
  if (fs.existsSync(ancien) && fs.existsSync(dir) && !fs.existsSync(path.join(dir, 'donnees'))) { try { fs.rmSync(dir, { recursive: true, force: true }); return dossierDe(a); } catch (e) { return ancien; } }
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(ancien)) fs.writeFileSync(ok, 'Nouveau dossier GES (pas d\'ancien programme sur ce PC).\r\n', 'utf8');
  return dir;
}

// ---------- chargement d'un logiciel ----------
function charger(a) {
  if (fenetres[a.id]) return fenetres[a.id];
  const userDir = dossierDe(a);
  const ipc = {
    on: (ch, fn) => ipcMain.on(a.id + '|' + ch, fn),
    handle: (ch, fn) => ipcMain.handle(a.id + '|' + ch, fn)
  };
  const fakeApp = {
    getPath: (n) => (n === 'userData' ? userDir : app.getPath(n)),
    setPath: () => {}, getName: () => a.nom, getVersion: () => app.getVersion(),
    on: () => {}, once: () => {}, quit: () => {}, relaunch: () => {},
    exit: () => recharger(a.id), // « mise à jour terminée → redémarrer » = recharger seulement ce logiciel
    requestSingleInstanceLock: () => true, setAppUserModelId: () => {},
    setLoginItemSettings: () => {}, getLoginItemSettings: () => ({ openAtLogin: true }),
    whenReady: () => Promise.resolve(), isReady: () => true
  };
  const ctx = { id: a.id, app: fakeApp, ipc, userDir, recharger: () => recharger(a.id) };
  const mod = require(path.join(ROOT, 'apps', a.id, 'main.js'))(ctx);
  const r = reglages();
  const win = new BrowserWindow({
    width: 1366, height: 860, minWidth: 900, minHeight: 600, show: false,
    title: 'GES - ' + a.nom, icon: path.join(ROOT, 'icon.png'), backgroundColor: '#2a2e32', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(ROOT, 'apps', a.id, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false,
      session: session.fromPath(userDir) // stockage propre à ce logiciel (repris de l'ancien programme) : connexion G20, réglages, caches
    }
  });
  if (r.bounds) { try { win.setBounds(r.bounds); } catch (e) {} }
  mod.setWin(win);
  win.loadFile(mod.page());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('page-title-updated', (e) => { e.preventDefault(); win.setTitle('GES - ' + a.nom); });
  // Si la page téléchargée ne s'ouvre pas : retour à celle fournie avec GES.
  win.webContents.on('did-fail-load', (ev, code, desc, url, main) => { if (main && mod.pageOrigine && mod.page() !== mod.pageOrigine()) { try { mod.oublierMaj && mod.oublierMaj(); } catch (e) {} win.loadFile(mod.pageOrigine()); } });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = (input.key || '').toLowerCase();
    if (input.control && !input.shift && k === 'p') { e.preventDefault(); win.webContents.print({ printBackground: true }); }
    else if (k === 'f5') { e.preventDefault(); win.webContents.reload(); }
    else if (input.control && input.shift && k === 'i') { e.preventDefault(); win.webContents.toggleDevTools(); }
  });
  // La croix range GES dans la petite icône (les lectures automatiques continuent).
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault(); memoriser(win); win.hide();
    const rr = reglages();
    if (tray && !rr.bulleVue) { try { tray.displayBalloon({ title: 'GES', iconType: 'info', content: 'GES continue en fond : cliquez sur la petite icône en bas à droite pour le rouvrir.' }); } catch (_) {} rr.bulleVue = true; reglagesSave(rr); }
  });
  fenetres[a.id] = { win, mod };
  if (mod.demarrer) { try { mod.demarrer(); } catch (e) { console.error(a.id, e); } }
  return fenetres[a.id];
}
function recharger(id) { const f = fenetres[id]; if (f && !f.win.isDestroyed()) f.win.loadFile(f.mod.page()); }
function memoriser(win) { try { const r = reglages(); r.max = win.isMaximized(); if (!r.max) r.bounds = win.getBounds(); reglagesSave(r); } catch (e) {} }

// Montre un logiciel à la place de celui qui est affiché (même taille, même place).
function montrer(id) {
  const a = parId[id] || parId[reglages().dernier] || APPS[0];
  const cible = charger(a).win;
  const ancien = courant && fenetres[courant] && fenetres[courant].win;
  if (ancien && ancien !== cible && ancien.isVisible()) {
    const max = ancien.isMaximized(), b = ancien.getNormalBounds ? ancien.getNormalBounds() : ancien.getBounds();
    try { cible.setBounds(b); } catch (e) {}
    if (max) cible.maximize(); else if (cible.isMaximized()) cible.unmaximize();
    cible.show(); cible.focus(); ancien.hide();
  } else {
    if (cible.isMinimized()) cible.restore();
    if (!cible.isVisible()) { const r = reglages(); if (r.max !== false) cible.maximize(); cible.show(); }
    cible.focus();
  }
  courant = a.id;
  const r = reglages(); r.dernier = a.id; reglagesSave(r);
  menuTray();
}

// ---------- choix du logiciel (demandé par la page : clic sur l'icône du logiciel) ----------
ipcMain.on('ges:apps', (e) => {
  const moi = Object.keys(fenetres).find(k => fenetres[k].win.webContents === e.sender) || '';
  e.returnValue = { courant: moi, apps: APPS.map(a => ({ id: a.id, nom: a.nom, suffixe: a.suffixe, desc: a.desc, admin: !!a.admin, icone: pathToFileURL(path.join(ROOT, 'apps', a.id, 'icon.png')).href })) };
});
ipcMain.on('ges:montrer', (e, id) => { if (parId[id]) montrer(id); });

// ---------- petite icône ----------
function menuTray() {
  if (!tray) return;
  const item = (a) => ({ label: (a.admin ? 'Admin : ' : '') + a.nom, type: 'radio', checked: courant === a.id, click: () => montrer(a.id) });
  const tpl = APPS.filter(a => !a.admin).map(item);
  tpl.push({ type: 'separator' });
  APPS.filter(a => a.admin).forEach(a => tpl.push(item(a)));
  if (fenetres.gescount) tpl.push({ label: 'Verrouiller GESCOUNT', click: () => { try { fenetres.gescount.win.webContents.send('gescount|gc:lock'); } catch (e) {} } });
  tpl.push({ type: 'separator' }, { label: 'Quitter GES', click: () => { quitting = true; app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(tpl));
}
function creerTray() {
  let img = nativeImage.createFromPath(path.join(ROOT, 'icon.png'));
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
  tray = new Tray(img); tray.setToolTip('GES');
  tray.on('click', () => montrer(courant || reglages().dernier));
  tray.on('double-click', () => montrer(courant || reglages().dernier));
  menuTray();
}

app.on('second-instance', () => montrer(courant || reglages().dernier)); // double-clic sur le raccourci alors que GES tourne
app.on('before-quit', () => { quitting = true; Object.values(fenetres).forEach(f => { try { memoriser(f.win); } catch (e) {} }); });
app.on('window-all-closed', () => { if (quitting) app.quit(); });

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('fr.fabz91.ges');
  Menu.setApplicationMenu(null);
  // Démarrage avec Windows, en petite icône (sauf si config.js dit demarrageWindows: false).
  try { app.setLoginItemSettings({ openAtLogin: cfg.demarrageWindows !== false, args: ['--cache'] }); } catch (e) {}
  creerTray();
  // GESMAR, GESTIME et GESTAT sont chargés tout de suite (cachés) pour que leurs lectures automatiques tournent.
  // GESCOUNT (admin) seulement à la demande, ou au démarrage s'il était réglé pour démarrer avec Windows.
  for (const a of APPS) { if (!a.admin) charger(a); }
  try { const p = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'GESCOUNT', 'poste.json'), 'utf8')); if (p && p.demarrage) charger(parId.gescount); } catch (e) {}
  if (!enFond) montrer(reglages().dernier || 'gesmar');
  else courant = reglages().dernier || 'gesmar';
  menuTray();
});
