'use strict';
// GESMAR 1.6.0 - factures reçues par mail : lecture d'une boîte mail en IMAP, LECTURE SEULE.
// - Les dossiers sont ouverts avec EXAMINE (lecture seule pour le serveur) et les pièces jointes lues avec BODY.PEEK
//   (le mail n'est pas marqué comme lu). Liste blanche de commandes : rien d'autre ne peut partir vers le serveur
//   (pas de STORE, COPY, MOVE, EXPUNGE, DELETE, APPEND…) : impossible de supprimer, déplacer ou modifier un mail.
// - Seules les pièces jointes PDF des expéditeurs associés à un fournisseur sont enregistrées sur le PC.
const tls = require('tls');

const PERMIS = /^(CAPABILITY|LOGIN|LIST|EXAMINE|UID SEARCH|UID FETCH|LOGOUT|NOOP)\b/;

class ImapLecture {
  constructor({ host, port, user, pass, timeout, tlsOptions }) {
    this.tlsOptions = tlsOptions || {}; this.host = host; this.port = port || 993; this.user = user; this.pass = pass; this.timeout = timeout || 60000;
    this.buf = Buffer.alloc(0); this.n = 0; this.attente = null; this.sock = null;
  }
  connect() {
    return new Promise((res, rej) => {
      let fini = false;
      const t = setTimeout(() => { if (!fini) { fini = true; rej(new Error('Serveur mail injoignable (' + this.host + ')')); this.fermer(); } }, 20000);
      this.sock = tls.connect(Object.assign({ host: this.host, port: this.port, servername: this.host }, this.tlsOptions), () => {});
      this.sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.lire(); });
      this.sock.on('error', (e) => { if (!fini) { fini = true; clearTimeout(t); rej(new Error('Connexion au serveur mail impossible : ' + e.message)); } else if (this.attente) { const a = this.attente; this.attente = null; a.rej(e); } });
      this.sock.on('close', () => { if (this.attente) { const a = this.attente; this.attente = null; a.rej(new Error('Connexion fermée par le serveur')); } });
      // salutation du serveur : « * OK … »
      this.attente = { tag: '*', lignes: [], res: () => { if (!fini) { fini = true; clearTimeout(t); res(); } }, rej: (e) => { if (!fini) { fini = true; clearTimeout(t); rej(e); } } };
    }).then(() => this.cmd('LOGIN ' + q(this.user) + ' ' + q(this.pass)).catch((e) => {
      throw new Error(/AUTHENTICATIONFAILED|LOGIN|invalid|incorrect|failed/i.test(e.message) ? 'Adresse ou mot de passe refusé par le serveur mail' : e.message);
    }));
  }
  // Découpe la réponse : lignes terminées par CRLF ; « {n} » en fin de ligne = n octets bruts (littéral) qui suivent.
  lire() {
    for (;;) {
      const a = this.attente; if (!a) return;
      if (a.lit != null) {
        if (this.buf.length < a.lit) return;
        a.cour.push(this.buf.subarray(0, a.lit)); this.buf = this.buf.subarray(a.lit); a.lit = null; continue;
      }
      const i = this.buf.indexOf('\r\n'); if (i < 0) return;
      const l = this.buf.subarray(0, i).toString('latin1'); this.buf = this.buf.subarray(i + 2);
      a.cour = a.cour || [];
      a.cour.push(l);
      const m = /\{(\d+)\}$/.exec(l);
      if (m) { a.lit = +m[1]; continue; }
      const ligne = a.cour; a.cour = null;
      if (a.tag === '*') { this.attente = null; if (/^\* (OK|PREAUTH)/i.test(ligne[0])) a.res(); else a.rej(new Error('Serveur mail : ' + ligne[0])); return; }
      if (ligne[0].startsWith(a.tag + ' ')) {
        this.attente = null; clearTimeout(a.t);
        if (/^\S+ OK/i.test(ligne[0])) a.res(a.lignes); else a.rej(new Error(ligne[0].slice(a.tag.length + 1)));
        continue;
      }
      a.lignes.push(ligne);
    }
  }
  cmd(c) {
    if (!PERMIS.test(c)) return Promise.reject(new Error('Commande refusée (lecture seule) : ' + c.split(' ')[0]));
    if (/^UID FETCH/.test(c) && /BODY\[/i.test(c)) return Promise.reject(new Error('Lecture refusée : BODY.PEEK obligatoire'));
    if (this.attente) return Promise.reject(new Error('Commande déjà en cours'));
    const tag = 'G' + (++this.n);
    return new Promise((res, rej) => {
      const a = { tag, lignes: [], res, rej, cour: null, lit: null };
      a.t = setTimeout(() => { if (this.attente === a) { this.attente = null; rej(new Error('Le serveur mail ne répond pas')); this.fermer(); } }, this.timeout);
      this.attente = a;
      this.sock.write(tag + ' ' + c + '\r\n');
      this.lire();
    });
  }
  async dossiers() {
    const L = await this.cmd('LIST "" "*"'), out = [];
    for (const parts of L) {
      const v = parse(parts); // * LIST (\flags) "/" "nom"
      if (!Array.isArray(v) || String(v[1]).toUpperCase() !== 'LIST') continue;
      out.push({ flags: (v[2] || []).map(String), sep: v[3], nom: txt(v[4]) });
    }
    return out;
  }
  async examiner(nom) {
    const L = await this.cmd('EXAMINE ' + q(nom));
    let uv = '';
    for (const p of L) { const m = /UIDVALIDITY (\d+)/i.exec(p[0]); if (m) uv = m[1]; }
    return uv;
  }
  async chercher(depuis) {
    const L = await this.cmd('UID SEARCH SINCE ' + depuis);
    const u = [];
    for (const p of L) { const m = /^\* SEARCH(.*)$/i.exec(p[0]); if (m) m[1].trim().split(/\s+/).filter(Boolean).forEach(x => u.push(+x)); }
    return u;
  }
  // Enveloppe + structure de chaque mail (sans le contenu)
  async entetes(uids) {
    const out = [];
    for (let i = 0; i < uids.length; i += 40) {
      const L = await this.cmd('UID FETCH ' + uids.slice(i, i + 40).join(',') + ' (UID INTERNALDATE ENVELOPE BODYSTRUCTURE)');
      for (const p of L) {
        const v = parse(p); if (!Array.isArray(v) || String(v[2]).toUpperCase() !== 'FETCH') continue;
        const o = kv(v[3]);
        out.push({ uid: +o.UID, date: txt(o.INTERNALDATE), env: o.ENVELOPE, bs: o.BODYSTRUCTURE });
      }
    }
    return out;
  }
  async partie(uid, num) {
    const L = await this.cmd('UID FETCH ' + uid + ' (BODY.PEEK[' + num + '])');
    for (const p of L) {
      const v = parse(p); if (!Array.isArray(v) || String(v[2]).toUpperCase() !== 'FETCH') continue;
      const a = v[3]; for (let i = 0; i < a.length - 1; i++) if (/^BODY\[/i.test(String(a[i]))) return a[i + 1];
    }
    return null;
  }
  fermer() { try { if (this.sock) { if (!this.attente) this.sock.write('G0 LOGOUT\r\n'); this.sock.end(); } } catch (e) {} }
}

function q(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

// Lecteur des réponses IMAP : listes (…), chaînes "…", littéraux (Buffer), NIL, atomes (BODY[2] compris)
function parse(parts) {
  const toks = [];
  parts.forEach((x, i) => { if (Buffer.isBuffer(x)) toks.push({ lit: x }); else { let s = x; if (i < parts.length - 1) s = s.replace(/\{\d+\}$/, ''); toks.push(s); } });
  let ti = 0, s = '', pos = 0;
  const suivant = () => { if (ti < toks.length) { const t = toks[ti++]; if (t && t.lit) return t; s = t; pos = 0; } return null; };
  suivant();
  function val() {
    for (;;) {
      while (pos < s.length && s[pos] === ' ') pos++;
      if (pos >= s.length) { const l = suivant(); if (l) return l.lit; if (pos >= s.length && ti >= toks.length) return undefined; continue; }
      const c = s[pos];
      if (c === '(') { pos++; const a = []; for (;;) { while (pos < s.length && s[pos] === ' ') pos++; if (s[pos] === ')') { pos++; return a; } if (pos >= s.length) { const l = suivant(); if (l) { a.push(l.lit); continue; } if (pos >= s.length && ti >= toks.length) return a; continue; } a.push(val()); } }
      if (c === '"') { pos++; let o = ''; while (pos < s.length && s[pos] !== '"') { if (s[pos] === '\\') pos++; o += s[pos++]; } pos++; return o; }
      let o = ''; let d = 0;
      while (pos < s.length) { const ch = s[pos]; if (ch === '[') d++; if (ch === ']') d--; if (d <= 0 && (ch === ' ' || ch === '(' || ch === ')') && !(ch === '(' && d > 0)) break; o += ch; pos++; }
      if (o === '') { pos++; continue; } // « ) » en trop : ignoré
      return /^NIL$/i.test(o) ? null : o;
    }
  }
  const out = []; for (;;) { const v = val(); if (v === undefined) break; out.push(v); if (pos >= s.length && ti >= toks.length) break; }
  return out;
}
function kv(a) { const o = {}; for (let i = 0; a && i < a.length - 1; i += 2) o[String(a[i]).toUpperCase()] = a[i + 1]; return o; }
function txt(v) { return v == null ? '' : Buffer.isBuffer(v) ? v.toString('utf8') : String(v); }

// En-têtes encodés (=?UTF-8?B?…?= / =?ISO-8859-1?Q?…?=)
function mime2(s) {
  return String(s || '').replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=\s*(?==\?)/gi, '=?$1?$2?$3?=').replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (m, cs, e, t) => {
    let b; try { b = /b/i.test(e) ? Buffer.from(t, 'base64') : Buffer.from(t.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1'); } catch (_) { return m; }
    return /utf-?8/i.test(cs) ? b.toString('utf8') : b.toString('latin1');
  });
}
// Expéditeur de l'enveloppe : (date subject from sender reply-to to cc bcc in-reply-to message-id)
function expediteur(env) {
  const f = env && env[2] && env[2][0]; if (!f) return { adresse: '', nom: '' };
  const adr = (txt(f[2]) + '@' + txt(f[3])).toLowerCase();
  return { adresse: adr, nom: mime2(txt(f[0])) };
}
function sujet(env) { return mime2(txt(env && env[1])); }
// Pièces jointes PDF dans BODYSTRUCTURE : [{num, nom, enc}]
function pdfs(bs) {
  const out = [];
  const visite = (b, num) => {
    if (!Array.isArray(b)) return;
    if (Array.isArray(b[0])) { let i = 0; for (; i < b.length && Array.isArray(b[i]); i++) visite(b[i], (num ? num + '.' : '') + (i + 1)); return; }
    const type = String(b[0] || '').toLowerCase(), sous = String(b[1] || '').toLowerCase();
    const params = kvl(b[2]), enc = String(b[5] || '').toLowerCase();
    let nom = params.name || '';
    // disposition (champ 8 ou 9 selon le type) : ("attachment" ("filename" "x.pdf"))
    for (const x of b.slice(7)) if (Array.isArray(x) && x.length >= 2 && Array.isArray(x[1])) { const d = kvl(x[1]); nom = d.filename || d['filename*'] || nom; }
    if (/^[\w-]+''/.test(nom)) { const cs = nom.split("''")[0]; const b = Buffer.from(nom.slice(cs.length + 2).replace(/%([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1'); nom = /utf-?8/i.test(cs) ? b.toString('utf8') : b.toString('latin1'); } // RFC 2231
    nom = mime2(nom);
    if ((type === 'application' && sous === 'pdf') || /\.pdf$/i.test(nom)) out.push({ num: num || '1', nom: nom || 'facture.pdf', enc });
    if (type === 'message' && sous === 'rfc822' && Array.isArray(b[8])) visite(b[8], num || '1'); // mail transféré avec sa pièce jointe
  };
  visite(bs, '');
  return out;
}
function kvl(a) { const o = {}; if (Array.isArray(a)) for (let i = 0; i < a.length - 1; i += 2) o[String(a[i]).toLowerCase()] = txt(a[i + 1]); return o; }
function decoder(v, enc) {
  const b = Buffer.isBuffer(v) ? v : Buffer.from(String(v || ''), 'latin1');
  if (enc === 'base64') return Buffer.from(b.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (enc === 'quoted-printable') return Buffer.from(b.toString('latin1').replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
  return b;
}
const MOIS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateImap(iso) { const [y, m, d] = String(iso).split('-'); return (+d) + '-' + MOIS[+m - 1] + '-' + y; }
function isoDe(internal) { const m = /(\d{1,2})-(\w{3})-(\d{4})/.exec(internal || ''); if (!m) return ''; return m[3] + '-' + String(MOIS.indexOf(m[2]) + 1).padStart(2, '0') + '-' + m[1].padStart(2, '0'); }

module.exports = { ImapLecture, parse, expediteur, sujet, pdfs, decoder, dateImap, isoDe, mime2 };
