#!/usr/bin/env bash
# Runs before check-review in the TDD chain: a REQUEST_CHANGES whose findings are all tagged (style) needs no new
# test, so it goes straight back to green (exit 1 → onFail retry: green) instead of through red. Anything else
# (APPROVE, BLOCKED, any (behaviour) or untagged finding) passes through to check-review, which decides as before.
# Exit: 0 not a style-only rework, 1 style-only rework → green.
source "$(dirname "$0")/../lib.sh"
[ -f .tdd/review.md ] || exit 0
[ "$(head -1 .tdd/review.md | tr -d '\r')" = "VERDICT: REQUEST_CHANGES" ] || exit 0

# Blocking findings are the "- " bullets before the non-blocking sections.
findings=$(awk '/^(Needs a human decision|Nice to have):/ { exit } /^- / { print }' .tdd/review.md)
[ -n "$findings" ] || exit 0
if grep -qv '(style)' <<<"$findings" || grep -q '(behaviour)' <<<"$findings"; then
  exit 0
fi

echo "The reviewer requested style-only changes — back to green (no new tests needed). Address every finding:"
echo
cat .tdd/review.md
exit 1
