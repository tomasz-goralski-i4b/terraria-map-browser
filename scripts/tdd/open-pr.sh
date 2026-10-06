#!/usr/bin/env bash
# Ostatni krok chainów: push brancha + draft PR (Closes #N) + status:pr-ready na issue.
# Numer issue: .tdd/issue (zapisuje go pierwszy krok agenta, gdy task pochodzi z issue).
# Exit: 0 OK, 2 infrastruktura (push/gh), 3 zła gałąź.
source "$(dirname "$0")/../lib.sh"
command -v gh >/dev/null || { echo "INFRA: brak gh"; exit 2; }

branch=$(git rev-parse --abbrev-ref HEAD)
case "$branch" in
  main|master|HEAD) echo "PR: odmawiam — jestem na '$branch'"; exit 3 ;;
esac
base=$(base_ref)
if [ -z "$(git rev-list "$base"..HEAD)" ]; then
  echo "PR: brak commitów względem bazy — nic do PR"; exit 0
fi

issue=""
[ -f .tdd/issue ] && issue=$(tr -dc '0-9' < .tdd/issue)

git push -q -u origin HEAD || { echo "INFRA: git push nie przeszedł"; exit 2; }

if url=$(gh pr view "$branch" --json url -q .url 2>/dev/null); then
  echo "PR: już istnieje — $url (push zaktualizował branch)"
else
  if [ -n "$issue" ]; then
    title=$(gh issue view "$issue" --json title -q .title) || { echo "INFRA: nie mogę odczytać issue #$issue"; exit 2; }
  else
    title=$(git log -1 --format=%s)
  fi
  {
    if [ -n "$issue" ]; then echo "Closes #$issue"; echo; fi
    echo "## Chain"
    echo "Workflow Cezara zakończony: bramki przeszły, \`scripts/verify.sh\` → OK."
    echo
    echo "## Commity"
    git log --reverse --format='- %s' "$base"..HEAD
    if [ -f .tdd/review.md ]; then
      echo; echo "## Cross-review"; echo; cat .tdd/review.md
    fi
    if [ -f .tdd/plan.md ]; then
      echo; echo "<details><summary>Plan testów</summary>"; echo; cat .tdd/plan.md; echo; echo "</details>"
    fi
    echo; echo "🤖 Generated with [Claude Code](https://claude.com/claude-code) via Cezar"
  } > .tdd/pr-body.md
  url=$(gh pr create --draft --base main --head "$branch" --title "$title" --body-file .tdd/pr-body.md) \
    || { echo "INFRA: gh pr create nie przeszedł"; exit 2; }
  echo "PR: $url"
fi

if [ -n "$issue" ]; then
  gh issue edit "$issue" --remove-label agent:ready --add-label status:pr-ready >/dev/null \
    && echo "issue #$issue → status:pr-ready"
fi
