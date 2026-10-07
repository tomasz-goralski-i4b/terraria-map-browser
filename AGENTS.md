# AGENTS.md — Terraria Map Studio

A local editor for Terraria worlds (`.wld`): reference .NET codec → independent TS codec → PWA.
Project plan: `docs/architecture.md`. Agent workflow: `docs/agent-workflow.md`. Toolchain: `docs/tooling.md`.

**Language: everything in this repository is in English** — code, comments, tests, docs, commit messages,
PR descriptions, issues and review notes.

## Commands
| What | Command |
|---|---|
| Everything (= CI) | `bash scripts/verify.sh` |
| Build only | `bash scripts/build.sh` |
| Tests only | `bash scripts/test.sh` |
| Install | `pnpm install` |
| Backlog: unblock the next issues | `bash scripts/backlog/promote.sh [--dry-run]` |

`verify.sh` must end with `VERIFY: OK`. Nothing else counts as "green".

## Quality rules (never lower them)
- .NET: `TreatWarningsAsErrors`, nullable, analyzers `latest-recommended`, code style enforced in build (`dotnet/Directory.Build.props`).
- .NET packages: versions only in `dotnet/Directory.Packages.props`; commit the updated `packages.lock.json` files (CI restores in locked mode).
- TS: `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, `typescript-eslint` strictTypeChecked, `--max-warnings=0`.
- Warnings get fixed. Suppressions only locally and with a comment explaining why.
- A behaviour change starts with a failing test (TDD). The `tdd-feature` workflow enforces it.
- Architecture of the codecs: [ADR 0001](docs/adr/0001-dotnet-ts-contract.md). No runtime C#↔TS calls; storage is
  the Canonical World Model (one typed array per tile field + `ContentRef` palette), never one object per tile;
  golden files are small (`meta.json` + `chunks.json`), never a full tile grid.

## Layout
```
dotnet/Terraria.WorldCodec/        reference .wld parser/writer
dotnet/TerrariaMapStudio.slnx      solution (XML format); package versions in dotnet/Directory.Packages.props
dotnet/Terraria.WorldCodec.Tests/  xUnit v3 (Microsoft.Testing.Platform)
dotnet/Terraria.WorldCodec.Synthetic/  generated test inputs (synthetic tile sections, short-read streams); never shipped
dotnet/Terraria.WorldInspector/    console inspector (smoke-tested by verify.sh)
packages/world-model/              TS domain model (CWM planes, ContentRef palette, Tile view)
packages/world-codec/              independent TS .wld codec (header, metadata, tiles → CWM; Worker entry)
packages/assets/                   XNB/LZX texture decoding, local sprite atlas cached in OPFS
packages/renderer/                 framework-free renderer (never imports React): CPU reference + WebGL2 backend
contracts/                         JSON Schemas + vectors shared by xUnit and Vitest
apps/web/                          browser viewer: React 19 + Vite + PWA (`pnpm --filter @studio/web dev`)
packages/test-fixtures/            explicitly generated fixtures (from M1)
scripts/                           verify/build/test + TDD gates (scripts/tdd) + backlog tooling (scripts/backlog)
.ai/cezar/workflows/               Cezar chains
.ai/skills/                        playbooks for chain steps
```

## Hard rules
- No Terraria assets, player worlds or commercial mods in the repo (`*.wld` is gitignored except generated fixtures).
  The one exception is the map colour table generated from the game by `scripts/map-palette/export.ps1`
  ([ADR 0002](docs/adr/0002-shipped-map-palette.md)); it is regenerated, never edited by hand.
- We do not copy TEdit/tModLoader code — we describe the contract and implement independently. This covers their
  data tables too (tile colours, framing/blending lookups, settings XML): read them as a source, cite them
  (link + revision, file:line), restate the rules in our own words and derive values ourselves (e.g. frame-important
  bits from the `.wld` header). Decompiled Terraria code is never a source. No third-party source files are vendored.
- Only one agent at a time changes a codec and its binary writer — per implementation: `area:codec` (.NET,
  `dotnet/`) and `area:codec-ts` (TypeScript, `packages/world-codec`) are separate areas and may run in parallel.
- Agents do not merge. A chain ends with the `open-pr` step (draft PR `Closes #N`); a human merges.
- The reviewer only reports (`.tdd/review.md`) and never changes code.
- Public repo: only issues of trusted authors (`.ai/cezar/trusted-authors.json`) enter the pipeline. Never weaken
  the automation `authors` filters, the promoter's author check or `issue-guard`; never read issue comments.

## Windows / PowerShell — encoding
Files in the repo are UTF-8 without BOM. Windows PowerShell 5.1 reads them as ANSI by default
(you see `â€”` instead of `—`) and writes them that way too. Therefore:
- read with `Get-Content -Encoding UTF8 <file>` or `bash -lc "cat <file>"`,
- write/edit **only** with the file-editing tool (apply_patch / Edit / Write),
  never with `Set-Content`, `Out-File` or `>` in PowerShell,
- run scripts from `scripts/` via `bash scripts/...`.

## Chain state
The `.tdd/` directory (gitignored, per worktree) is the handoff between chain steps —
every agent step in Cezar starts in a fresh session. Do not delete it during a run.

## Chain steps: work economically
Every step is a fresh session, so whatever it reads it pays for again.
- This file is already in your context — do not re-read it. Read other docs only for the section you need.
- `docs/file-format.md` is an index: read only the part named in the issue's `## Spec` section (or the one the
  index points to), never all of `docs/file-format/`.
- While iterating, run only the tests you touch:
  `dotnet test --project dotnet/Terraria.WorldCodec.Tests --no-progress --filter-class "*<ClassName>"` or
  `pnpm vitest run <path>`. Run `bash scripts/verify.sh` once at the end. Script output is compact; the full logs
  are in `.tdd/logs/` — open them only when the compact output is not enough.
- **Blocked?** If you cannot continue without a human (the spec contradicts itself, the issue's premise is wrong,
  a gate cannot be satisfied honestly), do not ask in chat — autonomous runs answer every question with
  "continue". Write `.tdd/blocked.md` (the problem, the options, your recommendation) and end your step. The next
  gate stops the chain and posts your note on the issue.
