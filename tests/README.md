# Tests

`npm test` lance tout, dans un environnement isolé de ton Paseo :

1. typecheck et contrôle du bundle client (modules autorisés par Paseo, pas de `class` pour Hermes,
   aucune boîte `window.confirm` / `alert` qui bloque la saisie dans Paseo desktop) ;
2. `tests/setup.sh` : un sshd de test (127.0.0.1:2222, clé jetable, `known_hosts` propre aux tests)
   et un daemon Paseo de test (`tests/.tmp/paseo`, 127.0.0.1:6790, sans relais) qui charge ce dossier ;
3. `tests/server.test.mjs` : fichiers, archives, copie entre serveurs, émulation du terminal (couleurs,
   curseur, taille, recherche, historique, souris), journaux, alertes, suivi du dossier, tunnels ;
4. `tests/ui.test.mjs` : le vrai Paseo web piloté par Chromium (saisie dans Paseo après usage du SSH,
   clic rapide, double-clic, Sftp avancé, journal, alertes, export, reconnexion, confirmation).

`KEEP_TEST_ENV=1 npm test` garde l'environnement démarré (UI : http://127.0.0.1:6790/) ;
`bash tests/teardown.sh` l'arrête. Rien n'est écrit dans `~/.paseo` ni dans `~/.ssh`.
