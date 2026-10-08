# `.wld` format — Metadata and tile vectors

Part of the format specification; index and conventions: [../file-format.md](../file-format.md).

## Metadata and tile vectors

Machine-readable copies run by both codecs live in `contracts/vectors/` with schemas in `contracts/schemas/`
(see [contracts/README.md](../../contracts/README.md)).

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
- **Run-0 records (T1–T18):** the record alone is the whole tile section of a **1 × 1** world. A 1 × 1 world
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
  31 38` (seed "948580918"), `01 00 00 00 46 01 00 00` (world-gen version), 16 GUID bytes, `47 99 ea 67`
  (world id 1743427911), `00 00 00 00 80 06 01 00 00 00 00 00 00 4b 00 00` (bounds 0, 67200, 0, 19200),
  `b0 04 00 00` (height 1200), `68 10 00 00` (width 4200), `00 00 00 00` (classic).
- **M4. Bad Bool.** Any Bool byte `02` → `MalformedMetadata { reason "invalid boolean" }`.
- **M5. String overrun.** A name prefix `ff ff ff ff 0f` (2³²−1, too large) or a valid length reaching past
  `pointer[1]` → `MalformedMetadata { field "name" }`.

### Single records (one tile, `run = 0`)
Entry point **REC** for every row (T1–T18). Each byte string is one complete record at `x 0, y 0`: an
intentional fragment, not a 2 × 4 section. None of them is cut short. The error rows (T14–T17 and T18 `01 60`)
fail on the content of the record, and a decoder reports them before it needs any byte beyond the ones shown.

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
| T18 residual shape | `01 10` | shape `half` with no block, no wall, no liquid ([residual shapes](tiles.md#residual-shapes-are-vanilla-data)) |
|  | `01 60` | shape 6 without a block → `MalformedTiles { reason "undefined block shape" }` |

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
| T1–T18 | REC (one record) | yes: a single record |
| R1, R2, R4, R5, R7, R8 | REC (one record) | yes: a single record |
| R6 | REC (records from the start of column 0) | yes: a column prefix |
| R3, R10 | SEC (complete 2 × 4 section) | no: all 8 tiles are present |
| R9 | SEC (2 × 4 section, cut short on purpose) | no: the truncation is the subject of the vector |

Cross-check on F: every fixture's tile section starts with a column-0 record `40 e8` / `40 ea` / `40 e6`
(empty sky, UInt8 run of 232–234), followed by water records such as `08 7f` and `48 ff 63` — the same encodings
as T1, T7 and R3.
