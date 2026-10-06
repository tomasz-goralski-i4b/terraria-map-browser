#!/usr/bin/env bash
# Creates the automations from .ai/cezar/automation-defs/*.json in the running Cezar cockpit (PAUSED),
# or updates them in place when one with the same name already exists.
# Enable them afterwards in the UI (Automations) or with: npx cezar-run automation enable <id>.
# The cockpit is looked up on ports 4321-4330 by repoRoot == this repo (other instances are skipped).
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
[ -n "${CEZ_API_URL:-}" ] || { echo "No Cezar cockpit found for $root — run 'npx cezar-run' in this repo (Git Bash)."; exit 2; }
export CEZ_PROJECT_ID="${CEZ_PROJECT_ID:-terraria-map-studio}"
echo "cockpit: $CEZ_API_URL (project $CEZ_PROJECT_ID)"

CEZ="${CEZ_BIN:+node $CEZ_BIN}"; CEZ="${CEZ:-npx -y cezar-run}"
existing=$($CEZ automation list 2>/dev/null || true)
for def in .ai/cezar/automation-defs/*.json; do
  name=$(node -p "require('./$def').name")
  id=$(grep -F "$name" <<<"$existing" | awk '{print $1}' | head -1 || true)
  if [ -n "$id" ]; then
    $CEZ automation update "$id" --file "$def" && echo "updated: $name"
  else
    $CEZ automation create --file "$def"
  fi
done
$CEZ automation list
