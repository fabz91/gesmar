# Sources de GESMAR

- `gesmar.html` : le logiciel (HTML + CSS + JavaScript), sans données.
- `shim.js` : stockage par magasin + synchronisation Supabase, injecté à la fabrication.
- `build_standalone.py` : fabrique `dist/index.html`.
  - `python3 build_standalone.py public` → version publique (seulement les noms des magasins) : c'est le `index.html` du dépôt.
  - sans argument → version de test avec les données privées.
  - Les données privées viennent d'un dossier `live/` (un fichier .json par document, par ex. `live/magasins/bredis/mois/2026-10.json`). Ce dossier n'est **jamais** mis sur GitHub ; il se recrée depuis le `seed.json` du kit privé.
- Avant de publier : même numéro dans `<meta name="gm-version">` et `APP_VERSION`, puis `version.json`.
