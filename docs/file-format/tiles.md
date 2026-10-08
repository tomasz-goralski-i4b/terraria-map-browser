# `.wld` format — Tile data (section 2) and model mapping

Part of the format specification; index and conventions: [../file-format.md](../file-format.md).

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
| Paint flag without block, wall-paint flag without wall, wall-high flag without wall, block-id-width flag without block | `MalformedTiles { reason "flag without owner" }`. Never in F. TEdit ignores most of these but **does** consume the wall-high byte without a wall, so readers would otherwise disagree about the byte stream. | T15, F, our decision |
| Defined block shape 1–5 without an active block | Accepted and preserved. Shape bits do not add a payload; block absence still means empty foreground. The former vanilla owner check was incorrect. | T17; vanilla black-box observation below |
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

### Residual shapes are vanilla data

The original validation incorrectly inferred from the generated-world corpus that a non-zero shape required
an active block. Black-box observation on 2026-10-08 used the unmodified local TerrariaServer 1.4.5.8
(format 326): a synthetic tile was made active, given vanilla slope value 2, then made inactive with
`active(false)`. Its slope getter still returned 2. With a one-cell tile grid, the game's own
`SaveWorldTiles(BinaryWriter)` emitted `01 30`: no active block, stored shape 3. No game code was read and
no player world was modified. T17 independently describes shape emission outside the active-block payload.

The TS reader accepts defined residual shapes in every admitted modern format; the .NET reader and writer
preserve them in format 326. CWM retains the shape value even though an absent block has no foreground to
render. This is a correction to vanilla validation, not a tModLoader-specific exception. Undefined shapes
6–7 and the other malformed-record rules remain errors. This experiment proves the vanilla state and writer
can produce such records; it does not establish which operation produced them in any particular world.
The records do occur in practice: a local tModLoader 1.4.4.9 world (format 279, not in the repository)
contains 11,280 of them, for example flags `11 30` (lava, no block, shape 3).

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
The TS [`Tile` type](../../packages/world-model/src/index.ts) in `packages/world-model` defines these fields;
see [TypeScript model API](../cwm.md#typescript-model-api) for their CWM storage and semantic views.
With these fields, every bit and byte of a canonical record can be re-encoded; only the non-canonical forms listed
above (2-byte small ids, small Int16 runs, run 0, empty optional flag bytes) do not survive byte-for-byte —
their meaning does.

Not adopted from TEdit (editor behaviour, not format): resetting the frame y of timers on load, dropping the
shape of blocks that cannot be sloped (T15). Never run-compressing certain tile types on save (T16) **is**
adopted by the writer contract (see "Writer contract", rule W-T7).

## Sections skipped in M1

M1 reads sections 0–2 (header, metadata, tiles). Sections 3–10 (chests, signs, NPCs, tile entities, pressure
plates, town manager, bestiary, creative powers) and the footer are **not parsed** (their layout is specified in [entities.md](entities.md)): `WorldReader.Read` stops
after `pointer[2]`; their positions are known only from the section table. For saving, `WorldReader.ReadForSave`
(#38) additionally validates the footer, including its name/id cross-check with metadata rows 1 and 5
([writer.md](writer.md), "Footer (M2)"), and keeps sections 3–10 and the footer verbatim (W-S1, W-S5).
