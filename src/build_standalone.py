import json,glob,os,re
seed={}
for f in glob.glob('live/**/*.json',recursive=True):
    seed[os.path.relpath(f,'live')[:-5]]=json.load(open(f))
import sys
PUBLIC=len(sys.argv)>1 and sys.argv[1]=='public'
if PUBLIC: seed={k:v for k,v in seed.items() if k.count('/')==1 and k.startswith('magasins/')}
s=open('gesmar.html').read()
def rep(a,b):
    global s
    assert s.count(a)>=1,a[:70]; s=s.replace(a,b)
rep('<title>GESMAR</title>','<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<title>GESMAR</title>\n<script>/* version web : réglages Supabase dans config.js (à côté de index.html). Programme PC : fournis par le programme. */if(!window.api)document.write(\'<script src="config.js"><\\/script>\')</script>')
rep('</style>\n','[hidden]{display:none!important} img{max-width:100%}\nbody{margin:0}\n</style>\n</head>\n<body>\n')
rep('`<img src="/_blob/${esc(lid)}" alt="Logo">`','`<img src="${esc(blobSrc(lid))}" alt="Logo">`')
rep('''  const db=window.claude&&window.claude.use?await window.claude.use("db"):null;
  if(!db){S.noDb=true;render();return}
  S.db=wrapDb(db);render();
  window.claude.use("assets").then(a=>{S.assets=a;render()},()=>{});
  window.claude.use("downloads").then(d=>{S.downloads=d},()=>{});''','''  let db=null;
  if(window.claude&&window.claude.use){db=await window.claude.use("db");if(db){window.claude.use("assets").then(a=>{S.assets=a;render()},()=>{});window.claude.use("downloads").then(d=>{S.downloads=d},()=>{})}}
  if(!db){db=LocalDB;S.local=true;S.assets=LocalAssets;S.pc=PC;if(PC&&window.api.updateCheck)setTimeout(()=>majCheck(true).then(()=>render()).catch(()=>{}),4000)}
  S.db=wrapDb(db);render();
  if(S.local)setTimeout(()=>SYNC.start().catch(()=>{}),300);''')
shim=open('shim.js').read().replace('__SEED__',json.dumps(seed,ensure_ascii=False,separators=(',',':')))
rep('let unsubs=[];',shim+'\nlet unsubs=[];')
rep('"Image trop lourde (20 Mo maximum)."','(S.local?"Image trop lourde (1,5 Mo maximum).":"Image trop lourde (20 Mo maximum).")')
s=s.rstrip()+'\n</body>\n</html>\n'
open('dist/index.html' if PUBLIC else 'dist/test-prive.html','w').write(s)
open('t2.js','w').write(max(re.findall(r'<script>(.*?)</script>',s,re.S),key=len))
print(len(seed),'docs')
