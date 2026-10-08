# `.wld` format — File header and section table

Part of the format specification; index and conventions: [../file-format.md](../file-format.md).

## File header

All multi-byte integers are **little-endian**. Offsets are for format version 326.

The original M1 acceptance rules below remain the .NET contract. The TS viewer's independent
[compatibility PoC](compatibility.md) uses the same header layout for admitted released formats from 269
onward; its resolver replaces the `version == 326` check while preserving all other header checks.

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

The .NET `ReadSectionTable` entry point requires a readable, seekable stream positioned at byte 26.
`ReadMetadata` and `Read` also require readable, seekable streams. Invalid capabilities or an invalid
section-table position raise `ArgumentException` for `stream` before reading bytes or seeking.
Section-pointer errors retain `MalformedSectionTable` and the pointer-slot offset: pointers beyond `L`
report "beyond end of file", while decreasing or equal pointers after metadata report
"not greater than previous".

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
- Unused high bits of the last byte are 0 in every observed vanilla file (F: last byte `0x03`, only bits 752
  and 753), so the game writes them as 0. Readers ignore them. Our writer does **not** normalise them: it
  copies the bytes as read, so a source with nonzero padding keeps it on an unchanged save (W-H3).
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
