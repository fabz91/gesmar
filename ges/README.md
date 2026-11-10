# GES — programme Windows unique (GESMAR, GESTIME, GESTAT, GESCOUNT)

- `shell/` : le programme GES (main.js, choix du logiciel switcher.js, module GESTIME, installateur, icône).
- `fabriquer.py` : assemble le kit `GES-source` à partir des 4 dépôts (pages + programmes PC transformés en modules).

```
python3 ges/fabriquer.py SORTIE --gesmar gesmar --gestime gestime --gestat Gestat --gescount gescount [--url URL --key CLE]
```

Sans `--url/--key` : version publique (base en ligne vide). Le kit rempli reste privé chez le gérant.
Chaque logiciel garde son dossier %APPDATA%\<NOM> et sa session (session.fromPath) : données, réglages et connexion inchangés.
