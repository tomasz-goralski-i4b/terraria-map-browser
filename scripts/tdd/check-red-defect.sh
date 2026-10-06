#!/usr/bin/env bash
# Gate after GREEN: did the implementer report that a red-phase test itself is wrong?
# The green agent may not edit tests (check-green rejects it). Instead it writes .tdd/red-defect.md
# (file:line, why it contradicts the spec, the exact proposed fix) and ends its step. This gate then
# sends the chain back to RED (onFail retry: red) with the report in the prompt; the red agent — not the
# implementer — decides and fixes the test. Bounded by the workflow's max: one disputed test per run.
# Exit: 0 no defect reported, 1 defect reported → back to red.
source "$(dirname "$0")/../lib.sh"
stop_if_blocked

[ -f .tdd/red-defect.md ] || exit 0

if [ -n "$(changed_tests_since "$(cat .tdd/red-sha)")" ]; then
  echo "RED-DEFECT: test files were edited in the green phase — restoring them; only the red step may change tests."
  git checkout "$(cat .tdd/red-sha)" -- $(changed_tests_since "$(cat .tdd/red-sha)" | tr '\n' ' ') 2>/dev/null || true
  git clean -fdq -- $(git ls-files -o --exclude-standard -- "${TEST_PATHSPEC[@]}" | tr '\n' ' ') 2>/dev/null || true
fi

echo "The implementer reports a defect in a red-phase test. You are back in the RED step to judge it."
echo "If the report is right: fix exactly that test/fixture (keep its intent, never weaken assertions)."
echo "If it is wrong: change nothing and write your reasoning to .tdd/red-defect-rejected.md."
echo
cat .tdd/red-defect.md
exit 1
