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
Terraria 1.4.5.8, format version 326, four Small vanilla worlds covering every difficulty and both evils:
`SCCO1` (classic/corruption), `SECR1` (expert/crimson), `SJCO1` (journey/corruption), `SMCO1` (master/corruption).
`SCCO1` was generated as corruption but named "SCCR1" in game by mistake; the file was renamed, the bytes
are untouched (`renamedFrom` in the manifest). Missing combination: a **classic crimson** world (`SCCR2`).
`SMCO1` was opened in game once and saved on exit (`fileRevision` 2); the others were never opened.

## Adding a world
1. Generate it in the game with the settings encoded in the name; name the world exactly like the file.
2. Copy the `.wld` (not `.wld.bak`) from `Documents/My Games/Terraria/Worlds/` to `worlds/`.
3. Add its manifest entry; `bash scripts/verify.sh` reports any mismatch.
4. Medium/Large worlds are ~2–5× bigger; once the corpus grows past ~50 MB move `*.wld` to Git LFS.
