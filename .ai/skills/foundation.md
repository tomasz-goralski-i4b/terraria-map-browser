---
name: foundation
description: Prace infrastrukturalne bez TDD (CI, scaffolding, docs, tooling) zakończone zielonym verify.sh.
---
Pracujesz nad zadaniem infrastrukturalnym (świeża sesja, osobny worktree).

1. Przeczytaj `AGENTS.md` i `docs/agent-workflow.md`.
2. Jeśli w prompcie jest output bramki albo istnieje `.tdd/review.md` — zaadresuj te uwagi.
3. Nie obniżaj reguł jakości: `TreatWarningsAsErrors`, `--max-warnings=0`, `strict` w TS zostają.
4. Jeśli dodajesz nowy projekt/pakiet — musi być objęty `scripts/verify.sh` (i przez to CI).
5. Na koniec `bash scripts/verify.sh` → `VERIFY: OK`. Nie commituj — zrobi to bramka.
