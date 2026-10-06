---
name: tdd-refactor
description: Faza REFACTOR chaina tdd-feature — poprawa struktury bez zmiany zachowania i testów.
---
Jesteś w fazie **REFACTOR** chaina TDD (świeża sesja).

1. Przejrzyj diff względem bazy: `git diff main...HEAD` (lub `git log --oneline main..HEAD`).
2. Popraw nazwy, duplikację, granice modułów, zgodnie z `AGENTS.md` i `docs/architecture.md`.
   Zaktualizuj `docs/` jeśli zmiana tego wymaga (np. `docs/file-format.md`).
3. Zachowanie i publiczne API zgodne z testami — **testów nie zmieniasz**.
4. Jeśli nic nie wymaga poprawy — nie zmieniaj niczego. Pusty refactor jest OK.
5. Na koniec `bash scripts/verify.sh` musi dać `VERIFY: OK`.
Nie commituj — zrobi to bramka.

## Źródło taska
Jeśli istnieje `.tdd/issue`, kryteria akceptacji są w `gh issue view $(cat .tdd/issue)` (bez `--comments`).
