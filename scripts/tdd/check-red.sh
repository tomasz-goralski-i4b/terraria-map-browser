#!/usr/bin/env bash
# RED gate: there are new tests, the code compiles, and the tests FAIL.
# In rework (after REQUEST_CHANGES) having no new tests is allowed — the gate then passes.
source "$(dirname "$0")/../lib.sh"
mkdir -p .tdd

# Defect mode: green reported a wrong red-phase test (check-red-defect.sh). The red agent either fixed the
# test(s) or rejected the report. Tests may already pass here — green's partial implementation is present —
# so this mode only requires: test-only changes, a passing build, and an explicit outcome.
if [ -f .tdd/red-defect.md ] && [ -f .tdd/red-sha ]; then
  red=$(cat .tdd/red-sha)
  n=$(ls .tdd/red-defect-resolved-*.md 2>/dev/null | wc -l)
  tests=$(changed_tests_since "$red")
  if [ -z "$tests" ]; then
    if [ ! -f .tdd/red-defect-rejected.md ]; then
      echo "RED (defect): no test changed and no .tdd/red-defect-rejected.md — fix the test or explain why the report is wrong."
      exit 1
    fi
    { cat .tdd/red-defect.md; echo; echo "## Rejected by the red step"; cat .tdd/red-defect-rejected.md; } > ".tdd/red-defect-resolved-$((n + 1)).md"
    rm -f .tdd/red-defect.md .tdd/red-defect-rejected.md
    echo "RED (defect): report rejected by the red step; tests unchanged. Back to green."
    exit 0
  fi
  echo "RED (defect): corrected tests:"; echo "$tests" | sed 's/^/  /'
  # Production files may already differ from red-sha (green's partial work); only the test edits are committed here.
  if ! out=$(bash scripts/build.sh 2>&1); then
    echo "$out"; echo; echo "RED (defect): the build fails after the test correction."
    exit 1
  fi
  { cat .tdd/red-defect.md; echo; echo "## Fixed by the red step"; echo "$tests" | sed 's/^/- /'; } > ".tdd/red-defect-resolved-$((n + 1)).md"
  rm -f .tdd/red-defect.md .tdd/red-defect-rejected.md
  label=$(task_label)
  git add -A -- $(echo "$tests" | tr '\n' ' ')
  git commit -q -m "test: fix red-phase defect${label:+ — $label}" -- $(echo "$tests" | tr '\n' ' ')
  git rev-parse HEAD > .tdd/red-sha
  echo "RED (defect): OK — corrected test committed, tests frozen again at $(cat .tdd/red-sha). Back to green."
  exit 0
fi

if [ -f .tdd/review.md ] && [ -f .tdd/green-sha ]; then
  since=$(cat .tdd/green-sha); mode="rework"
else
  since=$(base_ref); mode="initial"
fi

tests=$(changed_tests_since "$since")
if [ -z "$tests" ]; then
  if [ "$mode" = rework ]; then
    echo "RED (rework): no new tests — the review findings are not about behaviour, moving on to green."
    commit_state test "red (rework, no new tests)"; git rev-parse HEAD > .tdd/red-sha; exit 0
  fi
  echo "RED: no test was added or changed (expected paths: ${TEST_PATHSPEC[*]})."
  exit 1
fi
echo "RED: changed tests:"; echo "$tests" | sed 's/^/  /'

if ! out=$(bash scripts/build.sh 2>&1); then
  echo "$out"
  echo
  echo "RED: the build fails. Tests must compile — add signatures/stubs"
  echo "(C#: throw new NotImplementedException(); TS: throw new Error(\"not implemented\")), no logic."
  exit 1
fi

if out=$(bash scripts/test.sh 2>&1); then
  echo "$out" | tail -20
  echo "RED: all tests pass — the new tests do not exercise new behaviour."
  exit 1
fi
echo "$out" | tail -40
commit_state test red
git rev-parse HEAD > .tdd/red-sha
echo "RED: OK — tests compile and fail. Saved $(cat .tdd/red-sha)"
