#!/usr/bin/env bash
# Gate of the tests-only chain: regression/characterisation tests for behaviour that already works.
# Requires: tests added or changed, no production change (only test paths and docs/), verify.sh OK.
# A new test that fails is a found defect — not this flow's job: the agent writes .tdd/blocked.md instead and a
# human moves the issue to flow:tdd. Exit: 0 OK (commit + .tdd/green-sha for review), 1 rework, 3 blocked.
source "$(dirname "$0")/../lib.sh"
stop_if_blocked
mkdir -p .tdd
base=$(base_ref)

if [ ! -f .tdd/review.md ] && [ -z "$(changed_tests_since "$base")" ]; then
  echo "TESTS: no test was added or changed (expected paths: ${TEST_PATHSPEC[*]})."
  exit 1
fi

production=$({ git diff --name-only "$base" -- . ':(exclude)docs/**' "${TEST_PATHSPEC[@]/#:(glob)/:(exclude,glob)}"
  git ls-files -o --exclude-standard -- . ':(exclude)docs/**' "${TEST_PATHSPEC[@]/#:(glob)/:(exclude,glob)}"; } | sort -u)
if [ -n "$production" ]; then
  echo "TESTS: the tests-only flow must not change production code:"
  echo "$production" | sed 's/^/  /'
  echo "Keep builders and helpers in the test project. If a new test exposes a defect, revert the fix, keep the"
  echo "failing test out, and describe the defect in .tdd/blocked.md — a human moves the issue to flow:tdd."
  exit 1
fi

bash scripts/verify.sh || {
  echo
  echo "TESTS: verify.sh failed. Fix the tests or the build. If a correct test fails on the current code, that is a"
  echo "defect: describe it in .tdd/blocked.md (test, expected vs actual, spec citation) instead of fixing it here."
  exit 1
}
commit_state test "regression tests"
git rev-parse HEAD > .tdd/green-sha
echo "TESTS: OK — saved $(cat .tdd/green-sha)"
