'use strict';
// GESMAR - programme Windows : ouvre la fenêtre, lit/écrit les données sur le PC,
// gère l'export, l'import, l'impression, la mise à jour depuis GitHub et (v86) la lecture du dossier des factures.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, net, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { createCore } = require('./core');
const MAIL = require('./imap');

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

// ===== Sauvegarde automatique (règle GES du 08/11/2026) =====
// Une fois par jour : UN fichier avec TOUS les magasins, au format de l'export (réimportable par Réglages → Importer).
// Rangé dans le dossier « sauvegardes » des données ; on garde les 60 derniers jours. Les anciennes copies par magasin sont retirées.
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
ipcMain.handle('gm:autoBackup', (e, text) => { try { return autoBackupWrite(dataDir, 'GESMAR', text); } catch (err) { return false; } });
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
  if (String(rel || '').startsWith('@mail/')) { const r = path.resolve(mailRoot()), p = path.resolve(r, String(rel).slice(6)); if (!p.startsWith(r + path.sep)) throw new Error('Chemin refusé'); return p; }
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
  const files = [], dirs = [];
  const walk = async (dir, rel, depth) => {
    if (depth > 8 || files.length > 30000) return;
    let ents = []; try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { try { const st = await fs.promises.stat(p); dirs.push({ rel: r, mtime: Math.round(st.mtimeMs) }); } catch (_) {} await walk(p, r, depth + 1); }
      else if (e.isFile()) { try { const st = await fs.promises.stat(p); files.push({ rel: r, size: st.size, mtime: Math.round(st.mtimeMs) }); } catch (_) {} }
    }
  };
  await walk(root, '', 0);
  // 1.6.0 : PDF récupérés dans la boîte mail (Documents\GES\FACTURES-MAIL), chemins préfixés par « @mail/ »
  if (mailCfg().actif && fs.existsSync(mailRoot())) await walk(mailRoot(), '@mail', 0);
  return { root, files, dirs }; // 1.3.0 : dossiers aussi (fournisseur créé même si son dossier est vide)
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
// 1.5.0 : onglet VENTE : la journée de caisse complète (rayons, familles, articles, heures…). Lecture seule.
ipcMain.handle('gm:venteLire', async (e, nom) => {
  if (!CA_NOM.test(String(nom))) throw new Error('Nom refusé');
  return fs.promises.readFile(path.join(caDir(), String(nom)), 'latin1');
});
ipcMain.handle('gm:caChoisir', async () => {
  const c = facCfg();
  const r = await dialog.showOpenDialog(win, { title: 'Dossier des journées de caisse (fichiers VENT.TOT)', defaultPath: caDir(), properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return '';
  c.caisse = r.filePaths[0]; fs.writeFileSync(facCfgPath, JSON.stringify(c, null, 1), 'utf8'); return c.caisse;
});
// ===== 1.6.0 : factures reçues par mail (IMAP, lecture seule) =====
// Réglages dans mail.json (à côté des données) : serveur, adresse, mot de passe CHIFFRÉ par Windows (safeStorage, jamais renvoyé à la page),
// dossiers lus (boîte de réception, corbeille + dossiers choisis), date de départ, expéditeurs → fournisseur, mails déjà traités.
// Les PDF des expéditeurs associés sont rangés dans Documents\GES\FACTURES-MAIL\<année>\FOURNISSEURS\<fournisseur>\ (DIAPAR : <année>\DIAPAR\).
const mailPath = path.join(app.getPath('userData'), 'mail.json');
function mailRoot() { return path.join(app.getPath('documents'), 'GES', 'FACTURES-MAIL'); }
function mailCfg() { try { return JSON.parse(fs.readFileSync(mailPath, 'utf8')) || {}; } catch (e) { return {}; } }
function mailSave(c) { fs.writeFileSync(mailPath + '.tmp', JSON.stringify(c, null, 1), 'utf8'); fs.renameSync(mailPath + '.tmp', mailPath); }
function mailMdp(c) {
  if (!c.mdp) return '';
  try { if (c.chiffre && safeStorage && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(c.mdp, 'base64')); } catch (e) { return ''; }
  return c.chiffre ? '' : Buffer.from(c.mdp, 'base64').toString('utf8');
}
let MAIL_EN_COURS = null;
function mailInfos() {
  const c = mailCfg();
  return { actif: !!c.actif, hote: c.hote || 'imap.orange.fr', user: c.user || '', aMdp: !!c.mdp && !!mailMdp(c), dossiers: c.dossiers || [], depuis: c.depuis || '',
    exp: c.exp || {}, etat: c.etat || {}, enCours: !!MAIL_EN_COURS, racine: mailRoot() };
}
async function mailOuvrir(c) {
  const pass = mailMdp(c); if (!c.user || !pass) throw new Error('Adresse ou mot de passe de la boîte mail non réglé');
  const m = new MAIL.ImapLecture({ host: c.hote || 'imap.orange.fr', port: +process.env.GESMAR_IMAP_TEST_PORT || 993, user: c.user, pass, tlsOptions: process.env.GESMAR_IMAP_TEST_PORT ? { rejectUnauthorized: false } : {} }); // variable de test seulement
  await m.connect(); return m;
}
// Dossiers à lire : boîte de réception, corbeille, + ceux choisis (par leur nom, ex. SANDRINE)
function mailChoix(L, c) {
  const fin = (d) => String(d.nom).split(d.sep || '/').pop().toUpperCase();
  const out = [], vu = new Set(), add = (d, lib) => { if (d && !vu.has(d.nom)) { vu.add(d.nom); out.push({ nom: d.nom, lib }); } };
  add(L.find(d => d.nom.toUpperCase() === 'INBOX'), 'Boîte de réception');
  add(L.find(d => d.flags.some(f => /\\Trash/i.test(f))) || L.find(d => /^(CORBEILLE|TRASH|DELETED ITEMS|ÉLÉMENTS SUPPRIMÉS)$/i.test(fin(d))), 'Corbeille');
  for (const n of (c.dossiers || [])) add(L.find(d => fin(d) === String(n).trim().toUpperCase()), String(n).trim().toUpperCase());
  return out;
}
const mailNom = (s) => String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'facture.pdf';
async function mailReleve(prog) {
  if (MAIL_EN_COURS) return MAIL_EN_COURS;
  MAIL_EN_COURS = (async () => {
    const c = mailCfg(); if (!c.actif) return { ok: false, erreur: 'Boîte mail non activée' };
    const depuis = c.depuis || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const exp = c.exp || {}, faits = c.faits || {}, res = { ok: true, mails: 0, pdf: 0, nouveaux: 0, attente: 0, dossiers: [] };
    const m = await mailOuvrir(c);
    try {
      const L = await m.dossiers(), D = mailChoix(L, c);
      res.dossiers = D.map(d => d.lib);
      for (const d of D) {
        const uv = await m.examiner(d.nom); const pre = d.nom + '|' + uv + '|';
        const uids = (await m.chercher(MAIL.dateImap(depuis))).filter(u => !faits[pre + u]);
        if (prog) prog({ dossier: d.lib, n: uids.length });
        const H = await m.entetes(uids);
        for (const h of H) {
          res.mails++;
          const e = MAIL.expediteur(h.env), P = MAIL.pdfs(h.bs), iso = MAIL.isoDe(h.date);
          if (!P.length) { faits[pre + h.uid] = 1; continue; }
          res.pdf += P.length;
          const x = exp[e.adresse] || (exp[e.adresse] = { nom: e.nom, n: 0 });
          x.nom = x.nom || e.nom; x.dernier = iso > (x.dernier || '') ? iso : x.dernier; x.sujet = MAIL.sujet(h.env).slice(0, 120);
          x.vus = x.vus || {}; if (!x.vus[pre + h.uid]) { x.vus[pre + h.uid] = 1; x.n++; }
          if (x.f === undefined || x.f === null || x.f === '') { res.attente++; continue; } // expéditeur pas encore associé : on garde le mail pour plus tard
          if (x.f === '-') { faits[pre + h.uid] = 1; continue; } // ignoré
          const an = (iso || depuis).slice(0, 4);
          const dir = String(x.f).toUpperCase() === 'DIAPAR' ? path.join(mailRoot(), an, 'DIAPAR') : path.join(mailRoot(), an, 'FOURNISSEURS', mailNom(x.f));
          fs.mkdirSync(dir, { recursive: true });
          for (const p of P) {
            const v = await m.partie(h.uid, p.num); if (v == null) continue;
            const b = MAIL.decoder(v, p.enc); if (b.length < 100 || b.subarray(0, 5).toString('latin1') !== '%PDF-') continue;
            let nom = mailNom(p.nom); if (!/\.pdf$/i.test(nom)) nom += '.pdf';
            let f = path.join(dir, nom);
            if (fs.existsSync(f)) { if (fs.statSync(f).size === b.length) continue; f = path.join(dir, nom.replace(/\.pdf$/i, '') + '_' + h.uid + '.pdf'); if (fs.existsSync(f)) continue; }
            fs.writeFileSync(f + '.tmp', b); fs.renameSync(f + '.tmp', f);
            if (iso) { try { const t = new Date(iso + 'T12:00:00'); fs.utimesSync(f, t, t); } catch (_) {} }
            res.nouveaux++;
          }
          faits[pre + h.uid] = 1;
        }
      }
    } finally { m.fermer(); }
    const c2 = mailCfg(); c2.exp = exp; c2.faits = faits; c2.etat = { quand: Date.now(), ok: true, mails: res.mails, nouveaux: res.nouveaux, attente: res.attente, dossiers: res.dossiers }; mailSave(c2);
    return res;
  })().catch((e) => { const c2 = mailCfg(); c2.etat = { quand: Date.now(), ok: false, erreur: e.message }; mailSave(c2); return { ok: false, erreur: e.message }; })
    .finally(() => { MAIL_EN_COURS = null; });
  return MAIL_EN_COURS;
}
ipcMain.handle('gm:mailInfos', async () => mailInfos());
ipcMain.handle('gm:mailRegler', async (e, o) => {
  const c = mailCfg();
  if (o.user != null) c.user = String(o.user).trim().toLowerCase();
  if (o.hote != null) { const h = String(o.hote).trim().replace(/^imaps?:\/\//i, '').replace(/\/.*$/, ''); if (h && !/^[A-Za-z0-9.\-]+$/.test(h)) throw new Error('Serveur invalide'); c.hote = h || 'imap.orange.fr'; }
  if (o.pass) {
    if (safeStorage && safeStorage.isEncryptionAvailable()) { c.mdp = safeStorage.encryptString(String(o.pass)).toString('base64'); c.chiffre = true; }
    else { c.mdp = Buffer.from(String(o.pass), 'utf8').toString('base64'); c.chiffre = false; }
  }
  if (Array.isArray(o.dossiers)) c.dossiers = o.dossiers.map(x => String(x).trim()).filter(Boolean).slice(0, 10);
  if (o.depuis != null && /^\d{4}-\d{2}-\d{2}$/.test(o.depuis)) { if (c.depuis !== o.depuis) c.faits = {}; c.depuis = o.depuis; }
  if (o.actif != null) c.actif = !!o.actif;
  mailSave(c); return mailInfos();
});
ipcMain.handle('gm:mailExp', async (e, adresse, f) => { const c = mailCfg(); c.exp = c.exp || {}; const x = c.exp[String(adresse)]; if (x) { x.f = f == null ? '' : String(f); mailSave(c); } return mailInfos(); });
ipcMain.handle('gm:mailTester', async () => {
  const c = mailCfg(); const m = await mailOuvrir(c);
  try { const L = await m.dossiers(); return { ok: true, dossiers: mailChoix(L, c).map(d => d.lib), tous: L.map(d => String(d.nom).split(d.sep || '/').pop()).filter(n => n.toUpperCase() !== 'INBOX') }; }
  finally { m.fermer(); }
});
ipcMain.handle('gm:mailReleve', async () => mailReleve((p) => { try { if (win) win.webContents.send('gm:mailProg', p); } catch (_) {} }));
ipcMain.handle('gm:mailOuvrirDossier', async () => { fs.mkdirSync(mailRoot(), { recursive: true }); return shell.openPath(mailRoot()); });
// Relève automatique : 1 minute après l'ouverture, puis toutes les 15 minutes
setTimeout(() => { if (mailCfg().actif) mailReleve().catch(() => {}); }, 60000);
setInterval(() => { if (mailCfg().actif) mailReleve().catch(() => {}); }, 15 * 60000);

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
