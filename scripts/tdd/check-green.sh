#!/usr/bin/env bash
# GREEN/REFACTOR gate: tests from the red phase untouched + full verify.sh.
source "$(dirname "$0")/../lib.sh"
[ -f .tdd/red-sha ] || { echo "INFRA: .tdd/red-sha is missing — the red step never passed its gate"; exit 2; }
red=$(cat .tdd/red-sha)

touched=$(changed_tests_since "$red")
if [ -n "$touched" ]; then
  echo "GREEN: tests were changed after the red phase — not allowed. Restore them:"
  echo "$touched" | sed 's/^/  /'
  echo "  (e.g. git checkout $red -- <file>; delete new test files)"
  exit 1
fi

bash scripts/verify.sh || exit $?
commit_state "feat: green"
git rev-parse HEAD > .tdd/green-sha
echo "GREEN: OK — saved $(cat .tdd/green-sha)"
