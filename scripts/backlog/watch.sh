#!/usr/bin/env bash
# Local backlog watcher: runs the promoter every N minutes next to the Cezar cockpit.
# Locally the promoter sees Cezar's runs, so it can finish chains that Cezar ended early after a usage limit
# (scripts/backlog/resume.mjs), flag real stalls precisely, and promote the next issues. The GitHub Action
# only has the time-based fallback because it cannot reach the local cockpit.
#
# Usage (Git Bash, repo root, while `npx cezar-run` is running):  bash scripts/backlog/watch.sh [minutes]
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
interval="${1:-10}"
echo "backlog watch: every ${interval} min (Ctrl+C to stop)"
while :; do
  echo "== $(date '+%Y-%m-%d %H:%M:%S')"
  git fetch -q origin main 2>/dev/null || true
  # Run the promoter as it is on origin/main, so a stale local checkout never runs old logic.
  tmp=$(mktemp -d)
  if git archive origin/main scripts/backlog | tar -x -C "$tmp" 2>/dev/null; then
    node "$tmp/scripts/backlog/promote.mjs" || echo "(promoter exited $?)"
  else
    node scripts/backlog/promote.mjs || echo "(promoter exited $?)"
  fi
  rm -rf "$tmp"
  sleep "$((interval * 60))"
done
