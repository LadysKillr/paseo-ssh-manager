<div align="center">

# 🖥️ SSH Manager

**MobaXterm's essentials inside Paseo: every SSH server on one page, real terminals, Sftp, MultiExec and monitoring.**

[![License: MIT](https://img.shields.io/badge/license-MIT-8b5cf6.svg)](LICENSE)
[![Paseo](https://img.shields.io/badge/Paseo-%E2%89%A5%200.15-1b1a26.svg)](https://paseo.sh)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20web%20%7C%20iOS%20%7C%20Android-informational.svg)](#requirements)

*[Version française](README.fr.md)*

</div>

SSH Manager is a [Paseo](https://github.com/getpaseo/paseo) plugin that brings the day-to-day tools of
MobaXterm to Paseo: a session tree with all your servers, full xterm-emulated terminals, an Sftp file
browser, MultiExec, server monitoring, SSH key management and tunnels. It works in the desktop app, in the
browser and on your phone, and everything runs on the Paseo daemon host with the system OpenSSH client —
no data leaves it.

## ✨ Features

### Sessions
- **Session tree** — nested folders, live status of each server (reachable, connected, latency).
- **Import** — MobaXterm sessions (`MobaXterm.ini` or an exported `.mxtsessions` file) and `~/.ssh/config`.
- **Quick connect** — `user@host:port`, double-click to open, right-click for the context menu.
- **Per-session options** — private key, optional password, jump host (ProxyJump), start folder and command,
  auto-reconnect, automatic session log.

### Terminal
- **Full xterm emulation** — 16 / 256 / RGB colours, bold / italic / underline, exact cursor, full-screen
  programs (`vim`, `htop`, `less`), mouse for programs that request it.
- **MobaXterm mouse habits** — select to copy, right or middle click to paste, wheel for scrollback,
  Ctrl + wheel to zoom.
- **Tabs** — rename, duplicate, close others; a finished session stays open with "Press Enter to restart".
- **Search** in the scrollback (Ctrl+Shift+F) and export of the history.
- **MultiExec** — all terminals side by side, every key sent to all of them (with per-terminal exclusion),
  plus multi-paste.
- **Split** — 2 or 4 independent terminals side by side.
- **Session logs** — plain text, colour codes stripped.
- **Alerts** — keyword in the output, end of a long command, silent terminal waking up (toast, desktop
  notification, bell on the tab).

### Files (Sftp)
- **Browse and edit** — text editor, create, rename, duplicate, permissions, delete.
- **Multi-select** (Ctrl / Shift + click), **drag and drop** from your computer, upload and download;
  folders and selections are downloaded as `.tar.gz`.
- **Server to server copy**, and exchanges with the Paseo host (handy for agents).
- **Follow terminal folder** — the browser follows the directory of the active terminal.

### Tools
- **Monitoring** — CPU, memory, network, uptime, users, disks, in a status bar and a detailed view.
- **SSH keys** (MobaKeyGen-like) — generate, import (including `.ppk` with puttygen), publish the public key
  to your servers, check, revoke, delete. Private keys stay in a `0700` vault on the daemon host.
- **SSH tunnels** (MobaSSHTunnel-like) — local `-L`, remote `-R`, SOCKS `-D`, auto-start.

### Mobile
- Bottom tab bar, large touch targets, key row (Esc, Tab, Ctrl, Alt, arrows, ^C, paste, search, zoom),
  swipe for scrollback, and the keyboard never covers the terminal.

## 🚀 Getting started

### Requirements

- **Paseo 0.15** or newer.
- On the machine running the Paseo daemon: **OpenSSH 8.4+** (`ssh`, `ssh-keygen`) and `tar`.
  `puttygen` (package `putty-tools`) only to import `.ppk` keys.
- Monitoring and "Follow terminal folder" need **Linux** servers.

### Install

```bash
paseo plugin install git:LadysKillr/paseo-ssh-manager
paseo plugin ls        # ssh-manager should be "running"
```

You can also paste `git:LadysKillr/paseo-ssh-manager` into **Settings → Plugins → Plugin source**, or
install from a local clone:

```bash
git clone https://github.com/LadysKillr/paseo-ssh-manager.git
paseo plugin install ./paseo-ssh-manager
```

An **SSH** entry appears in Paseo's sidebar. An "SSH" panel is also available in every workspace.

### Update and uninstall

```bash
paseo plugin update ssh-manager
paseo plugin remove ssh-manager
```

## 🎛️ Usage

Settings live in **Settings → Plugins → SSH Manager** (the interface is in French):

| Setting | Default | Description |
| --- | --- | --- |
| Thème (appearance) | MobaXterm | MobaXterm dark look, or follow the Paseo theme. |
| Taille de police | 13 | Also Ctrl + wheel, Ctrl + / Ctrl −. |
| Copier à la sélection | On | Selecting text in a terminal copies it. |
| Clic droit pour coller | On | Right click pastes instead of opening the menu. |
| Confirmer la fermeture | On | Ask before closing a terminal tab. |
| Remote monitoring | On | Show the monitoring status bar under the terminal. |
| Rafraîchissement | 5 s | Seconds between two monitoring refreshes. |

"Follow terminal folder" is a checkbox at the bottom of the Sftp panel, as in MobaXterm.

**Handy shortcuts**

| Action | How |
| --- | --- |
| Open a session / edit a file | Double-click |
| Context menu | Right click (on a session, folder, file or tab) |
| Search in a terminal | Ctrl+Shift+F |
| Zoom | Ctrl + wheel |
| Paste in MultiExec | Ctrl+V or Shift+Insert |

## ⚙️ How it works

- **`index.server.ts`, `server/`** — runs on the daemon host: ssh commands with shared connections
  (ControlMaster), so once a terminal is authenticated the Sftp browser, monitoring and tools reuse it,
  even with a password or 2FA.
- **`server/term-mirror.ts`** — terminals are real Paseo terminals; the plugin mirrors them with the xterm
  emulator shipped with Paseo to render colours, cursor and mouse.
- **`server/keys.ts`, `server/tunnels.ts`, `server/term-features.ts`** — key vault, tunnels, logs and alerts.
- **`index.client.tsx`, `client/`** — the React Native interface (desktop, web and mobile layouts).
- **`shared/`** — RPC contracts and settings.

Plugin data is stored in `~/.paseo/plugin-data/ssh-manager/` (sessions, logs, key vault, `0700` / `0600`).
A saved password is kept in a `0600` file and handed to ssh through `SSH_ASKPASS`, never as a command
argument — a key is still the better choice. New host keys are accepted on first connection
(`StrictHostKeyChecking=accept-new`).

## ⚠️ Limitations

- SSH and Sftp only: no RDP, VNC, Telnet or serial sessions.
- Passwords saved in MobaXterm are encrypted and cannot be imported.
- Tunnels need a key or a saved password (no interactive 2FA).
- Alerts and auto-reconnect run while the SSH page has been opened since Paseo started.

## 🩺 Troubleshooting

| Problem | Fix |
| --- | --- |
| `Could not resolve type dependency` on install | Update to v1.0.1 or newer: `paseo plugin update ssh-manager`. |
| Server shown unreachable | Check `ssh user@host` works from the daemon host; the plugin uses the same OpenSSH client and `~/.ssh/config`. |
| Sftp or monitoring asks for a password again | Open a terminal on the session first: the other tools reuse its authenticated connection. |
| Plugin not "running" | `paseo plugin logs ssh-manager`, then `paseo plugin reload ssh-manager`. |
| Monitoring empty | Monitoring reads `/proc`: Linux servers only. |

## 🛠️ Development

```bash
npm install
npm test        # typecheck, bundle checks, server tests and UI tests
```

`npm test` starts an isolated environment — a throwaway OpenSSH server on `127.0.0.1:2222` and a test Paseo
daemon on `127.0.0.1:6790` — then drives the web UI with Chromium (Playwright). Nothing is written to your
`~/.paseo` or `~/.ssh`. See [tests/README.md](tests/README.md).

## 🗺️ Roadmap

- Screenshots in this README.
- X11 forwarding and more session types.
- Session sharing between Paseo hosts.

## 🤝 Contributing

Issues and pull requests are welcome. Please run `npm test` before opening a pull request.

## 📄 License

[MIT](LICENSE) © LadysKillr ([@LadysKillr](https://github.com/LadysKillr))
