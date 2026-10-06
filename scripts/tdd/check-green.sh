#!/usr/bin/env bash
# Bramka GREEN/REFACTOR: testy z fazy red nietknięte + pełne verify.sh.
source "$(dirname "$0")/../lib.sh"
[ -f .tdd/red-sha ] || { echo "INFRA: brak .tdd/red-sha — krok red nie przeszedł bramki"; exit 2; }
red=$(cat .tdd/red-sha)

touched=$(changed_tests_since "$red")
if [ -n "$touched" ]; then
  echo "GREEN: zmieniono testy po fazie red — to niedozwolone. Przywróć je:"
  echo "$touched" | sed 's/^/  /'
  echo "  (np. git checkout $red -- <plik>; nowe pliki testów usuń)"
  exit 1
fi

bash scripts/verify.sh || exit $?
commit_state "feat: green"
git rev-parse HEAD > .tdd/green-sha
echo "GREEN: OK — zapisano $(cat .tdd/green-sha)"
