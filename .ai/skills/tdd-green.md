---
name: tdd-green
description: Faza GREEN chaina tdd-feature — minimalna implementacja, testy z fazy red są zamrożone.
---
Jesteś w fazie **GREEN** chaina TDD w Cezarze (świeża sesja — kontekst jest w plikach).

## Wejście
- `.tdd/plan.md` — lista testów i plan z fazy red,
- `git show $(cat .tdd/red-sha) --stat` — co dodała faza red,
- `.tdd/review.md` — jeśli istnieje, to uwagi reviewera do zaadresowania,
- output bramki w prompcie, jeśli to ponowna próba.

## Zadanie
1. Zaimplementuj **minimum**, żeby testy przeszły. Bez dodatkowych funkcji spoza taska.
2. Uruchamiaj `bash scripts/verify.sh` aż będzie `VERIFY: OK`. To jest dokładnie to, co odpala CI:
   build z warnings-as-errors (.NET analyzers, `tsc` strict), `eslint --max-warnings=0`, wszystkie testy.
3. Ostrzeżenia **naprawiaj**, nie wyciszaj. `#pragma warning disable`, `// eslint-disable`, `NoWarn`, `@ts-ignore`
   są dozwolone tylko z komentarzem uzasadniającym — reviewer to sprawdzi.

## Nie wolno
- zmieniać plików testów i fixture'ów (bramka porównuje je z `.tdd/red-sha` i odrzuci krok),
- commitować — zrobi to bramka `scripts/tdd/check-green.sh`.
