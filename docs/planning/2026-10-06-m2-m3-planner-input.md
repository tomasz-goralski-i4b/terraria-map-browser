# Planner input — M2 and M3 (2026-10-06)

> **Historical:** the prompt used on 2026-10-06. The M1 issues and follow-ups it names are closed and the vectors
> moved to `docs/file-format/vectors.md` and `contracts/vectors/`. Do not reuse it as-is.

Run in Cezar: New task → workflow `plan-backlog` → paste the prompt below. Pick the runner/model in the dialog
(planning is rare and high-leverage — a deep model is worth it).

```text
Plan milestones M2 (.NET round trip) and M3 (TypeScript codec) from docs/architecture.md and
docs/adr/0001-dotnet-ts-contract.md (accepted). Do not create issues for M4+.

Decisions to respect:
- No runtime C#<->TS communication; the codecs meet only through contracts in contracts/ checked in CI.
- Storage is the Canonical World Model (one typed array per tile field + ContentRef palette, docs/cwm.md from
  #10), never one object per tile in TS.
- Golden files are meta.json + chunks.json per fixture; full CWM is generated in CI, never committed.
- Performance budgets are acceptance criteria, measured with benchmarks (vitest bench, BenchmarkDotNet);
  CI fails only on large regressions (> 30 %), not on absolute numbers.

M1 is still finishing: #10 (world summary + chunk digests + CWM conversion in .NET), #11 (diff), #12 (golden
files). Use "blockedBy": ["#10"] etc. for M2/M3 items that need them.

M2 must include: the .wld writer and a load -> save -> load round trip with a backup before every write
(docs/architecture.md M2), byte-level preservation of the sections M1 skips, CWM binary export in .NET
(export-cwm), moving the existing test vectors (T1-T17, R1-R10, M1-M5 in docs/file-format.md) to
contracts/vectors with JSON Schemas and running them from xUnit, and a BenchmarkDotNet baseline.
The in-game check of a round-tripped world is a `human` issue.

M3 must include: packages/world-codec parsing .wld in a Web Worker into CWM planes (no per-tile objects), the
shared contracts/vectors in Vitest, a CI job comparing .NET and TS CWM output byte for byte for every fixture,
a synthetic Large world generator for benchmarks (no game assets), perf budgets (Small world < 1 s and
< 150 MB peak as the first target), and the TS writer for the vanilla subset.

Fold in the open follow-ups (gh issue list --label follow-up): #26, #27, #28 and #30 belong in M2 codec/CLI
work (stream-position guard, string-length caps before allocation, tile read-window boundary test, CLI
catch-all for unexpected exceptions, escaping control characters in inspect output); #24 and #25 are docs
fixes. Reference the follow-up number in each issue body.

Keep the codec area serialized; put contracts, benchmarks, CI and docs work in other areas (infra, docs,
fixtures, model) so it runs in parallel. Max 15 issues per milestone.
```
