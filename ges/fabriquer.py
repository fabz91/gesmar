#!/usr/bin/env python3
"""GES - fabrique le dossier du kit (GES-source) à partir des 4 dépôts GitHub.

Usage : python3 fabriquer.py SORTIE --gesmar DIR --gestime DIR --gestat DIR --gescount DIR [--url U --key K]
Chaque DIR est un clone du dépôt (avec index.html et pc/). --url/--key remplissent la version PRIVÉE (kit du gérant).

Le programme PC de chaque logiciel (pc/main.js, pc/preload.js) est repris presque tel quel, transformé en module :
 - les canaux de messages sont préfixés par « <logiciel>| » (deux logiciels utilisaient les mêmes noms « gm: ») ;
 - « app » est remplacé par un faux objet fourni par GES (dossier de données = celui de l'ancien programme) ;
 - la fenêtre est créée par GES ; createWindow / createTray / demarrageSet d'origine ne font plus rien.
GESTIME, différent, a son module écrit à la main (shell/gestime-main.js).
"""
import argparse, json, os, re, shutil, sys

ICI = os.path.dirname(os.path.abspath(__file__))
SHELL = os.path.join(ICI, 'shell')
UPDATE = {
    'gesmar': 'https://raw.githubusercontent.com/fabz91/gesmar/main',
    'gestime': 'https://raw.githubusercontent.com/fabz91/gestime/main/',
    'gestat': 'https://raw.githubusercontent.com/fabz91/Gestat/main',
    'gescount': 'https://raw.githubusercontent.com/fabz91/gescount/main',
}
EXTRA = {  # fichiers du programme PC à reprendre en plus de main.js / preload.js
    'gesmar': ['core.js', 'pdfjs'],
    'gestat': ['core.js', 'casio.js', 'ftp.js', 'sevenzip.js', 'az050.js'],
    'gescount': ['core.js', 'pdfjs'],
    'gestime': [],
}


def sub1(motif, rempl, s, n=1, flags=0):
    s2, k = re.subn(motif, rempl, s, flags=flags)
    if k != n:
        sys.exit('fabriquer.py : motif trouvé %d fois au lieu de %d : %s' % (k, n, motif))
    return s2


def module_main(src, aid):
    """main.js de GESMAR / GESTAT / GESCOUNT → module pour GES."""
    s = src
    # 1) en-tête : app / ipcMain viennent de GES
    def entete(m):
        noms = [x.strip() for x in m.group(1).split(',') if x.strip() and x.strip() not in ('app', 'ipcMain')]
        return ("const { %s } = require('electron');\n"
                "module.exports = function (ctx) {\n"
                "const app = ctx.app, ipcMain = ctx.ipc; // GES : faux « app » (dossier de données de l'ancien programme) et canaux préfixés\n") % ', '.join(noms)
    s = sub1(r"const \{([^}]*)\} = require\('electron'\);\n", entete, s)
    # 2) la fenêtre / la petite icône / le démarrage avec Windows sont gérés par GES
    s = sub1(r'\nfunction createWindow\(\) \{', '\nfunction createWindow() {} // GES : fenêtre créée par GES\nfunction createWindow_ancien() {', s)
    if 'function createTray()' in s:
        s = sub1(r'\nfunction createTray\(\) \{', '\nfunction createTray() {} // GES : une seule petite icône, celle de GES\nfunction createTray_ancien() {', s)
    if 'function demarrageSet(' in s:
        s = sub1(r'function demarrageSet\(on\) \{', 'function demarrageSet() {} // GES : c\'est GES qui démarre avec Windows\nfunction demarrageSet_ancien(on) {', s)
    # 3) messages envoyés à la page : préfixés
    s = s.replace(".webContents.send('", ".webContents.send(ctx.id + '|' + '")
    # 4) fin du module
    s = s.rstrip() + ("\n\nreturn {\n"
                      "  setWin: (w) => { win = w; },\n"
                      "  page: () => core.currentHtmlPath(),\n"
                      "  pageOrigine: () => path.join(appDir, 'index.html'),\n"
                      "  oublierMaj: () => core.updateReset()\n"
                      "};\n};\n")
    assert 'let win = null' in s, aid
    return s


def module_preload(src, aid):
    entete = ("const { contextBridge, ipcRenderer: IR } = require('electron');\n"
              "// GES : canaux préfixés par « %s| » + choix du logiciel (clic sur l'icône du logiciel)\n"
              "const P = '%s|';\n"
              "const ipcRenderer = { sendSync: (c, ...a) => IR.sendSync(P + c, ...a), send: (c, ...a) => IR.send(P + c, ...a), invoke: (c, ...a) => IR.invoke(P + c, ...a),\n"
              "  on: (c, f) => IR.on(P + c, f), removeAllListeners: (c) => IR.removeAllListeners(P + c) };\n"
              "require('../../switcher.js')(IR);\n") % (aid, aid)
    return sub1(r"const \{ contextBridge, ipcRenderer \} = require\('electron'\);\n", lambda m: entete, src)


def copier(a, b):
    if os.path.isdir(a):
        shutil.copytree(a, b)
    else:
        shutil.copy2(a, b)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sortie')
    for a in UPDATE:
        ap.add_argument('--' + a, required=True)
    ap.add_argument('--url', default='')
    ap.add_argument('--key', default='')
    o = ap.parse_args()
    out = os.path.abspath(o.sortie)
    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(out)
    for f in ['main.js', 'switcher.js', 'package.json', 'installer.nsh', 'afterpack.js', 'CREER-INSTALLATEUR.bat', 'LISEZ-MOI.txt', 'icon.png', 'icon.ico']:
        copier(os.path.join(SHELL, f), os.path.join(out, f))
    cfg = open(os.path.join(SHELL, 'config.js'), encoding='utf-8').read()
    if o.url:
        cfg = cfg.replace("supabaseUrl: ''", "supabaseUrl: %s" % json.dumps(o.url)).replace("supabaseKey: ''", "supabaseKey: %s" % json.dumps(o.key))
    open(os.path.join(out, 'config.js'), 'w', encoding='utf-8').write(cfg)
    versions = {}
    for aid in UPDATE:
        src = os.path.abspath(getattr(o, aid))
        d = os.path.join(out, 'apps', aid)
        os.makedirs(d)
        shutil.copy2(os.path.join(src, 'index.html'), os.path.join(d, 'index.html'))
        shutil.copy2(os.path.join(src, 'pc', 'icon.png'), os.path.join(d, 'icon.png'))
        for f in EXTRA[aid]:
            copier(os.path.join(src, 'pc', f), os.path.join(d, f))
        pre = open(os.path.join(src, 'pc', 'preload.js'), encoding='utf-8').read()
        open(os.path.join(d, 'preload.js'), 'w', encoding='utf-8').write(module_preload(pre, aid))
        if aid == 'gestime':
            shutil.copy2(os.path.join(SHELL, 'gestime-main.js'), os.path.join(d, 'main.js'))
            # config de la PAGE (script chargé par index.html) : adresse de mise à jour + base en ligne
            open(os.path.join(d, 'config.js'), 'w', encoding='utf-8').write(
                '// GES - réglages de GESTIME (page) : adresse des mises à jour et base en ligne (vides dans la version publique).\n'
                'window.SYNC = {\n  updateUrl: %s,\n  url: %s,\n  key: %s\n};\n' % (json.dumps(UPDATE[aid]), json.dumps(o.url), json.dumps(o.key)))
        else:
            m = open(os.path.join(src, 'pc', 'main.js'), encoding='utf-8').read()
            open(os.path.join(d, 'main.js'), 'w', encoding='utf-8').write(module_main(m, aid))
            open(os.path.join(d, 'config.js'), 'w', encoding='utf-8').write(
                "// GES - réglages de %s : base en ligne commune (config.js de GES) + adresse des mises à jour\n"
                "const g = require('../../config.js');\n"
                "module.exports = { updateUrl: %s, supabaseUrl: g.supabaseUrl || '', supabaseKey: g.supabaseKey || '' };\n" % (aid.upper(), json.dumps(UPDATE[aid])))
        h = open(os.path.join(d, 'index.html'), encoding='utf-8').read(6000)
        mv = re.search(r'name="g[a-z]-version" content="(\d+)"', h)
        versions[aid] = int(mv.group(1)) if mv else 0
    print('Kit GES fabriqué dans', out)
    print('Versions des pages :', versions)


if __name__ == '__main__':
    main()
