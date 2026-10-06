#!/usr/bin/env bash
# Zakłada automations z .ai/cezar/automation-defs/*.json w działającym cockpicie Cezara (PAUSED).
# Włączasz je potem w UI (Automations) albo: npx cezar-run automation enable <id>.
# Cockpit szukany na portach 4321-4330 po repoRoot == to repo (inne instancje są pomijane).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
root=$(pwd -W 2>/dev/null || pwd)

if [ -z "${CEZ_API_URL:-}" ]; then
  for port in $(seq 4321 4330); do
    health=$(curl -s -m 2 "http://localhost:$port/api/v1/health" || true)
    if [ -n "$health" ] && node -e 'const h=JSON.parse(process.argv[1]);process.exit(h.repoRoot.toLowerCase()===process.argv[2].toLowerCase()?0:1)' "$health" "$root" 2>/dev/null; then
      export CEZ_API_URL="http://localhost:$port"; break
    fi
  done
fi
[ -n "${CEZ_API_URL:-}" ] || { echo "Nie znalazłem cockpitu Cezara dla $root — uruchom 'npx cezar-run' w tym repo (Git Bash)."; exit 2; }
export CEZ_PROJECT_ID="${CEZ_PROJECT_ID:-terraria-map-studio}"
echo "cockpit: $CEZ_API_URL (project $CEZ_PROJECT_ID)"

CEZ="${CEZ_BIN:+node $CEZ_BIN}"; CEZ="${CEZ:-npx -y cezar-run}"
existing=$($CEZ automation list 2>/dev/null || true)
for def in .ai/cezar/automation-defs/*.json; do
  name=$(node -p "require('./$def').name")
  if grep -qF "$name" <<<"$existing"; then echo "skip (istnieje): $name"; continue; fi
  $CEZ automation create --file "$def"
done
$CEZ automation list
