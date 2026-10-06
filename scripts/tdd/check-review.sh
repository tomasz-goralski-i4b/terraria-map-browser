#!/usr/bin/env bash
# REVIEW gate: the reviewer changed no code + verdict from .tdd/review.md.
source "$(dirname "$0")/../lib.sh"
[ -f .tdd/green-sha ] || { echo "INFRA: .tdd/green-sha is missing"; exit 2; }
green=$(cat .tdd/green-sha)

if ! git diff --quiet "$green" -- . || [ -n "$(git ls-files -o --exclude-standard)" ]; then
  echo "REVIEW: the reviewer changed files — not allowed (review only reports):"
  git diff --stat "$green" -- .; git ls-files -o --exclude-standard
  exit 3
fi

[ -f .tdd/review.md ] || { echo "REVIEW: .tdd/review.md is missing"; exit 3; }
verdict=$(head -1 .tdd/review.md | tr -d '\r')
case "$verdict" in
  "VERDICT: APPROVE")
    echo "REVIEW: APPROVE"; cat .tdd/review.md; exit 0 ;;
  "VERDICT: REQUEST_CHANGES")
    echo "The reviewer requested changes. For behavioural bugs, first add a failing test that reproduces them."
    echo; cat .tdd/review.md; exit 1 ;;
  *)
    echo "REVIEW: BLOCKED or no valid verdict on line 1 — human decision needed:"
    cat .tdd/review.md; exit 3 ;;
esac
