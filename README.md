# GESMAR

Logiciel de gestion des marges et des avoirs fournisseurs (G20 BREDIS / CLAMART).

- `index.html` : le logiciel (sans aucune donnée de magasin).
- `version.json` : numéro de la dernière version. Le bouton « Mettre à jour le logiciel » du programme PC le compare à la version installée, puis télécharge `index.html` si elle est plus récente.
- `pc/` : kit du programme PC Windows (Electron + installateur NSIS via electron-builder). Données dans `%APPDATA%\GESMAR\donnees`, un fichier par magasin.
- `pc/supabase-gesmar.sql` : script à lancer une fois dans Supabase (SQL Editor) pour la synchronisation entre les PC (table `gesmar`, une ligne par magasin, comme GESTIME). Le fichier `seed.json` (données de départ, privées) n'est volontairement pas dans ce dépôt.

Pour publier une nouvelle version : remplacer `index.html` (avec `<meta name="gm-version" content="N">` et `APP_VERSION=N`), puis passer `version.json` à `N`.
