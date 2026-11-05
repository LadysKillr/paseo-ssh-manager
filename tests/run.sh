#!/usr/bin/env bash
# Full check: typecheck, bundle constraints, server tests, UI tests. Usage: npm test
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
status=0
echo "== Typecheck"; npx tsc --noEmit || status=1
echo "== Bundle client (modules autorisés, pas de class, pas de window.confirm)"
npx --yes esbuild@0.25 index.client.tsx --bundle --format=cjs --target=es2020 --jsx=automatic --outfile=tests/.tmp/bundle.js \
  --external:react --external:react/jsx-runtime --external:react-native --external:@tanstack/react-query --external:zod \
  --external:@getpaseo/plugin --external:@getpaseo/plugin/client --external:@getpaseo/plugin/client/ui --log-level=warning || status=1
mods=$(grep -o 'require("[^"]*")' tests/.tmp/bundle.js | sort -u | grep -v -E '"(react|react/jsx-runtime|react-native|@tanstack/react-query|zod|@getpaseo/plugin|@getpaseo/plugin/client|@getpaseo/plugin/client/ui)"')
[ -z "$mods" ] || { echo "Modules interdits : $mods"; status=1; }
grep -qw class tests/.tmp/bundle.js && { echo "'class' dans le bundle (Hermes)"; status=1; }
grep -q 'window\.confirm\|window\.alert' tests/.tmp/bundle.js && { echo "Boîte native dans le bundle (bloque Electron)"; status=1; }
echo "== Environnement de test"; bash tests/setup.sh || exit 1
echo "== Tests serveur"; node tests/server.test.mjs || status=1
echo "== Tests interface"; node tests/ui.test.mjs || status=1
[ "${KEEP_TEST_ENV:-0}" = 1 ] || bash tests/teardown.sh
exit $status
