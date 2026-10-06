#!/usr/bin/env bash
# Bramka RED: są nowe testy, kod się kompiluje, a testy NIE przechodzą.
# W rework (po REQUEST_CHANGES) brak nowych testów jest dozwolony — wtedy przepuszcza.
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
    echo "RED (rework): brak nowych testów — uwagi reviewera nie dotyczą zachowania, przechodzę do green."
    commit_state "test: red (rework, no new tests)"; git rev-parse HEAD > .tdd/red-sha; exit 0
  fi
  echo "RED: nie dodano ani nie zmieniono żadnego testu (oczekiwane ścieżki: ${TEST_PATHSPEC[*]})."
  exit 1
fi
echo "RED: zmienione testy:"; echo "$tests" | sed 's/^/  /'

if ! out=$(bash scripts/build.sh 2>&1); then
  echo "$out"
  echo
  echo "RED: build nie przechodzi. Testy muszą się kompilować — dodaj sygnatury/stuby"
  echo "(C#: throw new NotImplementedException(); TS: throw new Error(\"not implemented\")), bez logiki."
  exit 1
fi

if out=$(bash scripts/test.sh 2>&1); then
  echo "$out" | tail -20
  echo "RED: wszystkie testy przechodzą — nowe testy nie sprawdzają nowego zachowania."
  exit 1
fi
echo "$out" | tail -40
commit_state "test: red"
git rev-parse HEAD > .tdd/red-sha
echo "RED: OK — testy kompilują się i failują. Zapisano $(cat .tdd/red-sha)"
