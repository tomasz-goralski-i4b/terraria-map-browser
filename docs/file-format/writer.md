# `.wld` format — Footer and writer contract (M2)

Part of the format specification; index and conventions: [../file-format.md](../file-format.md).

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
