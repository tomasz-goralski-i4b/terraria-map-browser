#!/usr/bin/env bash
# Bramka REVIEW: reviewer nie zmienił kodu + werdykt z .tdd/review.md.
source "$(dirname "$0")/../lib.sh"
[ -f .tdd/green-sha ] || { echo "INFRA: brak .tdd/green-sha"; exit 2; }
green=$(cat .tdd/green-sha)

if ! git diff --quiet "$green" -- . || [ -n "$(git ls-files -o --exclude-standard)" ]; then
  echo "REVIEW: reviewer zmienił pliki — niedozwolone (review tylko raportuje):"
  git diff --stat "$green" -- .; git ls-files -o --exclude-standard
  exit 3
fi

[ -f .tdd/review.md ] || { echo "REVIEW: brak .tdd/review.md"; exit 3; }
verdict=$(head -1 .tdd/review.md | tr -d '\r')
case "$verdict" in
  "VERDICT: APPROVE")
    echo "REVIEW: APPROVE"; cat .tdd/review.md; exit 0 ;;
  "VERDICT: REQUEST_CHANGES")
    echo "Reviewer zażądał zmian. Dla błędów zachowania najpierw dodaj failujący test, który je odtwarza."
    echo; cat .tdd/review.md; exit 1 ;;
  *)
    echo "REVIEW: BLOCKED albo brak poprawnego werdyktu w 1. linii — decyzja człowieka:"
    cat .tdd/review.md; exit 3 ;;
esac
