# AGENTS.md — Terraria Map Studio

Lokalny edytor światów Terrarii (`.wld`): referencyjny codec .NET → niezależny codec TS → PWA.
Plan projektu: `docs/architecture.md`. Workflow agentów: `docs/agent-workflow.md`.

## Komendy
| Co | Komenda |
|---|---|
| Wszystko (= CI) | `bash scripts/verify.sh` |
| Tylko build | `bash scripts/build.sh` |
| Tylko testy | `bash scripts/test.sh` |
| Install | `pnpm install` |
| Backlog: odblokuj następne | `bash scripts/backlog/promote.sh [--dry-run]` |

`verify.sh` musi kończyć się `VERIFY: OK`. Nic innego nie jest "zielone".

## Reguły jakości (nie obniżać)
- .NET: `TreatWarningsAsErrors`, nullable, analyzers `latest-recommended`, code style w buildzie (`dotnet/Directory.Build.props`).
- TS: `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, `typescript-eslint` strictTypeChecked, `--max-warnings=0`.
- Ostrzeżenia się naprawia. Wyciszenie tylko lokalnie i z komentarzem "dlaczego".
- Zmiana zachowania = najpierw failujący test (TDD). Workflow `tdd-feature` to wymusza.

## Struktura
```
dotnet/Terraria.WorldCodec/        referencyjny parser/writer .wld
dotnet/Terraria.WorldCodec.Tests/  xUnit
packages/world-model/              model domenowy TS (ContentRef, Tile…)
packages/test-fixtures/            jawnie wygenerowane fixture'y (od M1)
scripts/                           verify/build/test + bramki TDD (scripts/tdd)
.ai/cezar/workflows/               chainy Cezara
.ai/skills/                        playbooki kroków chainów
```

## Twarde zakazy
- Żadnych assetów Terrarii, światów graczy ani komercyjnych modów w repo (`*.wld` jest w `.gitignore`).
- Nie kopiujemy kodu TEdit/tModLoader — opisujemy kontrakt i implementujemy niezależnie.
- Codec i writer binarny zmienia naraz tylko jeden agent.
- Agent nie merge'uje. Chain kończy się krokiem `open-pr` (draft PR `Closes #N`); merge robi człowiek.
- Reviewer tylko raportuje (`.tdd/review.md`), nie zmienia kodu.

## Windows / PowerShell — kodowanie
Pliki w repo to UTF-8 bez BOM, z polskimi znakami. Windows PowerShell 5.1 domyślnie czyta je jako ANSI
(widać `â€”`, `Ä…` zamiast `—`, `ą`) i tak też zapisuje. Dlatego:
- czytaj: `Get-Content -Encoding UTF8 <plik>` albo `bash -lc "cat <plik>"`,
- zapisuj/edytuj **wyłącznie** narzędziem do edycji plików (apply_patch / Edit / Write),
  nigdy `Set-Content`, `Out-File`, `>` w PowerShell,
- skrypty z `scripts/` uruchamiaj przez `bash scripts/...`.

## Stan chaina
Katalog `.tdd/` (gitignored, per worktree) to handoff między krokami chaina —
każdy krok agenta w Cezarze startuje w świeżej sesji. Nie usuwaj go w trakcie runu.
