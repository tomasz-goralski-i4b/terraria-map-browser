# `.wld` format — Sources and versions

Part of the format specification; index and conventions: [../file-format.md](../file-format.md).

## Sources

| Id | Source | Revision | Accessed |
|---|---|---|---|
| T | TEdit — https://github.com/TEdit/Terraria-Map-Editor | commit `182031b83ce825719f857a6db4ecb6967118abd3` (2026-10-04) | 2026-10-06 |
| W1 | Terraria wiki, *Desktop version history* — https://terraria.wiki.gg/wiki/Desktop_version_history | revid `1023996` (2026-08-24) | 2026-10-06 |
| W2 | Terraria wiki, *1.4.5.8* — https://terraria.wiki.gg/wiki/1.4.5.8 | revid `1029883` (2026-09-16) | 2026-10-06 |
| W3 | Terraria wiki, *1.4.5.7* — https://terraria.wiki.gg/wiki/1.4.5.7 | revid `1031546` (2026-09-23) | 2026-10-06 |
| F | M1 fixture corpus (`SCCO1`, `SCCR2`, `SECR1`, `SJCO1`, `SMCO1`), Terraria 1.4.5.8 | this repo, `packages/test-fixtures/worlds/manifest.json` | 2026-10-06 |
| N | .NET `BinaryReader.ReadString` / `Read7BitEncodedInt` / `ReadBoolean` — https://learn.microsoft.com/dotnet/api/system.io.binaryreader | .NET 8 API reference (no revision ids; behaviour unchanged since .NET Framework 2.0) | 2026-10-06 |

TEdit locations used below (all at commit `182031b`):

| Ref | File:line | What it shows |
|---|---|---|
| T1 | `src/TEdit.Terraria/Data/versions.json:1-90` | game version → format version map |
| T2 | `src/TEdit.Terraria/WorldConfiguration.cs:15-16,50-51` | newest known format (326), tile count 754, the two signatures |
| T3 | `src/TEdit.Terraria/FileType.cs:3-9` | file-type byte values |
| T4 | `src/TEdit.Terraria/World.FileV2.cs:2511-2560` | reading the file header and pointer table (`LoadSectionHeader`, whole method) |
| T4a | `src/TEdit.Terraria/World.FileV2.cs:2515-2544` | the fixed header fields, in order: format version, 7-byte signature, file-type byte, file revision, 64-bit flags (only for format ≥ 140) |
| T4b | `src/TEdit.Terraria/World.FileV2.cs:2549-2554` | section count and the pointer table |
| T4c | `src/TEdit.Terraria/World.FileV2.cs:2557` | hand-off to the frame-important bit array (T5) |
| T5 | `src/TEdit.Terraria/World.FileV2.cs:2567-2600` | reading the frame-important bit array |
| T6 | `src/TEdit.Terraria/World.FileV2.cs:744-781` | writing the same structure (confirms order/types) |
| T7 | `src/TEdit.Terraria/World.FileV2.cs:22` | section count per version |
| T8 | `src/TEdit.Terraria/World.FileV2.cs:1392-1505` | section order, per-section version gates, position checks |
| T9 | `src/TEdit.Terraria/World.FileV2.cs:1941-1951` | footer |
| T10 | `src/TEdit.Terraria/World.cs:620-653` | dispatch by version (≤38 / ≤87 / >87) |
| T11 | `src/TEdit.Terraria/World.FileV2.cs:1996-2476` | reading world metadata, field order and version gates |
| T12 | `src/TEdit.Terraria/World.FileV2.cs:2478-2509` | kill counts, claimable banners, team spawns (metadata sub-lists) |
| T13 | `src/TEdit.Terraria/World.FileV2.cs:1414-1425` | end-of-metadata check; tile section end is *not* checked |
| T14 | `src/TEdit.Terraria/World.FileV2.cs:1507-1550` | tile loop: column-major order, run expansion, silent clamp at column end |
| T15 | `src/TEdit.Terraria/World.FileV2.cs:1552-1768` | reading one tile record (flag bytes, payload order, run counter) |
| T16 | `src/TEdit.Terraria/World.FileV2.cs:198-262` | writing tiles: run-length encoder, counter width choice |
| T17 | `src/TEdit.Terraria/World.FileV2.cs:267-521` | writing one tile record (confirms payload order and flag omission) |
| T18 | `src/TEdit.Terraria/Data/versions.json:951-960` | version 326: highest tile id 753, highest wall id 366, highest item id 6195, highest NPC id 696 |
| T19 | `src/TEdit.Terraria/BrickStyle.cs:3-11`, `src/TEdit.Terraria/LiquidType.cs:3-10` | block shape values 0–5; liquid kinds |
| T20 | `src/TEdit.Terraria/World.FileV2.cs:117-196` | `SaveV2`: revision increment (121-124), frame-important overlay (128-143), section order, pointers patched last (193-194) |
| T21 | `src/TEdit.Terraria/World.FileV2.cs:718-725` | writing the footer (Bool true, title, world id) |
| T22 | `src/TEdit.Terraria/World.FileV2.cs:727-742` | rewriting the version, section count and pointer table after all sections |
| T23 | `src/TEdit.Terraria/World.FileV2.cs:744-784` | writing the file header; header flags rebuilt from "favourite" only (763-766) |
| T24 | `src/TEdit.Terraria/World.FileV2.cs:1355-1366` | metadata writer appends kept "unknown data" after the manifest |
| T25 | `src/TEdit.Terraria/Tile.cs:87-109` | tile equality used by the run-length encoder |
| T26 | `src/TEdit.Terraria/TileType.cs:22,36,40` | ids 127 (ice-rod block), 520 (food platter), 423 (logic sensor) |
| T27 | `src/TEdit.Terraria/World.cs:66-160` | `SaveAsync`: write to `<file>.tmp`, then copy over the target, no backup of the previous file |
| T28 | `src/TEdit.Terraria/World.FileV2.cs:1427-1499` | sections 3–10 in `LoadV2`: order, version gates, end-position check after each; sign filter by tile (1443-1450), chest filter commented out (1429-1436) |
| T29 | `src/TEdit.Terraria/World.FileV2.cs:1770-1826` | reading chests (`LoadChestData`) |
| T30 | `src/TEdit.Terraria/World.FileV2.cs:523-574` | writing chests: legacy count cap below 216, per-chest slot count from 294 |
| T31 | `src/TEdit.Terraria/World.FileV2.cs:1828-1839`, `576-596` | reading and writing signs |
| T32 | `src/TEdit.Terraria/World.FileV2.cs:1841-1915`, `598-675` | reading and writing town NPCs, shimmered NPCs and mobs |
| T33 | `src/TEdit.Terraria/World.FileV2.cs:1953-1982`, `1379-1390` | tile entity section: count, legacy dummies (< 122), writer |
| T34 | `src/TEdit.Terraria/TileEntity.cs:377-419`, `428-433`, `435-465`, `502-580`, `335-375` | one tile entity: common head, per-kind payload, stack, hat rack, display doll; writer |
| T35 | `src/TEdit.Terraria/TileEntityType.cs:3-16` | tile entity kinds 0–10 |
| T36 | `src/TEdit.Terraria/TileType.cs:5-55`, `60-92` | tile ids of chests, signs and tile-entity objects; `IsChest` / `IsSign` / `IsTileEntity` |
| T37 | `src/TEdit.Terraria/World.FileV2.cs:1983-1994`, `693-704` | reading and writing weighted pressure plates |
| T38 | `src/TEdit.Terraria/World.FileV2.cs:1916-1926`, `677-691` | reading and writing the town manager rooms |
| T39 | `src/TEdit.Terraria/Bestiary.cs:60-83`, `35-58` | reading and writing the bestiary |
| T40 | `src/TEdit.Terraria/CreativePowers.cs:7-24`, `187-224`, `146-184` | creative power ids, reading (no value read for an unknown id) and writing |

Line numbers count physical lines of the file at the pinned commit (CRLF endings, blank lines included), which is
also what GitHub's `#L` anchors use, e.g.
https://github.com/TEdit/Terraria-Map-Editor/blob/182031b83ce825719f857a6db4ecb6967118abd3/src/TEdit.Terraria/World.FileV2.cs#L2511-L2560.

**Header reader location (re-checked 2026-10-06 for #25).** Follow-up #25 says `LoadSectionHeader` starts at
line 2474, with the fixed fields before line 2509. At `182031b` that does not hold. Line 2474 is inside
`LoadHeaderFlags` (T11; it is the line that keeps unknown trailing metadata bytes), and lines 2478–2509 are the
banner and team-spawn readers (T12). `LoadSectionHeader` starts at **line 2511**: its fixed fields are at
2515–2544 (T4a) and its pointer table at 2549–2554 (T4b). So T4 was already correct, and the rows above narrow it
down. None of the last 15 commits that touched this file puts the method at 2474 (nearest: 2473 at `e28f36c`),
so the 2474 figure probably came from a different revision or from a line count that skipped blank lines. In the
header reader, the fields, their order and their types match what "File header" describes, which agrees with
the #25 review.

The Terraria wiki has **no page describing the binary world format** (search for "world file format" on
terraria.wiki.gg returned nothing relevant on 2026-10-06). It is used only for game versions and release dates.
Format version numbers come from TEdit (T1) and, for 326, from our own fixtures (F).

## Versions

The **format version** is the first field of every `.wld` file. It is not the game version: several game
builds may share a format version, and some format numbers were never released.

| Game version (W1) | Released (W1) | Format version (T1) | M1 status |
|---|---|---|---|
| 1.0 – 1.2.4.1 | 2011 – 2014 | 2 – 102 (1.0 itself writes 38) | Rejected — legacy (no signature, other layout) |
| 1.3.0.1 – 1.3.5.3 | 2015 – 2017 | 146 – 194 | Rejected — not in M1 |
| 1.4.0.1 – 1.4.3.6 | 2020 – 2022 | 225 – 248 | Rejected — not in M1 |
| 1.4.4 – 1.4.4.9 | 2022-09-28 – 2022-11-17 | 269 – 279 | Rejected — not in M1 |
| 1.4.5.0, 1.4.5.1, 1.4.5.2 | 2026-01-27/28 | 315 (all three) | Rejected — not in M1 |
| 1.4.5.3 | 2026-01-30 | 316 | Rejected — not in M1 |
| 1.4.5.4 | 2026-02-04 | 317 | Rejected — not in M1 |
| 1.4.5.5 | 2026-02-10 | 318 | Rejected — not in M1 |
| 1.4.5.6 | 2026-03-09 | 319 | Rejected — not in M1 |
| 1.4.5.7 | 2026-08-19 | 325 | Rejected — not in M1 |
| **1.4.5.8** | **2026-08-23** (W1, W2) | **326** (T1, T2, F) | **Supported in M1** |
| — | — | 320 – 324 | Rejected — no known public release |
| unknown/newer | — | ≥ 327 | Rejected — newer than anything known |

**M1-supported range: exactly format version 326.** Reasons:
- It is the only version for which we hold independent evidence (four fixtures generated by 1.4.5.8, F).
- TEdit's newest known version is also 326 (T2), so there is nothing newer to compare against.
- TEdit's own comment (T2) says 1.4.5.8 only bumped the number over 1.4.5.7 (325); 315–325 are likely
  structurally identical in the header, but without fixtures we do not claim it. Widening the range is a
  follow-up (see below), one version per fixture.

Rejected versions are reported as `UnsupportedVersion(version)`; the codec must not try to read further.

### Discrepancies between sources
- W1 lists game versions only; TEdit (T1) is the sole public source for format numbers. 1.4.5.0/1/2 map to the
  same format 315 in T1 — the format version alone cannot identify the game build.
- T1 maps 1.0 to format 38 but 1.0.1 to 2 (the counter was restarted); this is irrelevant to M1 but means
  "format version" is not monotonic in game history before 1.1.
- TEdit reads the version as an unsigned 32-bit integer (T4), our manifest describes it as a signed Int32.
  For every valid value both readings agree; a value ≥ 2³¹ is rejected either way.
- TEdit accepts a second signature `xindong` (Chinese build, T2/T4). We have no sample; M1 rejects it.
