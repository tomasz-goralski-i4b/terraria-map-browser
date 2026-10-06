# The `.wld` format

The format specification in our own words (the contract for both the .NET and TS codecs).
Filled in by `spike` issues and refactor phases. Nothing here is copied from TEdit or tModLoader: the sources
were read, the behaviour is restated, and every byte-level claim was checked against the M1 fixture corpus
(`packages/test-fixtures/worlds/`).

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
| T18 | `src/TEdit.Terraria/Data/versions.json:951-960` | version 326: highest tile id 753, highest wall id 366 |
| T19 | `src/TEdit.Terraria/BrickStyle.cs:3-11`, `src/TEdit.Terraria/LiquidType.cs:3-10` | block shape values 0–5; liquid kinds |
| T20 | `src/TEdit.Terraria/World.FileV2.cs:117-196` | `SaveV2`: revision increment (121-124), frame-important overlay (128-143), section order, pointers patched last (193-194) |
| T21 | `src/TEdit.Terraria/World.FileV2.cs:718-725` | writing the footer (Bool true, title, world id) |
| T22 | `src/TEdit.Terraria/World.FileV2.cs:727-742` | rewriting the version, section count and pointer table after all sections |
| T23 | `src/TEdit.Terraria/World.FileV2.cs:744-784` | writing the file header; header flags rebuilt from "favourite" only (763-766) |
| T24 | `src/TEdit.Terraria/World.FileV2.cs:1355-1366` | metadata writer appends kept "unknown data" after the manifest |
| T25 | `src/TEdit.Terraria/Tile.cs:87-109` | tile equality used by the run-length encoder |
| T26 | `src/TEdit.Terraria/TileType.cs:22,36,40` | ids 127 (ice-rod block), 520 (food platter), 423 (logic sensor) |
| T27 | `src/TEdit.Terraria/World.cs:66-160` | `SaveAsync`: write to `<file>.tmp`, then copy over the target, no backup of the previous file |

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

## File header

All multi-byte integers are **little-endian**. Offsets are for format version 326.

| Offset | Size | Type | Field | Rule |
|---|---|---|---|---|
| 0 | 4 | Int32 | format version | must be 326 in M1 |
| 4 | 7 | ASCII | signature | must be `relogic` (`72 65 6c 6f 67 69 63`), no terminator |
| 11 | 1 | UInt8 | file type | must be `2` (world). Known values: 0 none, 1 map, 2 world, 3 player (T3) |
| 12 | 4 | UInt32 | file revision | save counter; any value accepted (1 after generation, F) |
| 16 | 8 | UInt64 | header flags | bit 0 = favourite; other bits reserved — kept as read, not interpreted |
| 24 | 2 | Int16 | section count `n` | must be 11 in M1 |
| 26 | 4·n | Int32[n] | section pointers | see *Section table* |
| 26+4n | 2 | Int16 | frame-important count `k` | number of tile types described |
| 28+4n | ⌈k/8⌉ | bytes | frame-important bits | see below |

For `n = 11` the section table starts at offset **26** and the frame-important block at offset **70**.
The file header ends at `72 + ⌈k/8⌉`; for 1.4.5.8 worlds `k = 754` (T2, F), so the header ends at **167**.

**Version gates** (from T4, T7, T8; informative — only 326 is accepted in M1):
- The version field is always present.
- Signature, file type, revision and flags are present only for versions ≥ 140. Below that the pointer table
  follows the version directly, and versions ≤ 87 have no pointer table at all (T10).
- Section count is 10 for versions below 220 and 11 from 220 on (T7).

**Check order** (makes the outcome of malformed input deterministic):
1. Fewer than 4 bytes → `Truncated`.
2. Version not supported → `UnsupportedVersion(version)`. The version is checked before the signature so that
   legacy (< 140, no signature) and future files get a precise reason. Consequence: a random non-world file
   usually ends here too, which is acceptable — it is rejected either way.
3. Fewer than 26 bytes → `Truncated`.
4. Signature ≠ `relogic` → `NotAWorld` (`xindong` → `NotAWorld` with reason "unsupported variant").
5. File type ≠ 2 → `NotAWorld`.
6. Section count ≠ 11 → `MalformedSectionTable`.
7. Fewer than `26 + 4n + 2` bytes, or fewer than `28 + 4n + ⌈k/8⌉` bytes → `Truncated`.
8. Section-table rules below → `MalformedSectionTable`.

## Section table

**Count:** 11 pointers for version 326. **Type and unit:** signed Int32, an **absolute byte offset from the
start of the file**. Pointer `i` marks the **end** of section `i`, which is also the start of section `i+1`.
After the last pointer comes the footer (T9).

| Index | Section that ends at this pointer | Present since (T8) |
|---|---|---|
| 0 | file header (this document) | always (≥ 88) |
| 1 | world metadata ("header flags": name, seed, sizes, progress…) | always |
| 2 | tiles | always |
| 3 | chests | always |
| 4 | signs | always |
| 5 | NPCs and mobs | always |
| 6 | tile entities | 116 |
| 7 | weighted pressure plates | 170 |
| 8 | town manager (rooms) | 189 |
| 9 | bestiary | 210 |
| 10 | creative (Journey) powers | 220 |
| — | footer: Bool `true`, length-prefixed world name, Int32 world id | always |

**Bounds and equalities** (let `L` = file length, `H` = end of the file header computed from `n` and `k`):
- `pointer[0] == H` exactly. Any other value → `MalformedSectionTable` (this is how the reader proves it
  understood the header).
- `pointer[i] < pointer[i+1]` for every `i` — **strictly increasing**. Equal pointers (an empty section) are
  not permitted: every vanilla section begins with at least a count field, the smallest being signs
  (Int16 count, 2 bytes, F). A decrease or an equality → `MalformedSectionTable`. One exception:
  `pointer[1] == pointer[0]` (empty metadata) passes the table and is rejected by the metadata contract as
  `MalformedMetadata { field "name" }` at `pointer[0]`, so that every metadata overrun — including one of
  zero bytes — is reported by the same section.
- `pointer[n-1] + 6 ≤ L`. The footer needs at least 6 bytes (Bool + 1-byte length of an empty name + Int32).
  A larger pointer, or any negative pointer → `MalformedSectionTable`. The fixtures have 11-byte footers
  for 5-character names (F).
- Bytes between `pointer[n-1]` and `L` are the footer; the footer's own validation is out of scope here.
- Because pointers are Int32, files of 2 GiB or more cannot be represented; such a file is rejected
  (`MalformedSectionTable`) rather than read with wrapped offsets.

The table only addresses sections. Validating a section's content, and checking that a section parser stopped
exactly at its end pointer, is the job of the section's own contract. Note: TEdit checks the end position after
every section except tiles, where it silently seeks to `pointer[2]` (T8, lines 1423-1424); our codecs must
treat a mismatch as an error instead.

## Frame-important bits

Tells, per tile type id, whether tiles of that type store frame coordinates (needed by the tile payload, M1
later). Encoding (T5, T6, verified on F):
- Int16 `k` = number of tile types. For 1.4.5.8 `k = 754` = highest tile id 753 + 1 (T2, F).
- Followed by `⌈k/8⌉` bytes. Tile id `i` is bit `i mod 8` (value `1 << (i mod 8)`, **least-significant bit
  first**) of byte `i div 8`.
- Unused high bits of the last byte are written as 0 (F: last byte `0x03`, only bits 752 and 753). Readers
  ignore them; writers emit 0.
- `k < 0` → `MalformedSectionTable`. `k = 0` is structurally valid (no bytes follow).
- The header layer accepts any `k`; whether `k` matches the tile ids used in the tile payload is decided by the
  tile contract (see open questions).
- In all four fixtures exactly 412 bits are set, and the set equals TEdit's `framedTileIds` list for
  version 326 (T1) — the two sources agree.

## Hex examples

Original, synthetic vectors (not taken from any world). The valid base vector uses version 326, revision 1,
flags 0, 11 sections, `k = 10` with tile ids 3, 4, 5 and 9 frame-important, and a hypothetical file length
`L = 200`. Pointers: 74, 100, 120, 124, 126, 130, 134, 138, 142, 154, 180.

### A. Valid header and table → `Ok`
```
0000: 46 01 00 00 72 65 6c 6f 67 69 63 02 01 00 00 00
0010: 00 00 00 00 00 00 00 00 0b 00 4a 00 00 00 64 00
0020: 00 00 78 00 00 00 7c 00 00 00 7e 00 00 00 82 00
0030: 00 00 86 00 00 00 8a 00 00 00 8e 00 00 00 9a 00
0040: 00 00 b4 00 00 00 0a 00 38 02
```
`46 01 00 00` = 326; `relogic`; type 2; revision 1; flags 0; `0b 00` = 11 sections; pointers start at 0x1A.
`0a 00` = 10 bits; `38` = bits 3, 4, 5; `02` = bit 9 (bits 10–15 are padding). The header ends at 74 = 0x4A =
`pointer[0]`. Increasing pointers, last 180 + 6 ≤ 200.
Result: `Ok { version 326, revision 1, flags 0, sections [74 … 180], frameImportant {3,4,5,9} of 10 }`.

### B. Truncation → `Truncated`
The first 40 bytes of A (`L = 40`): the file ends inside the pointer table (needs 26 + 44 + 2 = 72 bytes).
```
0000: 46 01 00 00 72 65 6c 6f 67 69 63 02 01 00 00 00
0010: 00 00 00 00 00 00 00 00 0b 00 4a 00 00 00 64 00
0020: 00 00 78 00 00 00 7c 00
```
Result: `Truncated` (step 7). A file of 3 bytes gives `Truncated` at step 1; 20 bytes at step 3.

### C. Pointer beyond the file → `MalformedSectionTable`
A with `pointer[10] = 0x1000` (4096), `L = 200`. Table bytes 0x1A–0x45:
```
001a: 4a 00 00 00 64 00 00 00 78 00 00 00 7c 00 00 00
002a: 7e 00 00 00 82 00 00 00 86 00 00 00 8a 00 00 00
003a: 8e 00 00 00 9a 00 00 00 00 10 00 00
```
Result: `MalformedSectionTable { index 10, reason "beyond end of file" }` (4096 + 6 > 200).

### D. Decreasing pointer → `MalformedSectionTable`
A with `pointer[3] = 110` (0x6E) while `pointer[2] = 120`. Table bytes 0x1A–0x45:
```
001a: 4a 00 00 00 64 00 00 00 78 00 00 00 6e 00 00 00
002a: 7e 00 00 00 82 00 00 00 86 00 00 00 8a 00 00 00
003a: 8e 00 00 00 9a 00 00 00 b4 00 00 00
```
Result: `MalformedSectionTable { index 3, reason "not greater than previous" }`. Setting `pointer[3] = 120`
(`78 00 00 00`) gives the same result (equality is not permitted).

### E. Unsupported version → `UnsupportedVersion`
A 1.4.4.9 world (format 279 = `17 01 00 00`), otherwise a well-formed header:
```
0000: 17 01 00 00 72 65 6c 6f 67 69 63 02 01 00 00 00
0010: 00 00 00 00 00 00 00 00
```
Result: `UnsupportedVersion(279)` — decided at step 2, nothing after the version is read.
Likewise `47 01 00 00` (327) → `UnsupportedVersion(327)`.

### Cross-check on real fixtures
Bytes 0–25 of `SCCO1.wld` (F) match the layout:
`46 01 00 00 72 65 6c 6f 67 69 63 02 01 00 00 00 00 00 00 00 00 00 00 00 0b 00`, then `pointer[0] = a7 00 00 00`
(167) and frame-important count `f2 02` (754) at offset 70. All four fixtures satisfy every rule above;
`SMCO1` has revision 2 (opened once in game).

## Primitive types

Used by the metadata and tile sections. All integers little-endian (as in the header).

| Name | Size | Meaning |
|---|---|---|
| UInt8 / Int16 / UInt16 / Int32 / UInt32 / Int64 / UInt64 | 1/2/2/4/4/8/8 | two's complement for signed types |
| Single / Double | 4 / 8 | IEEE-754 binary32 / binary64 |
| Bool | 1 | `00` = false, `01` = true. .NET treats any non-zero byte as true (N); **M1 rejects other values** (`MalformedMetadata`) so that a read→write round trip cannot change a byte. All four fixtures use only 0/1 (F). |
| String | 1–5 + n | length `n` as an unsigned LEB128 ("7-bit encoded") integer, then `n` bytes of UTF-8, no terminator (N). |

String rules:
- Length prefix: 7 bits per byte, least-significant group first, high bit = "another byte follows". At most
  5 bytes, the 5th using only its low 4 bits (32 bits in total), and the value must be `≤ 2³¹−1` — .NET rejects
  a longer prefix and a negative length (N). A violation, or `n` not fitting
  before the end of the section → `MalformedMetadata`.
- Bytes must be valid UTF-8 → otherwise `MalformedMetadata`. (.NET would silently replace invalid sequences with
  U+FFFD, which breaks round trip — our decision.)
- Example from F: the world manifest string in `SCCO1` has prefix `93 4a` = `0x13 + (0x4a << 7)` = 9491 bytes.

## World metadata (section 1)

Starts at `pointer[0]` (end of the file header) and must end **exactly** at `pointer[1]`. Read strictly in
the order below (T11). The type and the version gate decide whether a field is present; there are no
per-field lengths, so every field — including the ones M1 does not expose — must be decoded to reach the
end. "Expose" = the value is part of the M1 model/`inspect` output; "consume" = it is parsed (and kept for
round trip in M2) but not interpreted.

The "@SCCO1" column is the absolute offset in fixture `SCCO1.wld` (5-byte name, 9-byte seed), so offsets after
the name shift with string lengths. Rows marked *list* repeat their element type `count` times.

| # | Field | Type | Present for version (T11) | @SCCO1 | M1 |
|---|---|---|---|---|---|
| 1 | world name | String | always | 167 | **expose** `name` |
| 2 | seed | Int32 if version = 179, String if ≥ 180 | ≥ 179 | 173 | **expose** `seed` (text) |
| 3 | world-gen version | UInt64 | ≥ 179 | 183 | consume (F: `0x00000146_00000001`) |
| 4 | world GUID | 16 bytes | ≥ 181 | 191 | **expose** `guid` as 32 hex digits **in file byte order** (see note) |
| 5 | world id | Int32 | always | 207 | **expose** `worldId` |
| 6–9 | left, right, top, bottom bounds | Int32 ×4 (pixels) | always | 211 | consume (F: 0, 16·width, 0, 16·height) |
| 10 | **height** (tiles) | Int32 | always | 227 | **expose** `height` |
| 11 | **width** (tiles) | Int32 | always | 231 | **expose** `width` |
| 12 | game mode | Int32 if ≥ 209; Bool (true = 2) if = 208; Bool (true = 1) if 112–207 | ≥ 112 | 235 | **expose** `mode` |
| 13 | special-seed flags: drunk ≥ 222, good ≥ 227, tenth-anniversary ≥ 238, dont-starve ≥ 239, not-the-bees ≥ 241, remix ≥ 249, no-traps ≥ 266, zenith ≥ 267, skyblock ≥ 302 | Bool each, in this order | per flag; all only if ≥ 209 | 239–247 | consume |
| 14 | creation time | Int64 (.NET `DateTime` binary form) | ≥ 141 | 248 | consume |
| 15 | last played | Int64 (same form) | ≥ 284 | 256 | consume |
| 16 | moon type | UInt8 | always | 264 | consume |
| 17 | tree x-boundaries ×3, tree styles ×4, cave-back x ×3, cave-back styles ×4, ice / jungle / hell back styles | Int32 ×17 | always | 265 | consume |
| 18 | spawn x, spawn y | Int32 ×2 | always | | consume |
| 19 | surface level, rock level, time | Double ×3 | always | | consume |
| 20 | day time | Bool; moon phase Int32; blood moon Bool; eclipse Bool | always | | consume |
| 21 | dungeon x, dungeon y | Int32 ×2 | always | | consume |
| 22 | **crimson** | Bool | always | 380 | **expose** `evil` (false = corruption, true = crimson) |
| 23 | 10 boss-defeated flags (Eye … Golem) | Bool ×10 | always | | consume |
| 24 | King Slime defeated | Bool | ≥ 118 | | consume |
| 25 | 3 NPC-saved + 4 invasion-defeated flags | Bool ×7 | always | | consume |
| 26 | orb smashed Bool, spawn meteor Bool, orb count UInt8, altar count Int32, hardmode Bool | — | always | | consume |
| 27 | party-of-doom | Bool | ≥ 257 | | consume |
| 28 | invasion delay, size, type | Int32 ×3; invasion x Double | always | | consume |
| 29 | slime-rain time | Double | ≥ 118 | | consume |
| 30 | sundial cooldown | UInt8 | ≥ 113 | | consume |
| 31 | raining Bool, rain time Int32, max rain Single, 3 hardmode ore tiers Int32 ×3, 8 background styles UInt8 ×8, cloud-bg Int32, cloud count Int16, wind Single | — | always | | consume |
| 32 | angler finishers: count Int32 + *list* String | — | ≥ 95 (below 95 the section ends here) | 476 | consume |
| 33 | angler saved Bool (≥ 99), angler quest Int32 (≥ 101), stylist saved Bool (≥ 104), tax collector saved Bool (≥ 140), golfer saved Bool (≥ 201), invasion start size Int32 (≥ 107), cultist delay Int32 (≥ 108) | — | as given; the section ends early below 99 / 101 / 104 | | consume |
| 34 | kill counts: count Int16 + *list* Int32 | — | ≥ 109 (T12; ends early below 109) | 496 | consume |
| 35 | claimable banners: count Int16 + *list* UInt16 | — | ≥ 289 (T12) | 1670 | consume |
| 36 | fast-forward time | Bool | ≥ 140 (ends early below 128) | | consume |
| 37 | Duke Fishron defeated Bool (≥ 131, ends early below 131); Martians, Cultist, Moon Lord Bool ×3 (≥ 140); 5 seasonal boss flags Bool ×5 (≥ 131) | — | as given | | consume |
| 38 | 4 pillars defeated, 4 pillars active, apocalypse | Bool ×9 | ≥ 140 (ends early below 140) | | consume |
| 39 | party: manual Bool, genuine Bool, cooldown Int32, partying NPCs count Int32 + *list* Int32 | — | ≥ 170 | 2283 (count) | consume |
| 40 | sandstorm: active Bool, time Int32, severity Single, intended severity Single | — | ≥ 174 | | consume |
| 41 | bartender saved + 3 Old One's Army tiers | Bool ×4 | ≥ 178 | | consume |
| 42 | mushroom bg UInt8 (≥ 195), underworld bg UInt8 (≥ 215), 3 more tree bgs UInt8 ×3 (≥ 195) | — | as given | | consume |
| 43 | combat book used | Bool | ≥ 204 | | consume |
| 44 | lantern night: cooldown Int32, genuine, manual, next-is-genuine Bool ×3 | — | ≥ 207 | | consume |
| 45 | tree-top variations: count Int32 + *list* Int32 | — | ≥ 211 | 2317 (F: 13) | consume |
| 46 | force Halloween / Christmas today | Bool ×2 | ≥ 212 | | consume |
| 47 | pre-hardmode ore tiers (copper, iron, silver, gold) | Int32 ×4 | ≥ 216 | | consume |
| 48 | bought cat, dog, bunny | Bool ×3 | ≥ 217 | | consume |
| 49 | Empress of Light, Queen Slime defeated (≥ 223); Deerclops (≥ 240); town-slime / NPC unlocks: 1 Bool (≥ 250), 8 Bool (≥ 251) | — | as given | | consume |
| 50 | combat book II (≥ 259), peddler's satchel (≥ 260), 7 slime unlocks (≥ 261) | Bool | as given | | consume |
| 51 | fast-forward to dusk Bool + moondial cooldown UInt8 | — | ≥ 264 | | consume |
| 52 | force Halloween / Christmas forever | Bool ×2 | ≥ 287 | | consume |
| 53 | vampire seed Bool (≥ 288), infected seed Bool (≥ 296) | — | as given | | consume |
| 54 | meteor-shower count, coin rain | Int32 ×2 | ≥ 291 (note: physically **after** row 53 although its gate is lower) | | consume |
| 55 | team-spawns seed Bool, then count UInt8 + *list* (x Int16, y Int16) | — | ≥ 297 (T12) | 2430 (count) | consume |
| 56 | dual-dungeons seed | Bool | ≥ 304 | | consume |
| 57 | more-lightning, no-lightning seeds | Bool ×2 | ≥ 323 | | consume |
| 58 | deprecated value | UInt32 | 299 ≤ version < 313 only | — | skip |
| 59 | world-gen manifest (JSON text) | String | ≥ 299 | 2434 | consume (F: ~9.5 KB of generation-pass JSON) |
| — | end of section | | | 11927 = `pointer[1]` | |

Notes and rules:
- **Height comes before width.** Easy to swap; vector M1 below pins it.
- GUID: .NET's `Guid(byte[])` text form reorders the first 8 bytes (little-endian groups). To keep .NET and TS
  identical we expose the 16 bytes as hex in file order (F `SCCO1`: `87e466e7853c3f48b75abc85e36d4b86`).
- Game mode values (for version ≥ 209): 0 classic, 1 expert, 2 master, 3 journey — all four confirmed by F
  (`SCCO1` 0, `SECR1` 1, `SMCO1` 2, `SJCO1` 3). Any other value is kept as `{ mode: "unknown", raw }`, not an
  error (preserve unknown data).
- Evil: the Bool at row 22 is the only evil flag in the metadata. In F it agrees with the tiles of every
  fixture (crimson-only tiles in `SECR1`, corruption-only in the other three) and, since the fix for open
  question 5, with the manifest; `scripts/check-fixtures.mjs` enforces it.
- Counts (rows 32, 34, 35, 39, 45, 55) must be ≥ 0 (signed types) and the list must fit before `pointer[1]`;
  otherwise `MalformedMetadata`. No other upper bound is defined by any source; this "fits in the section"
  rule is the only bound needed.
- End: after row 59 the reader must be exactly at `pointer[1]`. Before → `MalformedMetadata { reason
  "unread bytes" }`; after → `MalformedMetadata { reason "overruns section" }`. TEdit instead keeps leftover
  bytes as opaque "unknown data" (T11, end) and fails only on overrun (T13). M1 is strict because only 326 is
  accepted and all four fixtures end exactly (F, leftover 0); preserving trailing bytes is an M2/next-version
  decision.
- **Dimensions** (our own rules; no source defines a minimum or maximum):
  - `width ≤ 0` or `height ≤ 0` → `MalformedMetadata { field "width"/"height", reason "must be positive" }`.
  - Every column needs at least one record byte, so `width ≤ pointer[2] − pointer[1]` (derived bound).
  - Implementation safety limit (annotated, not from a source): `width ≤ 65 536`, `height ≤ 65 536` and
    `width · height ≤ 2²⁸`, so a hostile file cannot make the reader allocate gigabytes. TEdit has no limit
    (T11). Vanilla's largest preset is commonly given as 8400 × 2400 — not checked against a pinned source,
    but either way far below the limit; F worlds are 4200 × 1200.
  - The pixel bounds (rows 6–9) are not cross-checked against the dimensions in M1 (open question).

Version gates are listed for completeness; M1 accepts only format 326, for which **every** row except 58 is
present. A reader for 326 may therefore be a straight sequence; the gates matter only when the version range
is widened.

## Tile data (section 2)

Starts at `pointer[1]`, must end **exactly** at `pointer[2]`.

### Order and coordinates
- Coordinates: `x` = column, 0 = leftmost; `y` = row, 0 = topmost (the top bound is 0, F). `0 ≤ x < width`,
  `0 ≤ y < height`.
- Records are stored **column by column**: all of column 0 from `y = 0` down to `height − 1`, then column 1, …
  (T14).
- Each record describes one tile plus a repeat count `run`: the same tile also fills `(x, y+1) … (x, y+run)`.
  The next record starts at `y + run + 1`. A run **never crosses into the next column** (the writer restarts at
  each column, T16).

### Record layout
A record is 1–4 flag bytes followed by a payload whose parts are present or absent according to the flags
(T15, confirmed by the writer T17 and by decoding all of F).

Flag byte 1 (always present):

| Bit | Meaning |
|---|---|
| 0 | flag byte 2 follows |
| 1 | a block (foreground tile) is present |
| 2 | a wall is present |
| 3–4 | liquid kind: 0 none, 1 water, 2 lava, 3 honey |
| 5 | block id is 2 bytes (else 1) |
| 6–7 | run counter width: 0 none (`run = 0`), 1 = UInt8, 2 = Int16, 3 = reserved |

Flag byte 2 (present iff byte-1 bit 0):

| Bit | Meaning |
|---|---|
| 0 | flag byte 3 follows |
| 1 / 2 / 3 | red / blue / green wire |
| 4–6 | block shape: 0 full, 1 half block, 2–5 the four slopes (T19 names them top-right, top-left, bottom-right, bottom-left); 6–7 undefined |
| 7 | unused (0 in F) |

Flag byte 3 (present iff byte-2 bit 0):

| Bit | Meaning | Since |
|---|---|---|
| 0 | flag byte 4 follows | 269 |
| 1 | actuator present | |
| 2 | block inactive (switched off by an actuator) | |
| 3 | block paint byte present | |
| 4 | wall paint byte present | |
| 5 | yellow wire | |
| 6 | wall id high byte present | 222 |
| 7 | the liquid is shimmer (only with liquid kind 1) | 269 |

Flag byte 4 (present iff byte-3 bit 0, version ≥ 269):

| Bit | Meaning |
|---|---|
| 0 | would announce a 5th flag byte; never set by any known writer (F, T17) — reserved |
| 1 / 2 | invisible block / invisible wall (echo coating) |
| 3 / 4 | full-bright block / full-bright wall (illuminant coating) |
| 5–7 | unused (0 in F) |

The game and TEdit never write a flag byte whose only content would be its "next byte follows" bit: a flag byte
is emitted only if it or a later one carries data (T17; F has no all-zero optional flag byte). Readers accept
such bytes (they are unambiguous) but writers must not produce them.

Payload, in this exact order:

| # | Part | Present iff | Type |
|---|---|---|---|
| 1 | block id | byte-1 bit 1 | UInt8, or UInt16 if byte-1 bit 5 |
| 2 | frame x, frame y | block present **and** the block id is frame-important (header bit array) | Int16 ×2 |
| 3 | block paint | block present and byte-3 bit 3 | UInt8 |
| 4 | wall id (low byte) | byte-1 bit 2 | UInt8 |
| 5 | wall paint | wall present and byte-3 bit 4 | UInt8 |
| 6 | liquid amount | liquid kind ≠ 0 | UInt8 (0–255) |
| 7 | wall id high byte | byte-3 bit 6 | UInt8; wall id = low + 256·high |
| 8 | run | byte-1 bits 6–7 ≠ 0 | UInt8 or Int16 |

Note the order: the wall high byte comes **after** the liquid amount, not next to the low byte.

### Rules and limits
| Rule | Outcome | Source |
|---|---|---|
| Block id `≥ k` (frame-important count from the header) | `MalformedTiles { reason "no frame-important entry" }` — payload size is undecidable. TEdit guesses "frame-important" instead. | T15 (TEdit's guess), our decision |
| Block id written as 2 bytes although `< 256` | accepted, same tile (non-canonical; never in F, writer emits 1 byte iff id ≤ 255) | T17, F |
| Wall flag set but wall id (after the high byte) = 0 | `MalformedTiles` — "no wall" has its own encoding (flag clear); the writer never emits it | T17, our decision |
| Paint flag without block, wall-paint flag without wall, wall-high flag without wall, non-zero block shape without block, block-id-width flag without block | `MalformedTiles { reason "flag without owner" }`. Never in F. TEdit ignores most of these but **does** consume the wall-high byte without a wall, so readers would otherwise disagree about the byte stream. | T15, F, our decision |
| Shimmer bit with liquid kind 2 or 3, or with no liquid | `MalformedTiles` (never in F; writer only sets it with kind 1) | T17, F |
| Block shape 6 or 7 | `MalformedTiles` (only 0–5 are defined) | T19 |
| Byte-2 bit 7, byte-4 bits 0 and 5–7 | must be 0 → otherwise `MalformedTiles { reason "reserved bit" }`. Strict so that unknown future data is not silently dropped. | F (always 0), our decision |
| Liquid amount 0 with a liquid kind | accepted and kept (`amount: 0`); the writer never emits it (T17 writes liquid only for amount ≠ 0, F has none) | T17, F |
| Run width 3 | `MalformedTiles { reason "reserved run width" }`. TEdit reads it as Int16. | T15, our decision |
| UInt8 run of 0, Int16 run < 256 | accepted (non-canonical; writer uses UInt8 for 1–255, Int16 above, nothing for 0) | T16, F (never seen) |
| Int16 run < 0 | `MalformedTiles { reason "negative run" }` | our decision (TEdit treats it as 0) |
| `y + run > height − 1` | `MalformedTiles { reason "run crosses column end" }`. TEdit silently stops at the column end. | T14, our decision |
| A record not complete before `pointer[2]` | `MalformedTiles { reason "truncated record" }` (the header contract already guarantees `pointer[2]` is inside the file, so this is never `Truncated`) | header contract |
| All columns done but position ≠ `pointer[2]` | `MalformedTiles { reason "section not fully consumed" }`. TEdit silently seeks (T13). | T13, our decision |
| Paint byte values | any 0–255 kept as read; vanilla uses 0–31 (31 = illuminant, upgraded to coating by newer writers) | T17 |

Error payload: `MalformedTiles { x, y, offset, reason }` with the coordinates of the record and its absolute
file offset; `MalformedMetadata { field, offset, reason }`.

Observed in F (all four fixtures, decoded with these rules, each ending exactly at `pointer[2]`): highest
block id 752; ids 255 and 256 do not occur; 2-byte ids 68–76 k per world; no walls > 255; no flag byte 4;
water/lava/honey/shimmer all present, liquid amount 255 is the maximum and 0 never occurs; UInt8 runs
~450 k per world and Int16 runs ~2 k (longest run 604); no run crosses a column; wall paint occurs only in
`SECR1` (43 tiles); every "never" rule above has zero occurrences.

## Model mapping

How a decoded record becomes the `Tile` / `ContentRef` of `docs/architecture.md` (and the .NET equivalent).
"Absent" means the optional property is not set (TS: key missing; .NET: `null`), never a default like 0.

| Model field | Value | Present iff |
|---|---|---|
| `block` | `{ kind: "vanilla", id }` if `id ≤ 753`; otherwise `{ kind: "unknown", runtimeId: id }` | block flag set |
| `frameX`, `frameY` | the two Int16 values | block present and frame-important |
| `paint` | block paint byte | block-paint flag |
| `wall` | `{ kind: "vanilla", id }` if `id ≤ 366`; otherwise `{ kind: "unknown", runtimeId: id }` | wall flag set |
| `wires` | bit mask: 1 red, 2 blue, 4 green, 8 yellow | always (0 = none) |
| `actuator` | byte-3 bit 1 | always (false if byte 3 absent) |
| `liquid` | `{ kind: water/lava/honey/shimmer, amount }` — shimmer when kind 1 and byte-3 bit 7 | liquid kind ≠ 0 |

- 753 and 366 are the highest vanilla tile and wall ids for format 326 (T18). They are a property of the
  version, not of the file; `k` (the frame-important count) is the file's own claim and only decides payload
  size. This section never yields `kind: "mod"` refs — tModLoader stores mod tiles in a separate file (out of
  M1); a vanilla-format id above the vanilla range can only become `unknown`.
- Run-length encoding is purely a storage detail: the model holds one `Tile` per coordinate.

**Additive fields** for the remaining vanilla flags, so that nothing read is lost (all optional/false by
default, so existing consumers keep working):

| Field | Type | From |
|---|---|---|
| `shape` | `"full" \| "half" \| "slopeTopRight" \| "slopeTopLeft" \| "slopeBottomRight" \| "slopeBottomLeft"` (absent = full) | byte-2 bits 4–6 |
| `inactive` | boolean | byte-3 bit 2 |
| `wallPaint` | number | wall paint byte |
| `invisibleBlock`, `invisibleWall` | boolean | byte-4 bits 1, 2 |
| `fullBrightBlock`, `fullBrightWall` | boolean | byte-4 bits 3, 4 |

In .NET these are additional properties of the tile record (nullable `WallPaint`, `BlockShape` enum, bools).
The TS `Tile` type is owned by `packages/world-model`; adding them there is a follow-up (see below). With
these fields, every bit and byte of a canonical record can be re-encoded; only the non-canonical forms listed
above (2-byte small ids, small Int16 runs, run 0, empty optional flag bytes) do not survive byte-for-byte —
their meaning does.

Not adopted from TEdit (editor behaviour, not format): resetting the frame y of timers on load, dropping the
shape of blocks that cannot be sloped (T15). Never run-compressing certain tile types on save (T16) **is**
adopted by the writer contract (see "Writer contract", rule W-T7).

## Sections skipped in M1

M1 reads sections 0–2 (header, metadata, tiles). Sections 3–10 (chests, signs, NPCs, tile entities, pressure
plates, town manager, bestiary, creative powers) and the footer are **not parsed**: the reader stops after
`pointer[2]`; their positions are known only from the section table. Cross-checking the footer's name/id
with metadata rows 1 and 5 is done by the footer contract below (M2).

## Footer (M2)

The footer is everything from `pointer[10]` to the end of the file `L` (T9, T21). Layout:

| Part | Type | Rule |
|---|---|---|
| marker | Bool | must be `01` |
| world name | String (rules of "Primitive types") | its UTF-8 bytes must equal the bytes of metadata row 1 **byte for byte** |
| world id | Int32 | must equal metadata row 5 |

After the world id the reader must be exactly at `L`. Check order and outcomes (the first failure wins; every
error carries the absolute `offset` of the part that failed — the marker, the name prefix, the id, or the first
trailing byte):
1. Fewer than 1 + 1 + 4 bytes, or the name length runs past `L − 4` → `MalformedFooter { offset, reason
   "truncated" }`.
2. Marker ≠ `01` → `MalformedFooter { reason "invalid marker" }` (TEdit also fails on `00`, T9; any other byte is
   rejected for the same reason as metadata Bools).
3. Invalid string prefix or invalid UTF-8 → `MalformedFooter { reason "invalid name" }`.
4. Name bytes ≠ metadata name bytes → `InconsistentFooter { field "name" }`.
5. World id ≠ metadata world id → `InconsistentFooter { field "worldId" }`.
6. Bytes left after the world id → `MalformedFooter { reason "trailing bytes" }`.

TEdit fails on the same three mismatches (T9) but does not check for trailing bytes. A world whose footer is not
valid is **never written** (see W-S5): the writer has nothing trustworthy to copy, and a footer that disagrees
with the metadata is either corruption or an unknown variant. Observed in F (all five worlds): marker `01`,
11-byte footer (`01`, `05`, 5 name bytes, 4 id bytes), name and id equal to the metadata, ends exactly at `L`.

## Metadata and tile vectors

Synthetic vectors (not taken from any world). Unless stated otherwise: format 326, the real 326
frame-important set (`k = 754`; ids 4 and 5 are frame-important, 1, 255 and 256 are not — T18), and a world of
**width 2, height 4**.

### Entry points
Each tile vector names one of two entry points. This tells a test which decoder seam it exercises. It also
separates **intentional record fragments** (a few bytes that are deliberately not a whole section) from
**complete sections**, including sections that are cut short on purpose. Missing tiles in a fragment are never
an error. In a complete section the bytes shown are everything up to `pointer[2]`.

| Entry point | Input | What the bytes shown are | Output |
|---|---|---|---|
| **REC** — record | The bytes shown, starting at a record boundary, plus context: format 326, the frame-important set above, the record position (default `x 0, y 0`) and the column height (4). | One complete record, or a short prefix of a column (R6 only), and nothing more. The decoder must consume exactly these bytes. The rest of the 2 × 4 grid is not part of the vector, and `pointer[2]` plays no role. | The decoded `Tile` and its `run`, or `MalformedTiles` at the record's position and offset (relative to the first byte shown). |
| **SEC** — complete tile section | The bytes shown are the whole tile section of a **2 × 4** world, so `pointer[2] = pointer[1] + byte count shown` (or the explicit `pointer[2]` given). | Every byte between `pointer[1]` and `pointer[2]`. A record left unfinished at `pointer[2]` is a truncation (R9), and bytes after the last tile are left over (R10). | The full 2 × 4 grid, or `MalformedTiles` with absolute `x, y, offset`. |

A REC vector can be run through a public, whole-file API if a harness wraps it in a full world. The wrapping is
harness filler, not part of the vector, and must not change the documented result:
- **Run-0 records (T1–T17):** the record alone is the whole tile section of a **1 × 1** world. A 1 × 1 world
  holds exactly one record, so the section ends right after it (as `WorldReaderTileRecordTests` does).
- **Run records (R1, R2, R4, R5, R7, R8):** put the record at `x 0, y 0` of a 2 × 4 world. If it decodes, add
  filler records that complete the grid; if it is meant to fail, add none (the error comes first). For example,
  R2 becomes `42 01 01` + `00 00 40 03` and R4 becomes `82 01 03 00` + `00 48 ff 02` (as
  `WorldReaderTileGridTests` does).
- **R6:** the bytes are the start of column 0. The error happens before the bytes run out, so the bytes shown
  can also be the whole section with no filler.

### Metadata
- **M1. Dimensions order.** Rows 10–11 bytes `04 00 00 00 02 00 00 00` → `height 4, width 2`.
- **M2. Zero / negative.** `00 00 00 00 02 00 00 00` → `MalformedMetadata { field "height", reason "must be
  positive" }`; `04 00 00 00 ff ff ff ff` (width −1) → same for `width`.
- **M3. Real prefix (F).** `SCCO1` from offset 167: `05 53 43 43 52 31` (name "SCCR1"), `09 39 34 38 35 38 30 39
  31 38` (seed "948580918"), `01 00 00 00 46 01 00 00` (world-gen version), 16 GUID bytes, `47 4d e9 67`
  (world id 1743427911), `00 00 00 00 80 06 01 00 00 00 00 00 00 4b 00 00` (bounds 0, 67200, 0, 19200),
  `b0 04 00 00` (height 1200), `68 10 00 00` (width 4200), `00 00 00 00` (classic).
- **M4. Bad Bool.** Any Bool byte `02` → `MalformedMetadata { reason "invalid boolean" }`.
- **M5. String overrun.** A name prefix `ff ff ff ff 0f` (2³²−1, too large) or a valid length reaching past
  `pointer[1]` → `MalformedMetadata { field "name" }`.

### Single records (one tile, `run = 0`)
Entry point **REC** for every row (T1–T17). Each byte string is one complete record at `x 0, y 0`: an
intentional fragment, not a 2 × 4 section. None of them is cut short. The error rows (T14–T17) fail on the
content of the record, and a decoder reports them before it needs any byte beyond the ones shown.

| Id | Bytes | Result |
|---|---|---|
| T1 empty | `00` | empty tile: no block, no wall, no liquid, wires 0, actuator false |
| T2 active | `02 01` | `block vanilla 1` (not frame-important → no frame) |
| T3 id 255 | `02 ff` | `block vanilla 255` |
| T4 id 256 | `22 00 01` | `block vanilla 256` (bit 5 → 2-byte id, low byte first) |
| T5 non-canonical 255 | `22 ff 00` | same as T3 (accepted) |
| T6 framed | `02 04 00 00 42 00` | `block vanilla 4, frameX 0, frameY 66` |
| T7 water 255 | `08 ff` | `liquid water 255` |
| T8 lava 0 | `10 00` | `liquid lava 0` (accepted, kept) |
| T9 shimmer | `09 01 80 ff` | `liquid shimmer 255` |
| T10 everything | `07 13 3a 01 0d 04 02` | block 1, shape half, paint 13, wall 4, wallPaint 2, wires 9 (red+yellow), actuator |
| T11 wall 300 + water | `0d 01 40 2c 0a 01` | wall vanilla 300 (`0x2c + 256·1`), liquid water 10 — high byte after the amount |
| T12 header 4 | `03 01 01 02 01` | block 1, invisibleBlock |
| T13 unknown wall | `05 01 40 90 01` | wall id 400 > 366 → `wall unknown runtimeId 400` |
| T14 id ≥ k | `22 f2 02` | id 754 → `MalformedTiles { reason "no frame-important entry" }` |
| T15 dangling paint | `01 01 08` | `MalformedTiles { reason "flag without owner" }` |
| T16 shimmer + lava | `11 01 80 ff` | `MalformedTiles` |
| T17 shape 6 | `03 60 01` | `MalformedTiles` |

### Runs and columns (width 2, height 4)
| Id | Entry point | Bytes | Result |
|---|---|---|---|
| R1 run 0 | REC: record `42 01 00` at `x 0, y 0` (the following `00` records … are SEC filler) | `42 01 00` + 3 more `00` records … | the UInt8 run of 0 is accepted; one tile |
| R2 run 1 | REC: one record at `x 0, y 0` | `42 01 01` | stone at (x, y) and (x, y+1) |
| R3 last legal run | **SEC**: complete 2 × 4 section, `pointer[2] = pointer[1] + 7` | `42 01 03 00 48 ff 02` | column 0: stone ×4 (run 3 from y 0 = `height − 1`); column 1: empty at y 0, water 255 at y 1–3. 7 bytes, ends at `pointer[2]` |
| R4 Int16 run | REC: one record at `x 0, y 0` | `82 01 03 00` | same as the first record of R3 |
| R5 beyond column | REC: one record at `x 0, y 0`, column height 4 | `42 01 04` | `MalformedTiles { x 0, y 0, reason "run crosses column end" }` |
| R6 beyond column, late | REC: four records from `x 0, y 0` (start of column 0) | `00 00 00 42 01 01` | y 3 with run 1 → `MalformedTiles { x 0, y 3 }` |
| R7 negative run | REC: one record at `x 0, y 0` | `82 01 ff ff` | `MalformedTiles { reason "negative run" }` |
| R8 reserved width | REC: one record at `x 0, y 0` | `c2 01 01 00` | `MalformedTiles { reason "reserved run width" }` |
| R9 truncation | SEC, cut short on purpose: 2 × 4 section, `pointer[2] = pointer[1] + 4` (the T10 record without its last 3 bytes) | `07 13 3a 01` then `pointer[2]` | `MalformedTiles { x 0, y 0, reason "truncated record" }` |
| R10 leftover | **SEC**: complete 2 × 4 section, `pointer[2] = pointer[1] + 8` | R3 followed by one extra `00` before `pointer[2]` | `MalformedTiles { reason "section not fully consumed" }` |

R3 and R10 are the reference vectors for the complete-section entry point. All 8 tiles of the 2 × 4 grid
(2 columns × 4 rows) are encoded: R3 ends exactly at `pointer[2]`, and R10 has one extra byte after the last
tile. R9 is the only vector meant to be cut short. Every other row is a fragment by design, so a 2 × 4 decoder
that hits `pointer[2]` before finishing the grid on one of them is running it at the wrong entry point (it would
report `truncated record`, not the documented result).

| Vectors | Entry point | Intentional fragment? |
|---|---|---|
| T1–T17 | REC (one record) | yes: a single record |
| R1, R2, R4, R5, R7, R8 | REC (one record) | yes: a single record |
| R6 | REC (records from the start of column 0) | yes: a column prefix |
| R3, R10 | SEC (complete 2 × 4 section) | no: all 8 tiles are present |
| R9 | SEC (2 × 4 section, cut short on purpose) | no: the truncation is the subject of the vector |

Cross-check on F: every fixture's tile section starts with a column-0 record `40 e8` / `40 ea` / `40 e6`
(empty sky, UInt8 run of 232–234), followed by water records such as `08 7f` and `48 ff 63` — the same encodings
as T1, T7 and R3.

## Writer contract (M2, format 326)

The rules both independent writers (.NET in M2, TS in M3) follow when saving a world that was **read by the M1/M2
reader**. Creating worlds from scratch, other format versions and modded worlds are out of scope; a writer asked
to save anything else refuses (`UnsupportedWrite`). The save procedure around the writer — backup, temporary
file, replace, and the in-game check — is in [round-trip.md](round-trip.md).

Terms:
- **Source**: the bytes the world was read from. The writer keeps them (or the spans named below) until the save.
- **Verbatim span**: a byte range of the source copied to the output unchanged.
- **Semantic model**: the metadata fields exposed in M1 plus the CWM planes and palette (docs/cwm.md). Two
  tiles are *equal* iff all ten CWM plane values are equal and the palette entries they point to are equal.
- **Unchanged save**: the semantic model to be written equals the one read from the source (no edits). M2 only
  performs unchanged saves.

### Layout produced

The writer emits, in order: file header (H bytes), metadata, tiles, sections 3–10, footer — the same order as
the source (T20). Everything except the tile section and the pointer table is a verbatim span in an unchanged
save:

| Part | Source range | Output | Rule |
|---|---|---|---|
| version, signature, file type | 0–11 | `46 01 00 00`, `relogic`, `02` | the only values the reader accepts, so equal to the source |
| file revision | 12–15 | verbatim | W-H1 |
| header flags | 16–23 | verbatim, all 64 bits | W-H2 |
| section count | 24–25 | `0b 00` | the only value the reader accepts |
| pointer table | 26–69 | regenerated | W-S2 |
| frame-important count and bits | 70 … H−1 | verbatim | W-H3 |
| metadata | `pointer[0]` … `pointer[1]` | verbatim | W-M1 |
| tiles | `pointer[1]` … `pointer[2]` | re-encoded | W-T1 … W-T9 |
| sections 3–10 | `pointer[2]` … `pointer[10]` | verbatim, one span | W-S1 |
| footer | `pointer[10]` … L | verbatim | W-S5 |

### Header rules
- **W-H1 Revision.** The writer writes the revision held by the model, which is the revision read. It never
  increments it on its own. An unchanged save therefore keeps the revision (an unchanged save of `SMCO1` keeps 2).
  TEdit increments by default on every save (T20, lines 121-124), and the game raises it when it saves (F: `SMCO1`
  was opened once and has 2). Raising it for edited saves is a later decision (open question 12); when that is
  added it is an explicit caller option, +1 per save, and a revision of `0xFFFFFFFF` is refused rather than
  wrapped.
- **W-H2 Header flags.** All 64 bits are copied as read, including the reserved bits 1–63 that M1 keeps but
  does not interpret. TEdit rebuilds the field from the favourite bit alone (T23, lines 763-766) and so would
  clear any other bit; we do not. F: 0 in all five worlds.
- **W-H3 Frame-important information.** `k` and the `⌈k/8⌉` bytes are copied verbatim, including the unused
  high bits of the last byte (0 in F; if a source has them set they stay set — they are not meaningful, but
  copying them costs nothing and keeps the span exact). The writer uses **this** set, not a per-version table,
  to decide whether a block has frame coordinates, so the reader and writer agree on every record. TEdit
  instead overlays its own per-version table onto the file's set and may change `k` (T20, lines 128-143); we
  do not.

### Metadata, sections 3–10 and the footer
- **W-M1 Metadata.** Section 1 is one verbatim span: every field M1 only consumes (rows 3, 6–9, 13–59 of the
  metadata table, including the world-gen manifest) keeps its exact bytes, and so do the exposed fields in an
  unchanged save. Because the reader requires the section to end exactly at `pointer[1]`, there are no unknown
  trailing bytes to keep (TEdit's "unknown data", T24, cannot occur). For later milestones that edit an exposed
  field: only that field's bytes are replaced (a String gets a new length prefix); all other bytes stay; width
  and height are not editable through metadata (they define the tile grid); editing the name or the world id
  also rewrites the footer (W-S5).
- **W-S1 Sections 3–10.** The bytes from `pointer[2]` to `pointer[10]` are copied as **one** span. No section in
  this range stores an absolute file offset: every reader of them is sequential and is only checked against the
  pointer at its end (T8, lines 1438-1498), so moving the span does not change its meaning. They do store tile
  **coordinates** (chests, signs, tile entities, pressure plates, rooms); that matters only once tiles can be
  edited (M5+, see follow-ups), not for unchanged saves.
- **W-S2 Pointer regeneration.** With `len(i)` = the output length of section `i`:
  `pointer[0] = H`; `pointer[i] = pointer[i−1] + len(i)` for `i = 1 … 10`. Sections 3–10 keep their source
  lengths, so with `Δ = new tile length − source tile length` (and an unchanged metadata length):
  `pointer[0]` and `pointer[1]` are unchanged and **`pointer[i] = source pointer[i] + Δ` for `i = 2 … 10`**.
  If the metadata length changes by `Δm` (a future name edit), `pointer[1 … 10]` move by `Δm` as well.
- **W-S3 Size bound.** If the output would reach 2³¹ bytes or more, the save fails (`UnsupportedWrite { reason
  "file too large" }`) before anything is written; pointers are Int32.
- **W-S4 Self-check.** The writer's output must satisfy every rule of "Section table" (strictly increasing,
  `pointer[0] = H`, `pointer[10] + 6 ≤ L`). It is re-read by the reader before it replaces anything
  ([round-trip.md](round-trip.md), step B5).
- **W-S5 Footer.** Only a source whose footer passed "Footer (M2)" can be saved. The footer is copied verbatim;
  when the name or id has been edited it is rebuilt as `01`, the metadata name String (same bytes), the world
  id. An inconsistent source footer is never "repaired" by regenerating it: the save is refused with the
  footer error.

### Tile encoding
The tile section is always re-encoded from the semantic model, column by column (`x = 0 … width−1`), each column
from `y = 0` down. The record layout is the one of "Record layout"; these rules make the output unique:

- **W-T1 Flag bytes.** Flag byte `i+1` is emitted iff it, or a later flag byte, has a bit set besides its own
  "next byte follows" bit; the "next byte follows" bit of byte `i` is set iff byte `i+1` is emitted (T17, lines
  492-519). Byte-2 bit 7 and byte-4 bits 0 and 5–7 are always 0.
- **W-T2 Payload order.** Exactly the order of the payload table: block id, frame x, frame y, block paint, wall
  low byte, wall paint, liquid amount, wall high byte, run. (The wall high byte comes after the liquid amount.)
- **W-T3 Block id.** One byte iff `id ≤ 255`, otherwise two bytes (low first) with byte-1 bit 5. So 255 →
  `02 ff` and 256 → `22 00 01`. `unknown` blocks are written with their `runtimeId`. A block id `≥ k` or
  `> 65535` cannot be encoded → `UnencodableTile { x, y, reason }` (never silently dropped).
- **W-T4 Frames.** Frame x and frame y (Int16 each) are written iff a block is present and its id is set in the
  file's frame-important bits (W-H3); they are written as held, including negative values. A model that has
  frames for a non-frame-important block, or none for a frame-important one, is `UnencodableTile`.
- **W-T5 Wall id.** Wall `0` means "no wall" (no flag). Otherwise the low byte is written with byte-1 bit 2,
  and for `id ≥ 256` the high byte with byte-3 bit 6. So 255 → `04 ff` and 256 → `05 01 40 00 01`. Above
  65535 → `UnencodableTile`.
- **W-T6 Paint, liquid, other flags.** See "Noncanonical input on save" for the two values the game itself would
  not write (paint 0 and liquid amount 0). Paint 31 (illuminant paint) is written as paint 31; it is **not**
  turned into the full-bright coating flags as TEdit does (T17, lines 342-349, 483-490), because that changes
  the CWM `paint` and `flags` planes. Shimmer is liquid kind 1 plus byte-3 bit 7. Shape, wires, actuator,
  inactive and the four coating flags go into their bits as in "Record layout".
- **W-T7 Runs.** A record covers the tile at `y` plus `run` more tiles below it that are **equal** to it
  (definition above). The encoder is greedy: it takes the longest run possible, limited by
  1. the end of the column (a run never continues into the next column; the last record of a column ends at
     `y = height − 1`),
  2. **32767** (the largest Int16 run): a longer stretch is split, and the next record starts again with the
     same tile,
  3. **block ids 520 and 423** (food platter, logic sensor — T26): a record whose block is one of these always
     has `run = 0`, even when its neighbours are equal (T16, line 224). The exclusion applies only when a block
     is present; empty tiles are never excluded.

  The counter is: `run = 0` → no counter (bits 6–7 = 0); `1 ≤ run ≤ 255` → UInt8 with bits 6–7 = 1;
  `256 ≤ run ≤ 32767` → Int16 with bits 6–7 = 2 (T16, lines 233-250). Run width 3 is never written.
- **W-T8 No other exclusions.** Apart from W-T7.3 the writer merges every equal neighbour. Evidence: re-encoding
  all five fixtures with W-T1 … W-T7 reproduces every tile section byte for byte (below), so the game merged
  every equal neighbour in F. F contains no tile with id 520, 423 or 127, so W-T7.3 rests on T16 alone (open
  question 10).
- **W-T9 Nothing is dropped.** Unlike TEdit, the writer never discards content: not the ice-rod block 127
  (TEdit never saves it, T17 line 293), not ids above the version's vanilla range (TEdit drops them unless
  "preserve all" is on, T16 lines 201-202), not paint, not a liquid of amount 0. If something cannot be encoded
  the save fails with `UnencodableTile`.

### Noncanonical input on save
Inputs the reader accepts but the writer would not produce. "Kept" means the semantic value survives; only
encoding-only details may change, and nothing that is part of the semantic model is lost.

| Input (reader vector) | Semantic value | Written as | Bytes change? |
|---|---|---|---|
| 2-byte block id ≤ 255 (T5 `22 ff 00`) | block 255 | `02 ff` | yes, encoding only |
| UInt8 run 0 (R1 `42 01 00`) | one stone tile | `02 01` | yes, encoding only |
| Int16 run < 256 (R4 `82 01 03 00`) | four stone tiles | `42 01 03` | yes, encoding only |
| Empty optional flag byte (`03 00 01`) | stone | `02 01` | yes, encoding only |
| Equal neighbours stored as separate records (`02 01` `02 01`, column height 2) | two stone tiles | `42 01 01` | yes, encoding only |
| A run of 520 or 423 (`62 08 02 00 00 00 00 01`) | two food platters | `22 08 02 00 00 00 00` twice | yes, encoding only |
| **Liquid amount 0** (T8 `10 00`) | lava, amount 0 (CWM `liquid` 2, `liquidAmount` 0) | **`10 00`** — kept | no |
| Shimmer amount 0 (`09 01 80 00`) | shimmer, amount 0 | `09 01 80 00` — kept | no |
| **Block paint flag with value 0** (`03 01 08 01 00`) | stone, no paint | `02 01` | yes, encoding only |
| Wall paint flag with value 0 (`05 01 10 04 00`) | wall 4, no wall paint | `04 04` | yes, encoding only |
| Paint 31 (`03 01 08 01 1f`) | stone, paint 31 | `03 01 08 01 1f` — kept | no |

Why liquid 0 and paint 0 differ: CWM keeps a liquid kind with amount 0 as its own value (`liquid` ≠ 0,
`liquidAmount` 0), so the writer must emit the kind and the amount byte 0 even though neither TEdit (T17,
line 395) nor the game would. CWM defines a paint byte of 0 as "no paint" (docs/cwm.md), so a present paint byte
0 and an absent one are the same semantic value, and dropping the byte loses nothing. The .NET `Tile` view
(`Paint = 0` vs `null`) and the TS `Tile` view must compare these as equal in round-trip tests. F has no
liquid amount 0, no paint 0 and no paint 31.

### Writer vectors
Entry point **COL**: a whole column (or several) from the semantic model → the exact output bytes. Format 326,
the real frame-important set (520 and 423 are frame-important; 1, 255, 256 are not).

| Id | Input | Output |
|---|---|---|
| W1 | column height 1: block 255 | `02 ff` |
| W2 | column height 1: block 256 | `22 00 01` |
| W3 | column height 1: wall 255 | `04 ff` |
| W4 | column height 1: wall 256 | `05 01 40 00 01` |
| W5 | column height 1: empty (run 0) | `00` |
| W6 | column height 2: stone ×2 (run 1) | `42 01 01` |
| W7 | column height 256: empty (run 255) | `40 ff` |
| W8 | column height 257: empty (run 256) | `80 00 01` |
| W9 | column height 32768: empty (run 32767) | `80 ff 7f` |
| W10 | column height 32769: empty | `80 ff 7f` `00` (split, W-T7.2) |
| W11 | width 2, height 4: stone everywhere | `42 01 03` `42 01 03` (never one run across columns) |
| W12 | column height 2: food platter (520) frame (0, 0) ×2 | `22 08 02 00 00 00 00` `22 08 02 00 00 00 00` |
| W13 | column height 3: logic sensor (423) frame (18, 0) ×3 | `22 a7 01 12 00 00 00` three times |
| W14 | column height 1: lava amount 0 | `10 00` |
| W15 | column height 1: stone, paint 0 (or paint absent) | `02 01` |
| W16 | column height 1: stone, paint 31 | `03 01 08 01 1f` |
| W17 | column height 1: block 754 with `k = 754` | `UnencodableTile { x 0, y 0 }` |

W9 and W10 are single-column worlds (width 1); heights up to 65 536 are inside the M1 safety limit.

### Evidence: original vs candidate layout
Independent analysis (a stand-alone script written for this spike, sharing no code with either codec; it decodes
with "Tile data" and re-encodes with W-T1 … W-T7, copying everything else as above):

| World | L | `pointer[0 … 10]` (source = candidate) | Tile bytes | Footer | Candidate SHA-256 = source |
|---|---|---|---|---|---|
| SCCO1 | 2 994 409 | 167, 11927, 2970538, 2994270, 2994272, 2994343, 2994347, 2994351, 2994355, 2994367, 2994398 | 2 958 611 (882 756 records) | 11 bytes, "SCCR1" / 1743427911 = metadata | yes (`31bb924d…3d1d08`) |
| SJCO1 | 2 825 462 | 167, 11928, 2804301, 2825325, 2825327, 2825396, 2825400, 2825404, 2825408, 2825420, 2825451 | 2 792 373 (837 820 records) | 11 bytes, "SJCO1" / 866419627 = metadata | yes (`0c67aba1…a0cc76`) |

The same holds for SCCR2, SECR1 and SMCO1: an unchanged save of every fixture is **byte-identical** to the
source, revision included. Section sizes 3–10 in both worlds: chests 23 732 / 21 024, signs 2, NPCs 71 / 69,
tile entities 4, pressure plates 4, town manager 4, bestiary 12, creative powers 31.

Relocation check: a noncanonical variant of each world was made by widening the first tile record's UInt8 run
to Int16 (`40 e8` → `80 e8 00` in SCCO1, `40 ea` → `80 ea 00` in SJCO1) and adding 1 to `pointer[2 … 10]`. The
writer's candidate for that variant has `Δ = −1`, `pointer[2 … 10]` back at the original values, sections 3–10
and the footer unchanged, and a SHA-256 equal to the original fixture — i.e. W-S1/W-S2 relocate the verbatim
span exactly.

## Open questions
1. Are formats 315–325 identical to 326 in the file header and section table? (Very likely, per T2's comment;
   needs one fixture per version.)
2. Should the codec warn when `k` differs from the tile count expected for the version (754 for 326)? TEdit
   treats tile ids ≥ `k` as frame-important. *Partly answered by the tile contract:* ids ≥ `k` are an error
   (vector T14); whether `k ≠ 754` itself deserves a warning is still open.
3. Header flags bits other than bit 0: always zero in F; does the game ever set them? (For saving it no longer
   matters: the writer keeps all 64 bits, W-H2.)
4. Is `pointer[n-1] + 6 ≤ L` too lax? A stricter bound needs the world name, which belongs to the metadata
   contract.
5. ~~**Fixture manifest error:**~~ **Resolved:** the file was renamed `SCCR1.wld` → `SCCO1.wld` and the
   manifest now says `corruption` (bytes untouched, in-game name still `SCCR1`; `renamedFrom` + `note` in the
   manifest). `scripts/check-fixtures.mjs` now compares name, seed, dimensions, mode and evil with the file.
   Original finding: `SCCR1` was declared `"evil": "crimson"` in `manifest.json`, but its metadata
   crimson flag is false and its tiles contain 26 348 corruption tiles (ids 23, 25, 112) and no crimson tiles
   (199, 203, 234). The world is a corruption world; either the manifest entry or the world-generation choice
   was wrong. `SECR1` (crimson) and the two corruption worlds are consistent. Consequence: M1 has **no
   classic-mode crimson fixture** and no test that distinguishes `evil` from `mode`. See follow-up.
6. Strict end-of-metadata (`pointer[1]` reached exactly): fine for 326; when a newer format appends fields,
   should the reader keep unread bytes opaquely (TEdit's approach) instead of failing?
7. Should the metadata pixel bounds (rows 6–9) be required to equal `16 · width` / `16 · height`? True in F,
   no source states it as a rule.
8. Are the "dangling flag" and "reserved bit" rejections too strict for worlds written by third-party
   editors? None occur in F; a corpus of TEdit-saved worlds would tell.
9. The game's own handling of a run crossing the column end, a negative Int16 run or run width 3 is unknown
   (only TEdit's behaviour is visible). M1 rejects all three.
10. W-T7.3 (no runs for 520 and 423) and TEdit's refusal to save block 127 come from TEdit only; F has none of
    these tiles. A fixture with food platters, logic sensors and an ice-rod block, saved by 1.4.5.8, would show
    what the game does. Splitting such runs is safe either way (every reader accepts `run = 0`).
11. The writer emits two things the game never wrote in F: a liquid of amount 0 and paint 31 on a block. Both
    are valid records for our reader, but whether 1.4.5.8 loads them unchanged is not checked; the in-game check
    in round-trip.md covers only the fixtures, which contain neither.
12. Revision policy for **edited** saves (M5+): +1 per save like the game, or keep it? W-H1 only fixes the
    unchanged case.
13. Footer trailing bytes are rejected (TEdit ignores them). None in F; a corpus of worlds saved by other tools
    would tell whether this is too strict.
14. The .NET `Tile` view (and the `export-json` region output) still shows a present paint byte 0 as `paint: 0`
    while CWM treats it as "no paint". Should the reader normalize it to absent, so that every view agrees with
    the writer? Until then, round-trip tests compare paint 0 and absent as equal. This refines #39's "paint
    presence" criterion: a non-zero paint keeps its presence; a present 0 is normalized.

## Proposed follow-up issues

```markdown
## Goal
The reference .NET codec recognises a .wld file and returns its header and section table, or a precise error.

## Scope
- Reader for the file header, section table and frame-important bits exactly as in docs/file-format.md.
- Result type: Ok / Truncated / NotAWorld / UnsupportedVersion / MalformedSectionTable.

## Out of scope
- Metadata, tile payload, other sections, writer, modded worlds.

## Ownership
- dotnet/Terraria.WorldCodec/, dotnet/Terraria.WorldCodec.Tests/

## Compatibility impact
- Vanilla: Render (recognition only)
- Modded worlds: None

## Acceptance criteria
- Vectors A–E from docs/file-format.md give the documented results.
- All four M1 fixtures parse with the pointers and frame-important set listed in the manifest/doc.

## Proof
- Fixture: packages/test-fixtures/worlds/*.wld
- Test command: `bash scripts/verify.sh`
```

```markdown
## Goal
M1 accepts worlds from every 1.4.5.x build, not only 1.4.5.8.

## Scope
- Generate one vanilla fixture per format version 315–325 that has a release, compare header/section layout,
  widen the supported range in docs/file-format.md.

## Out of scope
- Versions before 315; codec changes beyond the range check.

## Ownership
- docs/file-format.md (Versions), packages/test-fixtures/

## Compatibility impact
- Vanilla: Render
- Modded worlds: None

## Acceptance criteria
- Each newly supported version has a fixture and a manifest entry; the version table is updated.

## Proof
- Test command: `bash scripts/verify.sh`
```

```markdown
## Goal
The reference .NET codec reads world metadata (name, seed, GUID, id, dimensions, mode, evil) of a 1.4.5.8 world.

## Scope
- Reader for section 1 exactly as in docs/file-format.md ("World metadata"), including all consumed fields,
  ending exactly at pointer[1].
- Result: metadata record or MalformedMetadata { field, offset, reason }.

## Out of scope
- Tiles, other sections, writer, versions other than 326.

## Ownership
- dotnet/Terraria.WorldCodec/, dotnet/Terraria.WorldCodec.Tests/

## Compatibility impact
- Vanilla: Render (metadata only)
- Modded worlds: None

## Acceptance criteria
- Vectors M1–M5 from docs/file-format.md give the documented results.
- All four M1 fixtures give name, seed, dimensions and mode from the manifest; evil matches the tiles
  (the world named "SCCR1" in game is the corruption fixture `SCCO1.wld`).
- Width/height ≤ 0 and the safety limits are rejected.

## Proof
- Fixture: packages/test-fixtures/worlds/*.wld
- Test command: `bash scripts/verify.sh`
```

```markdown
## Goal
The reference .NET codec decodes the tile section of a 1.4.5.8 world into Tile/ContentRef values.

## Scope
- Tile reader exactly as in docs/file-format.md ("Tile data", "Model mapping"), including the additive
  fields (shape, inactive, wallPaint, invisible/full-bright flags) as .NET tile properties.
- Error MalformedTiles { x, y, offset, reason }.

## Out of scope
- Writer, run-length encoding on save, sections 3–10, mod registry.

## Ownership
- dotnet/Terraria.WorldCodec/, dotnet/Terraria.WorldCodec.Tests/

## Compatibility impact
- Vanilla: Render
- Modded worlds: None

## Acceptance criteria
- Vectors T1–T17 and R1–R10 from docs/file-format.md give the documented results.
- All four M1 fixtures decode and stop exactly at pointer[2].
- Ids above 753 (blocks) / 366 (walls) map to unknown { runtimeId }.

## Proof
- Fixture: packages/test-fixtures/worlds/*.wld
- Test command: `bash scripts/verify.sh`
```

```markdown
## Goal
The TS world model can represent every vanilla tile flag that the codec reads, so nothing is lost.

## Scope
- Add the optional fields shape, inactive, wallPaint, invisibleBlock, invisibleWall, fullBrightBlock,
  fullBrightWall to `Tile` in packages/world-model, as listed in docs/file-format.md ("Model mapping");
  update docs/architecture.md's model snippet.

## Out of scope
- TS codec, renderer.

## Ownership
- packages/world-model/, docs/architecture.md (World model section)

## Compatibility impact
- Vanilla: None (model only)
- Modded worlds: None

## Acceptance criteria
- A Tile with all additive fields type-checks; a Tile without them still type-checks (fields optional).

## Proof
- Test command: `bash scripts/verify.sh`
```

```markdown
**Status:** done — evil labels and the manifest↔file check (open question 5), and the classic crimson fixture
`SCCR2.wld`.

## Goal
The M1 fixture corpus labels each world's evil biome correctly and includes a crimson world in classic mode.

## Scope
- Fix SCCR1's `evil` in manifest.json to `corruption` (and rename if the naming key requires it), or regenerate
  a classic crimson world; record which.
- A fixture check that compares the manifest `evil` with the metadata crimson flag.

## Out of scope
- Codec changes.

## Ownership
- packages/test-fixtures/, scripts/check-fixtures.mjs

## Compatibility impact
- Vanilla: None
- Modded worlds: None

## Acceptance criteria
- For every fixture the manifest `evil` equals the crimson flag at metadata row 22 (docs/file-format.md).

## Proof
- Fixture: packages/test-fixtures/worlds/*.wld
- Test command: `bash scripts/verify.sh`
```

Follow-ups from the writer contract (#32). The writer, envelope, backup and in-game check themselves are
already planned as #38–#41, #44 and #45; these cover what the contract leaves open.

```markdown
## Goal
The corpus shows how Terraria 1.4.5.8 itself saves the tiles the writer contract treats specially.

## Scope
- A human generates one Small vanilla world in 1.4.5.8 and places, then saves in game: a vertical stack of
  food platters (520) and of logic sensors (423), an ice-rod block (127), a block and a wall with paint 31,
  and a block with illuminant coating; adds it to the manifest with the next sequence number.
- Record in docs/file-format.md (open questions 10 and 11) whether the game merged the 520/423 stacks into
  runs, kept block 127, and how paint 31 / the coating were stored.

## Out of scope
- Codec changes (a needed change becomes its own issue).

## Ownership
- packages/test-fixtures/, docs/file-format.md (Open questions, Writer contract evidence)

## Compatibility impact
- Vanilla: None (evidence only)
- Modded worlds: None

## Acceptance criteria
- The new fixture passes scripts/check-fixtures.mjs and decodes with the M1 rules.
- docs/file-format.md states, with offsets in the new fixture, how each of the listed tiles is stored.

## Proof
- Fixture: packages/test-fixtures/worlds/<new>.wld
- Test command: `bash scripts/verify.sh`
- Manual test: in-game placement as listed in Scope
```

```markdown
## Goal
Every view of a tile agrees with the writer about "no paint", so round-trip comparisons need no special case.

## Scope
- Decide (and implement in .NET) whether a present paint / wall-paint byte 0 is read as absent in the `Tile`
  view and the export-json region output, as CWM already does (docs/file-format.md open question 14).

## Out of scope
- CWM layout and digests (unchanged either way), the writer.

## Ownership
- dotnet/Terraria.WorldCodec/ (tile view), dotnet/Terraria.WorldCodec.Tests/, docs/file-format.md (Model mapping)

## Compatibility impact
- Vanilla: Render (view only)
- Modded worlds: None

## Acceptance criteria
- Reading `03 01 08 01 00` gives the same `Tile` as reading `02 01`; golden summaries are unchanged.

## Proof
- Test command: `bash scripts/verify.sh`
```
