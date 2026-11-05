#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$ROOT/tests/.tmp"
paseo daemon stop --home "$TMP/paseo" >/dev/null 2>&1 || true
[ -f "$TMP/sshd/sshd.pid" ] && kill "$(cat "$TMP/sshd/sshd.pid")" 2>/dev/null || true
echo "Environnement de test arrêté."
