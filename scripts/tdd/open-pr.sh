#!/usr/bin/env bash
# Last step of every chain: push the branch + draft PR (Closes #N) + status:pr-ready on the issue.
# Issue number: .tdd/issue (written by the first agent step when the task comes from an issue).
# Usage: open-pr.sh [--body-file <prepared Markdown>] (e.g. when review is explicitly pending).
# Exit: 0 OK, 2 infrastructure (push/gh), 3 wrong branch.
source "$(dirname "$0")/../lib.sh"
command -v gh >/dev/null || { echo "INFRA: gh is missing"; exit 2; }

body_file=""
if [ "$#" -gt 0 ]; then
  if [ "$#" -ne 2 ] || [ "$1" != "--body-file" ]; then
    echo "INFRA: usage: open-pr.sh [--body-file <prepared Markdown>]"; exit 2
  fi
  body_file="$2"
  [ -s "$body_file" ] || { echo "INFRA: PR body file is missing or empty: $body_file"; exit 2; }
fi

branch=$(git rev-parse --abbrev-ref HEAD)
case "$branch" in
  main|master|HEAD) echo "PR: refusing — on '$branch'"; exit 3 ;;
esac
base=$(base_ref)
if [ -z "$(git rev-list "$base"..HEAD)" ]; then
  echo "PR: no commits relative to base — nothing to open"; exit 0
fi

issue=""
[ -f .tdd/issue ] && issue=$(tr -dc '0-9' < .tdd/issue)

git push -q -u origin HEAD || { echo "INFRA: git push failed"; exit 2; }

if url=$(gh pr view "$branch" --json url -q .url 2>/dev/null); then
  echo "PR: already exists — $url (push updated the branch)"
else
  if [ -n "$issue" ]; then
    title=$(gh issue view "$issue" --json title -q .title) || { echo "INFRA: cannot read issue #$issue"; exit 2; }
  else
    title=$(git log -1 --format=%s)
  fi
  if [ -z "$body_file" ]; then
    body_file=".tdd/pr-body.md"
    {
      if [ -n "$issue" ]; then echo "Closes #$issue"; echo; fi
      echo "## Chain"
      echo "Cezar workflow finished: all gates passed, \`scripts/verify.sh\` → OK."
      echo
      echo "## Commits"
      git log --reverse --format='- %s' "$base"..HEAD
      if [ -f .tdd/review.md ]; then
        echo; echo "## Cross-review"; echo; cat .tdd/review.md
      fi
      for d in .tdd/red-defect-resolved-*.md; do
        [ -f "$d" ] || continue
        echo; echo "## Red-phase test defect reported by the implementer"; echo; cat "$d"
      done
      if [ -f .tdd/resumed.md ]; then
        echo; echo "## Chain resumed after a usage limit"; echo; cat .tdd/resumed.md
      fi
      if [ -f .tdd/plan.md ]; then
        echo; echo "<details><summary>Test plan</summary>"; echo; cat .tdd/plan.md; echo; echo "</details>"
      fi
      echo; echo "🤖 Generated with [Claude Code](https://claude.com/claude-code) via Cezar"
    } > "$body_file"
  fi
  url=$(gh pr create --draft --base main --head "$branch" --title "$title" --body-file "$body_file") \
    || { echo "INFRA: gh pr create failed"; exit 2; }
  echo "PR: $url"
fi

if [ -n "$issue" ]; then
  gh issue edit "$issue" --remove-label agent:ready --remove-label status:stalled --add-label status:pr-ready >/dev/null \
    && echo "issue #$issue → status:pr-ready"
fi
