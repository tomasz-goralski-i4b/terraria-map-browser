#!/usr/bin/env bash
# Zakłada automations z .ai/cezar/automation-defs/*.json w działającym cockpicie Cezara (PAUSED).
# Włączasz je potem w UI (Automations) albo: npx cezar-run automation enable <id>.
# Wymaga: cockpit uruchomiony (domyślnie http://localhost:4321).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export CEZ_API_URL="${CEZ_API_URL:-http://localhost:4321}"
export CEZ_PROJECT_ID="${CEZ_PROJECT_ID:-terraria-map-studio}"
CEZ="${CEZ_BIN:+node $CEZ_BIN}"; CEZ="${CEZ:-npx -y cezar-run}"
existing=$($CEZ automation list 2>/dev/null || true)
for def in .ai/cezar/automation-defs/*.json; do
  name=$(node -p "require('./$def').name")
  if grep -qF "$name" <<<"$existing"; then echo "skip (istnieje): $name"; continue; fi
  $CEZ automation create --file "$def"
done
$CEZ automation list
