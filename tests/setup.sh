#!/usr/bin/env bash
# Test environment, fully isolated from the real Paseo:
#  - an OpenSSH server on 127.0.0.1:2222 (user's own account, throwaway key, HOME untouched),
#  - a separate Paseo daemon (home tests/.tmp/paseo, 127.0.0.1:6790, no relay) running this plugin,
#  - playwright-core for the UI tests (uses the Chromium already cached by Playwright).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$ROOT/tests/.tmp"
mkdir -p "$TMP/sshd" "$TMP/paseo" "$TMP/work"

# --- sshd ----------------------------------------------------------------
cd "$TMP/sshd"
[ -f hostkey ] || ssh-keygen -q -t ed25519 -N '' -f hostkey
[ -f testkey ] || ssh-keygen -q -t ed25519 -N '' -f testkey -C ssh-manager-tests
cp testkey.pub authorized_keys
cat > sshd_config <<EOF
Port 2222
ListenAddress 127.0.0.1
HostKey $TMP/sshd/hostkey
AuthorizedKeysFile $TMP/sshd/authorized_keys
PidFile $TMP/sshd/sshd.pid
UsePAM no
StrictModes no
PasswordAuthentication no
AcceptEnv LANG LC_*
EOF
if ! { [ -f sshd.pid ] && kill -0 "$(cat sshd.pid)" 2>/dev/null; }; then
  /usr/sbin/sshd -f "$TMP/sshd/sshd_config" -E "$TMP/sshd/log"
fi

# --- Paseo test daemon ----------------------------------------------------
cat > "$TMP/paseo/config.json" <<EOF
{
  "version": 1,
  "daemon": { "listen": "127.0.0.1:6790", "relay": { "enabled": false } },
  "pluginsEnabled": true,
  "plugins": { "ssh-manager": { "source": "directory", "path": "$ROOT", "enabled": true } },
  "features": { "webUi": { "enabled": true }, "dictation": { "enabled": false }, "voiceMode": { "enabled": false } }
}
EOF
if ! paseo daemon status --home "$TMP/paseo" 2>/dev/null | grep -q "localDaemon: running"; then
  paseo start --home "$TMP/paseo" --timeout 120 >/dev/null
else
  paseo plugin reload ssh-manager --home "$TMP/paseo" >/dev/null
fi

# --- playwright-core ------------------------------------------------------
if [ ! -d "$TMP/node_modules/playwright-core" ]; then
  (cd "$TMP" && echo '{"name":"ssh-manager-tests","private":true}' > package.json && npm i playwright-core@1.56 --no-audit --no-fund >/dev/null)
fi
echo "Environnement de test prêt : sshd 127.0.0.1:2222, Paseo 127.0.0.1:6790 ($TMP)"
