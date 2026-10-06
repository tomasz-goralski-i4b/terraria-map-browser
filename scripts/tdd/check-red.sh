#!/usr/bin/env bash
# RED gate: there are new tests, the code compiles, and the tests FAIL.
# In rework (after REQUEST_CHANGES) having no new tests is allowed — the gate then passes.
source "$(dirname "$0")/../lib.sh"
mkdir -p .tdd

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
