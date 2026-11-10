'use strict';
// GES - choix du logiciel. Chargé par le preload de chaque logiciel (GESMAR, GESTIME, GESTAT, GESCOUNT).
// Un clic sur l'icône du logiciel (en haut à gauche, à côté du nom) ouvre une petite fenêtre :
// GESMAR, GESTIME, GESTAT, puis, à part et en bas, GESCOUNT marqué « Admin ».
module.exports = function (ipc) {
  const SEL = 'header.top .appico, .top .brand .bi, header .brand .bi';
  let infos = null;
  function lireInfos() { if (!infos) { try { infos = ipc.sendSync('ges:apps'); } catch (e) { infos = { courant: '', apps: [] }; } } return infos; }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function sombre() {
    try {
      const c = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
      if (c && c.length >= 3) return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) < 110;
    } catch (e) {}
    return false;
  }

  let hote = null;
  function fermer() { if (hote) { hote.remove(); hote = null; } document.removeEventListener('keydown', echap, true); }
  function echap(e) { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); fermer(); } }

  function ouvrir() {
    if (hote) { fermer(); return; }
    const I = lireInfos(), dk = sombre();
    const ligne = (a) => `<button class="app${a.id === I.courant ? ' on' : ''}${a.admin ? ' adm' : ''}" data-id="${esc(a.id)}">
        <img src="${esc(a.icone)}" alt="">
        <span class="t"><b>GES<i>${esc(a.suffixe)}</i></b><small>${esc(a.desc)}</small></span>
        ${a.id === I.courant ? '<span class="ici">ouvert</span>' : a.admin ? '<span class="tag">🔒 Admin</span>' : ''}
      </button>`;
    const normaux = I.apps.filter(a => !a.admin).map(ligne).join('');
    const admins = I.apps.filter(a => a.admin).map(ligne).join('');
    hote = document.createElement('div');
    hote.style.cssText = 'position:fixed;inset:0;z-index:2147483646';
    const sr = hote.attachShadow({ mode: 'open' });
    sr.innerHTML = `<style>
      :host{all:initial}
      .fond{position:fixed;inset:0;background:rgba(0,0,0,.45)}
      .boite{position:fixed;left:18px;top:70px;width:340px;max-width:calc(100vw - 36px);border-radius:14px;padding:14px;
        font:14px system-ui,"Segoe UI",sans-serif;background:${dk ? '#2a2b2e' : '#fff'};color:${dk ? '#eceae4' : '#1d1f1e'};
        box-shadow:0 12px 40px rgba(0,0,0,.35);border:1px solid ${dk ? '#3a3b3f' : '#e2e0d8'}}
      h3{margin:2px 4px 10px;font-size:16px;font-weight:800}
      .app{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:12px;width:100%;padding:9px 10px;border-radius:10px;cursor:pointer;margin:2px 0;border:2px solid transparent}
      .app:hover{background:${dk ? '#34363a' : '#f2f1ec'}}
      .app.on{border-color:${dk ? '#3fbf3a' : '#237a3b'};background:${dk ? '#25331f' : '#eef6ef'};cursor:default}
      .app img{width:40px;height:40px;border-radius:9px;flex:none}
      .t{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
      .t b{font-size:17px;font-weight:900;letter-spacing:.01em}
      .t i{font-style:normal;color:${dk ? '#f0473d' : '#d3262b'}}
      .t small{font-size:12px;opacity:.7}
      .ici{font-size:11px;font-weight:700;color:${dk ? '#3fbf3a' : '#237a3b'};text-transform:uppercase;letter-spacing:.06em}
      .sep{display:flex;align-items:center;gap:8px;margin:12px 4px 6px;font-size:11px;font-weight:800;letter-spacing:.12em;color:${dk ? '#f29d00' : '#b06a00'}}
      .sep:before,.sep:after{content:"";flex:1;height:1px;background:${dk ? '#4a4b50' : '#dcd9cf'}}
      .adm{background:${dk ? '#33291a' : '#fff6e5'}}
      .adm:hover{background:${dk ? '#3d311f' : '#ffefcf'}}
      .tag{font-size:11px;font-weight:800;padding:3px 7px;border-radius:6px;background:${dk ? '#f29d00' : '#f29d00'};color:#1d1f1e;white-space:nowrap}
      .note{margin:6px 4px 0;font-size:11px;opacity:.65}
    </style>
    <div class="fond"></div>
    <div class="boite" role="dialog" aria-label="Changer de logiciel">
      <h3>Changer de logiciel</h3>
      ${normaux}
      ${admins ? '<div class="sep">ADMIN</div>' + admins + '<div class="note">Réservé à la direction.</div>' : ''}
    </div>`;
    // place la boîte sous l'icône cliquée
    try { const ic = document.querySelector(SEL); if (ic) { const r = ic.getBoundingClientRect(); const b = sr.querySelector('.boite'); b.style.left = Math.max(10, r.left) + 'px'; b.style.top = (r.bottom + 8) + 'px'; } } catch (e) {}
    sr.querySelector('.fond').addEventListener('click', fermer);
    sr.querySelectorAll('.app').forEach(b => b.addEventListener('click', () => { const id = b.dataset.id; fermer(); if (id !== I.courant) ipc.send('ges:montrer', id); }));
    document.body.appendChild(hote);
    document.addEventListener('keydown', echap, true);
  }

  window.addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style');
    st.textContent = `${SEL.split(',').map(s => s.trim()).join(',')}{cursor:pointer;position:relative}
      ${SEL.split(',').map(s => s.trim() + ':hover').join(',')}{filter:brightness(1.08)}
      .ges-sw{position:absolute;right:-5px;bottom:-5px;width:18px;height:18px;border-radius:50%;background:#fff;color:#237a3b;display:grid;place-items:center;box-shadow:0 1px 3px rgba(0,0,0,.35);pointer-events:none}
      .ges-sw svg{width:12px;height:12px}`;
    document.head.appendChild(st);
    const badge = () => document.querySelectorAll(SEL).forEach(ic => {
      let hoteBadge = ic;
      if (ic.namespaceURI === 'http://www.w3.org/2000/svg') { // GESTIME : l'icône est un dessin SVG, on l'entoure pour y poser la pastille
        if (ic.parentNode.classList && ic.parentNode.classList.contains('ges-bi')) hoteBadge = ic.parentNode;
        else { const w = document.createElement('span'); w.className = 'ges-bi'; w.style.cssText = 'position:relative;display:inline-flex;flex:none;cursor:pointer'; ic.parentNode.insertBefore(w, ic); w.appendChild(ic); hoteBadge = w; }
      }
      if (hoteBadge.querySelector('.ges-sw')) return;
      ic.removeAttribute('aria-hidden'); hoteBadge.title = 'Changer de logiciel'; hoteBadge.setAttribute('role', 'button');
      hoteBadge.insertAdjacentHTML('beforeend','<span class="ges-sw" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg></span>');
    });
    badge(); setTimeout(badge, 1500); setTimeout(badge, 5000);
  });
  // clic délégué : marche même si la page redessine son bandeau
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest && e.target.closest(SEL);
    if (!t) return;
    if (t.closest('.lockbox')) return; // écran de verrouillage de GESCOUNT : pas de changement
    e.preventDefault(); e.stopPropagation(); ouvrir();
  }, true);
};
