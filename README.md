# GESMAR

Logiciel de gestion des marges et des avoirs fournisseurs (G20 BREDIS / CLAMART).

- `index.html` : le logiciel (sans aucune donnée de magasin).
- `version.json` : numéro de la dernière version. Le bouton « Mettre à jour le logiciel » du programme PC le compare à la version installée, puis télécharge `index.html` si elle est plus récente.
- `pc/` : code source du programme PC Windows (Electron) qui affiche `index.html`, enregistre les données dans `Documents\GESMAR` et gère les mises à jour.

Pour publier une nouvelle version : remplacer `index.html` (avec `<meta name="gm-version" content="N">` et `APP_VERSION=N`), puis passer `version.json` à `N`.
