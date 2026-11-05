# SSH Manager pour Paseo

Plugin [Paseo](https://github.com/getpaseo/paseo) qui apporte l'essentiel de MobaXterm : toutes vos
sessions SSH sur une page, des terminaux complets, un explorateur de fichiers, le multi-exec, le
monitoring des serveurs, la gestion des clés et des tunnels. Il fonctionne sur ordinateur (application
de bureau ou web) et sur téléphone.

*English summary at the end.*

## Fonctionnalités

**Sessions**
- Arbre « User sessions » avec dossiers imbriqués, état de chaque serveur (joignable, connecté, latence).
- Import des sessions **MobaXterm** (`MobaXterm.ini` ou fichier `.mxtsessions` exporté) et de `~/.ssh/config`.
- Quick connect (`user@hôte:port`), double-clic pour ouvrir, clic droit pour le menu.
- Par session : clé privée, mot de passe (optionnel), rebond (ProxyJump), dossier et commande au démarrage,
  reconnexion automatique, enregistrement automatique dans un journal.

**Terminal**
- Émulation xterm complète : couleurs (16, 256, RVB), gras / italique / souligné, curseur exact,
  programmes plein écran (`vim`, `htop`, `less`), souris dans les programmes qui la demandent.
- Comme MobaXterm : sélectionner copie, clic droit ou clic molette colle, molette pour l'historique,
  Ctrl + molette pour zoomer.
- Recherche dans l'historique (Ctrl+Shift+F), onglets (renommer, dupliquer, fermer les autres),
  session terminée conservée avec « Entrée pour relancer ».
- **MultiExec** : tous les terminaux côte à côte, chaque touche envoyée à tous (avec exclusions).
- **Split** : 2 ou 4 terminaux indépendants côte à côte.
- Journal de session (texte brut, sans codes couleur) et export de l'historique.
- Alertes : mot-clé dans la sortie, fin d'une commande longue, réveil d'un terminal silencieux
  (message, notification du bureau, cloche sur l'onglet).

**Fichiers (Sftp)**
- Navigation, édition de fichiers texte, création, renommage, duplication, droits, suppression.
- Multi-sélection (Ctrl / Maj + clic), glisser-déposer depuis l'ordinateur, envoi et téléchargement,
  dossiers et sélections téléchargés en `.tar.gz`.
- Copie directe d'un serveur à l'autre, et échanges avec la machine Paseo (utile pour les agents).
- « Follow terminal folder » : l'explorateur suit le dossier du terminal actif.

**Outils**
- Monitoring : CPU, mémoire, réseau, uptime, utilisateurs, disques (barre d'état et vue détaillée).
- Clés SSH (façon MobaKeyGen) : générer, importer (y compris `.ppk` avec puttygen), publier la clé
  publique sur les serveurs, vérifier, révoquer.
- Tunnels SSH (façon MobaSSHTunnel) : local `-L`, distant `-R`, SOCKS `-D`, démarrage automatique.

**Mobile**
- Barre d'onglets en bas, grandes zones tactiles, rangée de touches (Échap, Tab, Ctrl, Alt, flèches…),
  glisser pour l'historique, le clavier ne recouvre pas le terminal.

## Prérequis

- Paseo **0.15** ou plus récent.
- Sur la machine qui fait tourner le daemon Paseo : le client **OpenSSH 8.4+** (`ssh`, `ssh-keygen`)
  et `tar`. `puttygen` (paquet `putty-tools`) seulement pour importer des clés `.ppk`.
- Monitoring et « Follow terminal folder » : serveurs Linux.

## Installation

```bash
paseo plugin install git:LadysKillr/paseo-ssh-manager
```

ou depuis un dossier local :

```bash
git clone https://github.com/LadysKillr/paseo-ssh-manager.git
paseo plugin install ./paseo-ssh-manager
```

L'entrée **SSH** apparaît dans la barre latérale de Paseo. Un panneau « SSH » est aussi disponible dans
chaque workspace, et les réglages sont dans les paramètres du plugin.

## Fonctionnement et données

- Tout s'exécute sur la machine du daemon Paseo, avec le client OpenSSH du système : vos clés, votre
  agent SSH et `~/.ssh/config` fonctionnent normalement. Aucune donnée n'est envoyée ailleurs.
- Les connexions sont partagées (ControlMaster) : une fois un terminal authentifié, l'explorateur,
  le monitoring et les autres outils réutilisent sa connexion (y compris avec mot de passe ou 2FA).
- Les terminaux sont de vrais terminaux Paseo ; le plugin les affiche à l'aide de l'émulateur xterm
  fourni par Paseo.
- Données du plugin : `~/.paseo/plugin-data/ssh-manager/` (sessions, journaux, coffre de clés en
  `0700` / `0600`). Un mot de passe enregistré est stocké en clair dans un fichier `0600` et transmis
  à ssh par `SSH_ASKPASS`, jamais en argument de commande : une clé reste préférable.
- Les nouvelles clés d'hôte sont acceptées à la première connexion (`StrictHostKeyChecking=accept-new`).

## Développement

```bash
npm install
npm test        # typecheck, contrôles du bundle, tests serveur et tests d'interface
```

`npm test` démarre un environnement isolé : un serveur OpenSSH de test sur `127.0.0.1:2222` et un
daemon Paseo de test sur `127.0.0.1:6790`, puis pilote l'interface web avec Chromium (Playwright).
Rien n'est écrit dans votre `~/.paseo` ni dans `~/.ssh`. Voir [tests/README.md](tests/README.md).

Structure : `index.server.ts` et `server/` (daemon : ssh, fichiers, émulation des terminaux, clés,
tunnels, journaux), `index.client.tsx` et `client/` (interface React Native), `shared/` (contrats RPC
et réglages).

## Limites connues

- Pas de session RDP, VNC, Telnet ou série (seulement SSH et SFTP).
- Les mots de passe enregistrés dans MobaXterm sont chiffrés et ne peuvent pas être importés.
- Les tunnels demandent une clé ou un mot de passe enregistré (pas de 2FA interactif).
- Alertes et reconnexion automatique : la page SSH doit avoir été ouverte depuis le lancement de Paseo.

## Licence

[MIT](LICENSE)

---

## English summary

SSH Manager is a [Paseo](https://github.com/getpaseo/paseo) plugin that brings MobaXterm's essentials to
Paseo: a session tree (imports MobaXterm sessions and `~/.ssh/config`), full xterm-emulated terminals
(colours, mouse, search, split view, MultiExec), an SFTP-like file browser (multi-select, drag and drop,
`.tar.gz` downloads, server-to-server copy), server monitoring, SSH key management, SSH tunnels, session
logs, alerts, auto-reconnect and a phone-friendly layout. Everything runs on the Paseo daemon host with
the system OpenSSH client; no data leaves it.

Install with `paseo plugin install git:LadysKillr/paseo-ssh-manager`. Requires Paseo 0.15+ and OpenSSH 8.4+
on the daemon host. Run `npm test` for the isolated test suite.

License: [MIT](LICENSE).
