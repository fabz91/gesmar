
/* ================= Stockage local + synchronisation (comme GESTIME) =================
   Même interface que la base en ligne : doc(), collection(), get/set/update/delete, onSnapshot.
   Les données sont rangées PAR MAGASIN : un enregistrement par magasin (bredis, clamart…) + « commun » (logo).
   PC : fichiers gesmar-<id>.json dans le dossier des données (window.api). Navigateur : localStorage.
   Synchronisation Supabase (table « gesmar », une ligne par magasin) : envoi après chaque modification,
   relecture toutes les 15 s, numéro de révision « rev » pour ne jamais écraser la saisie d'un autre poste. */
const SEED=__SEED__;
const PC=!!(window.api&&typeof window.api.load==="function");
const LS_PRE="gesmar.v2.";
function rawLoad(name){try{return PC?window.api.load(name):localStorage.getItem(LS_PRE+name)}catch(e){return null}}
function rawSave(name,j){if(PC)window.api.save(name,j);else localStorage.setItem(LS_PRE+name,j)}
const clone=o=>JSON.parse(JSON.stringify(o));
const blobOf=path=>{const s=path.split("/");return s[0]==="magasins"&&s[1]?s[1]:"commun"};
const DEFAULT_IDS=["commun","bredis","clamart"];

let STORE={};const META={}; // META[id] = {rev, dirty:{chemin:compteur}, base:{chemin: version du serveur avant la modification}}
const meta=id=>META[id]||(META[id]={rev:0,dirty:{},base:{}});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const isObj=o=>o&&typeof o==="object"&&!Array.isArray(o);
// Fusion case par case (même règle que GESTIME) : chaque poste garde ses saisies ;
// une case tapée EN MÊME TEMPS sur deux postes est effacée partout et doit être réécrite.
function gmMerge(base,mine,theirs,res){const J=JSON.stringify,eq=(a,b)=>J(a)===J(b),obj=o=>o&&typeof o==="object"&&!Array.isArray(o),prim=v=>v===undefined||v===null||typeof v!=="object",cp=v=>v===undefined?undefined:JSON.parse(J(v));
  if(eq(mine,base))return cp(theirs);if(eq(theirs,base))return cp(mine);if(eq(mine,theirs))return cp(mine);
  if(obj(mine)&&obj(theirs)){const b=obj(base)?base:{},o={};for(const k of new Set([...Object.keys(b),...Object.keys(mine),...Object.keys(theirs)])){const v=gmMerge(b[k],mine[k],theirs[k],res);if(v!==undefined)o[k]=v}return o}
  if(Array.isArray(mine)&&Array.isArray(theirs)){const idd=a=>a.every(x=>obj(x)&&x.id!=null);
    if(idd(mine)&&idd(theirs)){const B=new Map((Array.isArray(base)&&idd(base)?base:[]).map(x=>[x.id,x])),M=new Map(mine.map(x=>[x.id,x])),T=new Map(theirs.map(x=>[x.id,x])),out=[];
      for(const i of [...mine.map(x=>x.id),...theirs.map(x=>x.id).filter(i=>!M.has(i))]){const v=gmMerge(B.get(i),M.get(i),T.get(i),res);if(v!==undefined)out.push(v)}return out}
    return cp(mine)}
  if(prim(mine)&&prim(theirs)){res.n++;return typeof mine==="string"||typeof theirs==="string"?"":undefined}
  return cp(mine)}
const EFF_MSG="⚠️ Une case a été tapée en même temps sur un autre poste : elle a été effacée, réécrivez-la.";
function gmNotice(msg){let n=document.getElementById("gtn");if(!n){n=document.createElement("div");n.id="gtn";n.setAttribute("role","alert");document.body.appendChild(n);n.addEventListener("click",()=>n.remove())}
  n.textContent=msg+"  ✕";clearTimeout(gmNotice.t);gmNotice.t=setTimeout(()=>{const x=document.getElementById("gtn");if(x)x.remove()},10000)}
function mark(path){const m=meta(blobOf(path));if(!(path in m.dirty)&&!(path in m.base))m.base[path]=STORE[path]===undefined?null:clone(STORE[path])}
function blobDocs(id){const o={};for(const k of Object.keys(STORE))if(blobOf(k)===id)o[k]=STORE[k];return o}
function knownIds(){const s=new Set(DEFAULT_IDS);Object.keys(STORE).forEach(k=>s.add(blobOf(k)));Object.keys(META).forEach(k=>s.add(k));return[...s]}
function saveBlob(id){const m=meta(id);rawSave("gesmar-"+id,JSON.stringify({app:"GESMAR",magasin:id,rev:m.rev,dirty:Object.keys(m.dirty),base:m.base,docs:blobDocs(id)}))}

/* --- chargement : fichiers par magasin ; sinon reprise de l'ancien fichier unique (ou des données de départ) --- */
(function boot(){
  let found=false,extra=[];try{extra=JSON.parse(rawLoad("gesmar-index")||"[]")}catch(e){}
  for(const id of new Set(DEFAULT_IDS.concat(extra))){
    let b=null;try{b=JSON.parse(rawLoad("gesmar-"+id)||"null")}catch(e){}
    if(b&&b.docs){found=true;Object.assign(STORE,b.docs);const m=meta(id);m.rev=b.rev||0;(b.dirty||[]).forEach(p=>m.dirty[p]=1);m.base=b.base||{}}
  }
  if(!found){
    let old=null;try{old=JSON.parse((PC?window.api.load("gesmar"):localStorage.getItem("gesmar.db.v1"))||"null")}catch(e){}
    if(old&&old.data&&typeof old.data==="object"&&!Array.isArray(old.data))old=old.data; // fichier d'export
    STORE=old&&typeof old==="object"?old:clone(SEED);
    for(const k of Object.keys(STORE))if(k.startsWith("__meta/"))delete STORE[k];
    try{knownIds().forEach(saveBlob);rawSave("gesmar-index",JSON.stringify(knownIds()))}catch(e){}
  }
})();

const LISTENERS=new Set();let notifyQueued=false;
function notify(){if(!notifyQueued){notifyQueued=true;setTimeout(()=>{notifyQueued=false;LISTENERS.forEach(f=>f())},0)}}
function persist(path){const id=blobOf(path),m=meta(id);m.dirty[path]=(m.dirty[path]||0)+1;
  try{saveBlob(id);if(!DEFAULT_IDS.includes(id))rawSave("gesmar-index",JSON.stringify(knownIds()))}
  catch(e){throw{code:"quota_exceeded",message:PC?"Enregistrement sur le disque impossible":"Stockage du navigateur plein"}}
  notify();SYNC.schedule(id)}
function deepMerge(t,p){for(const[k,v]of Object.entries(p)){if(v&&typeof v==="object"&&!Array.isArray(v)&&t[k]&&typeof t[k]==="object"&&!Array.isArray(t[k]))deepMerge(t[k],v);else t[k]=clone(v)}return t}
const freeze=o=>o==null?o:Object.freeze(clone(o));
function snapDoc(path){const b=STORE[path];return{id:path.split("/").pop(),exists:b!==undefined,data:()=>b===undefined?undefined:freeze(b),metadata:{fromCache:false,hasPendingWrites:false}}}
function docRef(path){
  const segs=path.split("/");if(segs.length%2)throw new TypeError("Chemin de document invalide : "+path);
  return{id:segs[segs.length-1],path,
    get:async()=>snapDoc(path),
    set:async b=>{mark(path);STORE[path]=clone(b);persist(path)},
    update:async p=>{if(STORE[path]===undefined)throw{code:"invalid_argument",message:"Document absent"};mark(path);deepMerge(STORE[path],p);persist(path)},
    delete:async()=>{mark(path);delete STORE[path];persist(path)},
    onSnapshot:(next)=>{const f=()=>next(snapDoc(path));LISTENERS.add(f);setTimeout(f,0);return()=>LISTENERS.delete(f)},
    collection:sub=>colRef(path+"/"+sub)};
}
function colRef(path){
  const pre=path+"/";
  const docs=()=>Object.keys(STORE).filter(k=>k.startsWith(pre)&&!k.slice(pre.length).includes("/")).sort().map(snapDoc);
  const snap=()=>{const d=docs();return{docs:d,size:d.length,empty:!d.length,docChanges:()=>[],metadata:{fromCache:false,hasPendingWrites:false}}};
  return{path,doc:id=>docRef(pre+(id||("id"+Date.now().toString(36)+Math.random().toString(36).slice(2,8)))),
    add:async b=>{const r=docRef(pre+"id"+Date.now().toString(36)+Math.random().toString(36).slice(2,8));await r.set(b);return r},
    get:async()=>snap(),
    onSnapshot:(next)=>{const f=()=>next(snap());LISTENERS.add(f);setTimeout(f,0);return()=>LISTENERS.delete(f)},
    where(){return this},orderBy(){return this},limit(){return this}};
}
const LocalDB={doc:docRef,collection:colRef};

/* ================= Synchronisation Supabase ================= */
const SYNC=(()=>{
  const st={state:"off",msg:"Synchronisation non réglée",busy:false,timer:null,pend:new Set(),poll:null,started:false};
  function cfg(){let c=window.SYNC&&window.SYNC.url&&window.SYNC.key?{url:window.SYNC.url,key:window.SYNC.key}:null;
    if(!c){try{const s=JSON.parse(rawLoad("gesmar-sync")||"null");if(s&&s.url&&s.key)c=s}catch(e){}}
    if(c&&/VOTRE/.test(c.url+"|"+c.key))c=null;if(c)c={url:String(c.url).trim().replace(/\/+$/,""),key:String(c.key).trim()};return c}
  const ERR=/Erreur|Accès|Table/;
  function set(state,msg){const ch=st.state!==state||st.msg!==msg;st.state=state;st.msg=msg;if(ch&&typeof renderModal==="function"&&S.modal)renderModal()}
  async function req(path,opt){const c=cfg();
    const r=await fetch(c.url+"/rest/v1/"+path,Object.assign({},opt,{headers:Object.assign({apikey:c.key,"Content-Type":"application/json"},(c.key.split(".").length===3?{Authorization:"Bearer "+c.key}:{}),opt&&opt.headers)}));
    if(!r.ok){let t="";try{t=(await r.json()).message||""}catch(e){}
      throw new Error(r.status===401||r.status===403?"Accès refusé par la base (vérifiez la clé et le script SQL)":r.status===404||/does not exist|schema cache/.test(t)?"Table « gesmar » absente : lancez le script SQL dans Supabase":"Erreur "+r.status+(t?" : "+t:""))}
    return r.status===204||r.status===201?null:r.json()}
  const pull=async id=>{const a=await req("gesmar?id=eq."+encodeURIComponent(id)+"&select=data,rev");return a&&a[0]||null};
  const hasDocs=o=>!!(o&&o.docs&&Object.keys(o.docs).length);
  // Prend la version du serveur pour un magasin, en gardant les modifications locales pas encore envoyées.
  function adopt(id,row){const m=meta(id),rd=(row.data&&row.data.docs)||{};
    for(const k of Object.keys(STORE))if(blobOf(k)===id&&!(k in m.dirty)&&!(k in rd))delete STORE[k];
    for(const[k,v]of Object.entries(rd))if(!(k in m.dirty))STORE[k]=v;
    const res={n:0};
    for(const k of Object.keys(m.dirty)){ // case par case pour les documents que ce poste a modifiés
      const theirs=rd[k],v=(k in m.base)?gmMerge(m.base[k]===null?undefined:m.base[k],STORE[k],theirs,res):STORE[k];
      if(v===undefined)delete STORE[k];else STORE[k]=v;m.base[k]=theirs===undefined?null:clone(theirs)}
    m.rev=row.rev;
    if(res.n){m.eff=Date.now();m.effSeen=m.eff;gmNotice(EFF_MSG)}
    else{const e=row.data&&row.data.eff;if(e&&e>(m.effSeen||0)){if(st.started&&m.seenOnce)gmNotice(EFF_MSG);m.effSeen=e}}
    m.seenOnce=true;saveBlob(id);notify()}
  async function push(id){const m=meta(id);
    for(let essai=0;essai<4;essai++){
      const sent=Object.assign({},m.dirty),body={data:{app:"GESMAR",magasin:id,docs:blobDocs(id),eff:m.eff||undefined},rev:m.rev+1,updated_at:new Date().toISOString()};
      const a=await req("gesmar?id=eq."+encodeURIComponent(id)+"&rev=eq."+m.rev,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(body)});
      if(a&&a.length){m.rev=a[0].rev;for(const[p,n]of Object.entries(sent))if(m.dirty[p]===n){delete m.dirty[p];delete m.base[p]}else m.base[p]=body.data.docs[p]===undefined?null:clone(body.data.docs[p]);saveBlob(id);return}
      const r=await pull(id);
      if(!r){await req("gesmar",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({id,data:{app:"GESMAR",magasin:id,docs:{}},rev:0})});m.rev=0;continue}
      adopt(id,r); // un autre poste venait d'enregistrer : on reprend sa version + nos modifications, puis on renvoie
    }
    throw new Error("Erreur : trop de modifications en même temps, nouvel essai bientôt")}
  async function flush(){if(st.busy||!cfg()||!st.started)return;st.busy=true;const ids=[...st.pend];st.pend.clear();set("wait","Envoi…");
    try{for(const id of ids)await push(id);set("ok","Synchronisé avec les autres postes")}
    catch(e){ids.forEach(i=>st.pend.add(i));set("ko",ERR.test(e.message)?e.message:"Hors ligne : modifications gardées sur cet appareil");setTimeout(flush,5000)}
    finally{st.busy=false;if(st.pend.size&&st.state!=="ko")setTimeout(flush,800)}}
  function schedule(id){if(!cfg()||!st.started)return;st.pend.add(id);clearTimeout(st.timer);st.timer=setTimeout(flush,800)}
  async function first(){ // au démarrage : on compare chaque magasin avec le serveur
    try{const all=await req("gesmar?select=id,rev");for(const x of all||[])meta(x.id)}catch(e){throw e}
    for(const id of knownIds()){const m=meta(id),r=await pull(id),n=Object.keys(blobDocs(id)).length;
      if(r&&r.data&&r.data.eff)m.effSeen=Math.max(m.effSeen||0,r.data.eff);
      if(!r){if(n)st.pend.add(id);continue}
      if(!hasDocs(r.data)){m.rev=r.rev;if(n)st.pend.add(id);continue} // ligne vide : ce poste y envoie ses données
      if(r.rev>m.rev){if(m.rev===0&&n){try{rawSave("gesmar-"+id+"-avant-synchro",JSON.stringify({app:"GESMAR",magasin:id,docs:blobDocs(id)}))}catch(e){}}
        adopt(id,r)}
      else if(r.rev<m.rev)m.rev=r.rev; // la base a été remise à zéro : on renvoie tout
      if(Object.keys(m.dirty).length)st.pend.add(id)}
    knownIds().forEach(id=>{meta(id).seenOnce=true});
    rawSave("gesmar-index",JSON.stringify(knownIds()))}
  async function poll(){if(!cfg()||!st.started||st.busy||st.pend.size)return;const a=document.activeElement;if(a&&/INPUT|SELECT|TEXTAREA/.test(a.tagName))return;
    try{const all=await req("gesmar?select=id,rev");let ch=false;
      for(const x of all||[]){const m=meta(x.id);if(x.rev>m.rev){const r=await pull(x.id);if(r){adopt(x.id,r);ch=true;if(Object.keys(m.dirty).length)st.pend.add(x.id)}}}
      if(st.pend.size)flush();else set("ok",ch?"Mis à jour depuis un autre poste":"Synchronisé avec les autres postes")}
    catch(e){set("ko",ERR.test(e.message)?e.message:"Hors ligne")}}
  let visHook=false;
  async function start(){if(st.started)return;if(!cfg()){set("off","Synchronisation non réglée");return}
    st.started=true;set("wait","Synchronisation…");
    try{await first();if(st.pend.size)await flush();else set("ok","Synchronisé avec les autres postes")}
    catch(e){st.started=false;set("ko",ERR.test(e.message)?e.message:"Hors ligne : modifications gardées sur cet appareil");setTimeout(start,15000);return}
    clearInterval(st.poll);st.poll=setInterval(poll,15000);
    if(!visHook){visHook=true;document.addEventListener("visibilitychange",()=>{if(!document.hidden)poll()})}}
  function configure(url,key){rawSave("gesmar-sync",JSON.stringify({url:String(url).trim(),key:String(key).trim()}));st.started=false;return start()}
  function markAll(){for(const k of Object.keys(STORE)){const m=meta(blobOf(k));m.dirty[k]=(m.dirty[k]||0)+1}knownIds().forEach(id=>{saveBlob(id);schedule(id)})}
  return{st,cfg,start,schedule,configure,markAll,poll};
})();
window.GESMAR={sync:SYNC,docs:()=>Object.keys(STORE).length}; // pour le diagnostic

const LocalAssets={
  upload:file=>new Promise((res,rej)=>{if(!file)return rej({code:"invalid_request"});if(file.size>1.5e6)return rej({code:"too_large"});
    const r=new FileReader();r.onload=()=>{const id="logo"+Date.now();STORE["__assets/"+id]={src:r.result};try{persist("__assets/"+id);res({id,url:r.result})}catch(e){rej(e)}};r.onerror=()=>rej({code:"invalid_request"});r.readAsDataURL(file)}),
  delete:async id=>{const had=!!STORE["__assets/"+id];delete STORE["__assets/"+id];persist("__assets/"+id);return{deleted:had}}};
function blobSrc(id){if(S.local){const a=STORE["__assets/"+id];return a?a.src:""}return "/_blob/"+id}
async function exportData(){
  const j=JSON.stringify({app:"GESMAR",version:APP_VERSION,exporte:new Date().toISOString(),data:STORE},null,1);
  if(PC){try{if(await window.api.exportData(j,"gesmar"))toast("Sauvegarde exportée")}catch(e){toast("Export impossible")}return}
  const blob=new Blob([j],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="GESMAR-sauvegarde-"+todayISO()+".json";document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);toast("Sauvegarde exportée")}
function applyImportText(t){try{const j=JSON.parse(t);const d=j&&j.data;if(!d||typeof d!=="object")throw 0;
    const before=Object.keys(STORE);STORE=clone(d);for(const k of Object.keys(STORE))if(k.startsWith("__meta/"))delete STORE[k];
    for(const id in META)META[id].base={};before.forEach(k=>{const m=meta(blobOf(k));m.dirty[k]=(m.dirty[k]||0)+1});SYNC.markAll();
    rawSave("gesmar-index",JSON.stringify(knownIds()));S.store=null;try{localStorage.removeItem("gesmar.store")}catch(_){};toast("Sauvegarde importée");setTimeout(()=>location.reload(),1500)}
  catch(e){toast("Fichier non reconnu : choisissez un export GESMAR (.json).")}}
function importData(file){if(!file)return;const r=new FileReader();r.onload=()=>applyImportText(r.result);r.readAsText(file)}
function importPC(){window.api.importData().then(t=>{if(t){S.importPending=[["__fichier__",t]];S.modalPanel="importpc";render()}}).catch(()=>toast("Import impossible"))}
