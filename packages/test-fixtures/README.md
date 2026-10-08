# test-fixtures

Explicitly generated worlds used by the codec tests (.NET and TS).

## Rules
- Only worlds generated specifically for tests — never player worlds, game assets or files from commercial mods.
- Every `worlds/*.wld` has an entry in `worlds/manifest.json`, and every entry has a file.
  `bash scripts/verify.sh` enforces this (`scripts/check-fixtures.mjs`): file name ↔ naming key ↔ manifest fields,
  byte size and SHA-256, and — for format 326 — name, seed, dimensions, mode and evil read from the file
  itself, so a mislabelled world is caught.
- The manifest is the **independent oracle** for tests: its values come from the game settings and the raw file,
  never from our codec. Do not regenerate it with codec output.
- Prefer synthetic fixtures built in test code (header/section bytes) for unit tests — real worlds are for
  compatibility, snapshot and round-trip tests.
- Fixtures are immutable. A changed world is a new file with the next sequence number.

## Naming key

`<size><difficulty><evil><n>.wld` — e.g. `SMCO1.wld` = Small, Master, Corruption, #1.
The world name inside the file equals the file name without the extension. Exception: if a world was
mislabelled, the **file** is renamed (never the bytes) and the manifest records `renamedFrom` plus a `note`.

| Position | Code | Meaning | Manifest value |
|---|---|---|---|
| 1 — size | `S` | Small (4200×1200) | `small` |
| | `M` | Medium (6400×1800) | `medium` |
| | `L` | Large (8400×2400) | `large` |
| | `C` | Custom — non-standard dimensions, e.g. from a world-size mod | `custom` |
| 2 — difficulty | `J` | Journey | `journey` |
| | `C` | Classic | `classic` |
| | `E` | Expert | `expert` |
| | `M` | Master | `master` |
| 3 — evil (2 chars) | `CO` | Corruption | `corruption` |
| | `CR` | Crimson | `crimson` |
| | `BO` | Both — only possible with a mod | `both` |
| | `NO` | None — only possible with a mod | `none` |
| 4 — sequence | `1`, `2`, … | distinguishes worlds with the same settings | — |

`C` size, `BO` and `NO` evil only occur with mods. Such worlds must list the mods (name + version) in the
manifest's `mods` array; the vanilla corpus has `mods: []`. Modded fixtures are not part of M1 — keep the
codes reserved so the M6 mod-safety work can add them without renaming anything.

## Manifest fields
| Field | Source |
|---|---|
| `file`, `worldName`, `seed` | game settings at generation (world name = file name) |
| `gameVersion` | the Terraria build that generated the world |
| `formatVersion` | first little-endian Int32 of the file |
| `fileRevision` | save counter in the file header (1 = saved once after generation) |
| `size`, `dimensions` | world size chosen in the game; width × height in tiles |
| `mode`, `evil` | game settings at generation; must match the naming key |
| `mods` | `[]` for vanilla; otherwise `[{ "name", "version" }]` |
| `bytes`, `sha256` | the raw file |
| `generatedBy`, `generatedAt`, `inGameModifications` | provenance |

## Current corpus (M1)
Terraria 1.4.5.8, format version 326, five Small vanilla worlds covering every difficulty, both evils, and
both evils within one difficulty (classic) so tests can tell `evil` apart from `mode`:
`SCCO1` (classic/corruption), `SCCR2` (classic/crimson), `SECR1` (expert/crimson), `SJCO1` (journey/corruption),
`SMCO1` (master/corruption).
`SCCO1` was generated as corruption but named "SCCR1" in game by mistake; the file was renamed, the bytes
are untouched (`renamedFrom` in the manifest).
`SMCO1` was opened in game once and saved on exit (`fileRevision` 2); the others were never opened.

## Adding a world
1. Generate it in the game with the settings encoded in the name; name the world exactly like the file.
2. Copy the `.wld` (not `.wld.bak`) from `Documents/My Games/Terraria/Worlds/` to `worlds/`.
3. Add its manifest entry; `bash scripts/verify.sh` reports any mismatch.
4. Commit as usual — `*.wld` is stored in **Git LFS** (`.gitattributes`); `git lfs install` once per machine.
   A checkout without the LFS objects has 132-byte pointer files; `check-fixtures` says so (`git lfs pull`).
   CI restores LFS objects from the Actions cache, so it does not re-download them on every run.

## Golden summaries (M1)
`snapshots/m1/<world>.meta.json` is the `export-json` summary of a corpus world without its `chunks` object;
`<world>.chunks.json` is that `chunks` object (size, planes and one digest per 128×128 chunk and plane).
Both are plain text (UTF-8, LF, two-space indent, one trailing newline), ~160 KB per world, and are checked
byte for byte by `VanillaCorpusTests` in `dotnet test` — together with the manifest checks (hash, size,
version, name, seed, mode, evil, dimensions) and `inspect`. Verified against Terraria **1.4.5.8** (format 326).

A regular test run never writes them. After an intended codec/summary change, refresh and review the diff:
```bash
bash scripts/build.sh
TERRARIA_REFRESH_GOLDEN=1 dotnet test --solution dotnet/TerrariaMapStudio.slnx --no-build --filter-class "*VanillaCorpusTests"
git diff --stat packages/test-fixtures/snapshots/m1   # the PR shows exactly what changed
```
The tests of a refreshing run pass by construction — run them again without the variable to confirm.
If a world in the corpus ever falls outside the M1 contract, report it as a blocker instead of loosening the assertions.

## TypeScript contract checks

After building (`pnpm build`), run `pnpm vitest run packages/world-codec/tests/shared-contracts.test.ts`.
This checks the shared REC/SEC/META vectors and corpus golden summaries with the independent TypeScript
codec, without invoking .NET or refreshing any expectations.

## Round-trip evidence (load → save → load)

`RoundTripCorpusTests` runs `roundtrip` (`WorldReader.ReadForSave` → `WorldWriter`) on every manifest world and proves
nothing was lost: `RoundTripEvidence.Differences` compares header, metadata and every tile of the original and the
reloaded world, plus every byte the model does not expose (file header, consumed metadata bytes, sections 3–10, footer),
reporting the first differing byte as `<Section>: relative offset N`. A hash match alone is never the evidence.
The same tests check `diff` (exit 0), `export-json` against the goldens and byte-identical `export-cwm` files, and that a
second round trip equals the first. A missing fixture fails the test; it is never skipped.
```bash
bash scripts/build.sh
dotnet test --project dotnet/Terraria.WorldCodec.Tests --no-progress --filter-class "*RoundTripCorpusTests"
```
