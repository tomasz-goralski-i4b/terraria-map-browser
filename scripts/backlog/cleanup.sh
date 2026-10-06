#!/usr/bin/env bash
# Deletes local Cezar task branches (cez/*) that are no longer needed:
#   - the branch's PR is MERGED or CLOSED (squash-merged work lives on main), or
#   - the branch has no PR and no commits beyond its fork point (e.g. plan-backlog runs, refused runs),
# and in every case only when no worktree uses the branch (Cezar's own worktree retention removes those first).
# Never touches remote branches (merge --delete-branch removes them), never a branch with unpublished work.
# Usage: bash scripts/backlog/cleanup.sh [--dry-run]
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
dry=""; [ "${1:-}" = "--dry-run" ] && dry=1

in_worktree=$(git worktree list --porcelain | sed -n 's|^branch refs/heads/||p')
prs=$(gh pr list --state all --limit 500 --json headRefName,state -q '.[] | "\(.headRefName) \(.state)"' 2>/dev/null) || { echo "cleanup: gh pr list failed — skipping"; exit 0; }
base=$(git rev-parse -q --verify origin/main || git rev-parse main)
deleted=0
for b in $(git branch --list 'cez/*' --format='%(refname:short)'); do
  grep -qxF "$b" <<<"$in_worktree" && continue
  state=$(awk -v b="$b" '$1 == b { print $2; exit }' <<<"$prs")
  reason=""
  case "$state" in
    MERGED|CLOSED) reason="PR $state" ;;
    "") [ -z "$(git rev-list "$(git merge-base "$b" "$base")".."$b" 2>/dev/null)" ] && reason="no PR, no commits" ;;
  esac
  [ -n "$reason" ] || continue
  if [ -n "$dry" ]; then echo "would delete $b ($reason)"; else git branch -D -q "$b" && echo "deleted $b ($reason)"; fi
  deleted=$((deleted + 1))
done
echo "cleanup: ${deleted} branch(es) ${dry:+would be }removed"
