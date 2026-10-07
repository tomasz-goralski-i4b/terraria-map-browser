# Terraria texture assets (XNB / LZX / sprite layout)

How Terraria 1.4.5.8 stores tile and wall sprites, written so that the .NET reference renderer and the TS editor
can read them from the user's **local** installation. No game file, extracted image or render is part of this
repository; everything below is either a restated contract from a cited source or was checked against a local
install (file counts and header bytes only).

Nothing here is copied from the cited projects: their code was read, and the behaviour is restated in our own
words.

## Sources

| Id | Source | Revision | What it is used for |
|---|---|---|---|
| A1 | [MonoGame](https://github.com/MonoGame/MonoGame) `MonoGame.Framework/Content/ContentManager.cs` | `55b5621b` (develop) | XNB header: lines 494–531 |
| A2 | MonoGame `MonoGame.Framework/Content/ContentTypeReaderManager.cs` | `55b5621b` | type-reader table: lines 141, 156, 230 |
| A3 | MonoGame `MonoGame.Framework/Content/ContentReader.cs` | `55b5621b` | shared resources and object header: lines 92–107, 252–262 |
| A4 | MonoGame `MonoGame.Framework/Content/ContentReaders/Texture2DReader.cs` | `55b5621b` | `Texture2D` payload: lines 25–28, 81–85 |
| A5 | MonoGame `MonoGame.Framework/Utilities/LzxStream/LzxDecoderStream.cs` | `55b5621b` | XNB chunk framing: lines 18, 33–66 |
| A6 | MonoGame `MonoGame.Framework/Content/LzxDecoder.cs` (C# port of libmspack `lzxd.c`) | `55b5621b` | LZX bitstream: window 60–103, header 146–155, block header 160–210, tree lengths 585–625, bit reader 649–700, constants 750–770 |
| A7 | [libmspack](https://github.com/kyz/libmspack) `libmspack/mspack/lzxd.c` | `55d50197` | the original LZX decoder A6 was ported from (not read line by line in this spike) |
| A8 | [TEdit](https://github.com/TEdit/Terraria-Map-Editor) `src/TEdit/View/WorldRenderXna.xaml.cs` | `99928583` | wall source rectangle 4282–4297, frame-important tile source rectangle 4737 |
| A9 | TEdit `src/TEdit.Terraria/Render/WallFraming.cs` | `99928583` | wall framing (port of `Framing.WallFrame`, 1.4.5.4): variant patterns 15–29, table 40–80, neighbours 86–119, variant choice 135–153 |
| A10 | TEdit `src/TEdit/Render/BlendRules.cs` | `99928583` | block self-framing rules: 93–113 (diagonal-sensitive rules 109–112); cell notation 401–415 |
| A11 | TEdit `src/TEdit.Terraria/Objects/TileProperty.cs` | `99928583` | defaults `TextureGrid 16×16`, `FrameGap 2×2`: lines 95–96 |
| A12 | TEdit `src/TEdit.Terraria/Data/tiles.json` | `99928583` | per-tile `textureGrid`, `frameGap`, `frameSize`, `isFramed`, `isAnimated` (754 entries, ids 0–753); dirt line 3, torch 98, tree 256, chair 867, chest 3084 |
| A13 | TEdit `src/TEdit.Terraria/Render/TileFraming.cs` | `99928583` | 8-way framing for gemspark-like tiles: lines 6–36 |
| L | Local install: Steam app 105600, build id `24893155`, `changelog.txt` line 1 "Version 1.4.5.8" | checked 2026-10-07 | counts and header bytes only (see "Local install") |
| F | [docs/file-format/tiles.md](file-format/tiles.md) ("Record layout"), [vectors.md](file-format/vectors.md) (T6) | this repo | which tiles store `frameX`/`frameY` in the `.wld` |

Revisions are commit SHAs (first 8 hex digits) of the default branch on 2026-10-07; full SHAs: MonoGame
`55b5621bcea08cb5fd8d7769ecb1d27de2e4248f`, TEdit `99928583086ff1c0c970c5528c7d72c76da39a53`, libmspack
`55d501976171397ccd5d5a7a1ca7da065b1d9a06`.

## Local install

Checked on one Windows install of Terraria **1.4.5.8** (L). `Content/Images/` holds **14 015** `.xnb` files.

| Family | Files | Notes |
|---|---|---|
| `Tiles_<id>.xnb` | **754**, ids **0–753**, no gaps | equals the frame-important count `k = 754` written by 1.4.5 worlds ([header.md](file-format/header.md), "Hex examples") |
| `Wall_<id>.xnb` | **366**, ids **1–366**, no gaps | there is no `Wall_0` — wall id 0 means "no wall" |
| Tile variant sheets | `Tiles_5_0` … `Tiles_5_6`, `Tiles_2_Beach`, `Tiles_59_2`, `Tiles_199-gross`, `Tiles_59.bak` | not addressed by a tile id; deferred (see "Special handling") |
| Look-alikes that are **not** wall sheets | `Wall_Outline.xnb`, `WallOfFlesh.xnb` | a loader must match `Wall_<digits>.xnb` exactly |

**File-name case is not reliable:** tile 650 ships as `TIles_650.xnb` (capital `I`). Windows does not care; a
browser directory handle and a case-sensitive file system do. Loaders must look names up case-insensitively.

Header bytes checked (first 14 bytes, plus a walk over the chunk headers — no data was decompressed):

| File | Bytes 0–13 | File size | Decompressed size | Chunks (last one `0xFF`-framed) | First LZX block |
|---|---|---|---|---|---|
| `Tiles_0` | `58 4e 42 77 05 80 b8 13 00 00 b1 bf 04 00` | 5 048 | 311 217 | 10 | aligned, 311 217 bytes |
| `Tiles_5` | `58 4e 42 77 05 80 aa 6c 00 00 b1 b0 16 00` | 27 818 | 1 487 025 | 46 | aligned |
| `Tiles_21` | `58 4e 42 77 05 80 46 86 00 00 31 eb 0d 00` | 34 374 | 912 177 | 28 | aligned |
| `TIles_650` | `58 4e 42 77 05 80 2e 0f 00 00 b1 dd 01 00` | 3 886 | 122 289 | 4 | aligned |
| `Tiles_753` | `58 4e 42 77 05 80 78 05 00 00 61 89 00 00` | 1 400 | 35 169 | 2 | aligned |
| `Wall_1` | `58 4e 42 77 05 80 08 13 00 00 f1 24 05 00` | 4 872 | 337 137 | 11 | aligned |
| `Wall_366` | `58 4e 42 77 05 80 14 15 00 00 71 33 07 00` | 5 396 | 471 921 | 15 | aligned |

In all seven files: the size field equals the file length; the frame sizes of the chunks add up exactly to the
decompressed size; every chunk but the last is a plain 32 KiB frame; the Intel E8 bit is 0; the first block is
**aligned** and its 24-bit length equals the whole decompressed size; the last 5 bytes of the file are zero
(a `00 00` end marker followed by 3 zero bytes).

## XNB container

All integers are little-endian unless stated otherwise. Offsets are from the start of the file (A1).

| Offset | Size | Field | Terraria value | Rule |
|---|---|---|---|---|
| 0 | 3 | magic | `58 4e 42` ("XNB") | anything else → not an XNB |
| 3 | 1 | target platform | `77` ('w', Windows) | Terraria ships `w`. Readers accept `w`; other platforms (`m`, `x`, `a`, `i`, …) are out of scope |
| 4 | 1 | format version | `05` | XNA 4.0 = 5. Version 4 (XNA 3.1) is accepted by MonoGame but never seen here; we reject it |
| 5 | 1 | flags | `80` | bit `0x80` = LZX-compressed; bit `0x40` = LZ4 (MonoGame extension, never seen); bit `0x01` = HiDef profile (no effect on decoding). Any other bit → reject |
| 6 | 4 | file size | = file length | UInt32, the **whole** file including this header. Mismatch → reject |
| 10 | 4 | decompressed size | e.g. 311 217 | **only if** flag `0x80` (or `0x40`) is set. Size of the decompressed payload, *excluding* the 14-byte header |
| 10 or 14 | … | payload | | LZX stream of `file size − 14` bytes when compressed; otherwise the raw payload (`file size − 10` bytes) |

### Payload (after decompression)

The payload is a content-reader stream (A2, A3). `7bit` is the .NET 7-bit variable-length integer
(`BinaryReader.Read7BitEncodedInt`: 7 bits per byte, low group first, high bit = "more"); a `string` is a
`7bit` byte length followed by UTF-8 bytes.

| Field | Type | Texture value |
|---|---|---|
| type-reader count | 7bit | 1 |
| per reader: type name | string | `Microsoft.Xna.Framework.Content.Texture2DReader, Microsoft.Xna.Framework.Graphics, Version=4.0.0.0, Culture=neutral, PublicKeyToken=842cf8be1de50553` (148 bytes) |
| per reader: version | Int32 | 0 |
| shared-resource count | 7bit | 0 |
| primary object: reader index | 7bit | 1 (1-based; 0 would mean null) |
| `Texture2D` (A4) | | see below |

Readers match the type name by its prefix up to the first `,` (`Microsoft.Xna.Framework.Content.Texture2DReader`)
and reject any other reader, a count ≠ 1, or a shared-resource count ≠ 0 — this is a texture loader, not a general
content pipeline.

`Texture2D` payload (A4, lines 25–28 and 81–85):

| Field | Type | Terraria |
|---|---|---|
| surface format | Int32 | 0 = `Color` (expected, see below) |
| width | Int32 | sheet width in pixels |
| height | Int32 | sheet height in pixels |
| mip level count | Int32 | 1 (expected) |
| per level: data length | Int32 | `width × height × 4` for `Color` |
| per level: data | bytes | rows top to bottom, pixels left to right, 4 bytes per pixel in the order R, G, B, A |

**Size arithmetic check (L).** The header overhead with exactly these values is 1 + 2 + 148 + 4 + 1 + 1 + 16 + 4 =
**177 bytes**. For every file checked, `decompressed size − 177` is divisible by 4, and it matches the expected
sheet sizes: `Tiles_0` → 311 040 = 288 × 270 × 4; `Wall_1` → 336 960 = 468 × 180 × 4. That is consistent with one
type reader, `SurfaceFormat.Color`, and one mip level, but it is an inference, not a decoded fact — the opt-in
integration test (below) confirms it. A reader must reject any other surface format (DXT formats exist in XNA but
are not expected here), mip count ≠ 1 (or ignore extra levels — decision for the implementation issue), a data length
≠ `w × h × 4`, and trailing bytes after the last level.

## LZX as used in XNB

### Chunk framing (A5, verified on L)

The compressed payload (bytes 14 … `file size − 1`) is a sequence of chunks. Each chunk carries the compressed
bytes of one **frame** of output:

| First byte | Header | Frame size (output bytes) | Block size (compressed bytes that follow) |
|---|---|---|---|
| `≠ 0xFF` | 2 bytes, `hi lo` | 32 768 | `hi·256 + lo` (**big-endian**) |
| `0xFF` | 5 bytes, `FF fh fl bh bl` | `fh·256 + fl` (big-endian) | `bh·256 + bl` (big-endian) |

- Frames are 32 768 bytes except the last, which uses the `0xFF` form with the remaining length (L: one such chunk,
  always the last).
- A chunk whose block size or frame size is 0 ends the stream. Terraria files end with `00 00` plus 3 zero bytes
  (L); the reader stops at the marker or when it has consumed `file size − 14` bytes, whichever comes first.
- After each chunk the reader jumps to the byte after the chunk's compressed bytes, whatever the bit reader still
  holds; the bit reader starts empty for every chunk. The LZX **state** (window, trees, repeated offsets, current
  block and its remaining length) carries over from chunk to chunk — a block may span many frames (L: the first
  block of `Tiles_0` spans all ten).
- Total frame sizes must equal the decompressed size from the header; a mismatch is an error.

### Bitstream

LZX (Forbes/Poutanen, adopted by Microsoft) as implemented by libmspack (A7) and its C# port (A6). Parameters
fixed by XNB:

- **Window size 2¹⁶ = 64 KiB** (A5 line 18). Position slots = `2 × 16 = 32`; main tree size =
  `256 + 32 × 8 = 512` symbols; length tree 249 symbols; aligned-offset tree 8 symbols; pretree 20 symbols
  (A6 lines 98–103, 750–770). Minimum match length 2, maximum 257.
- **Bit reader:** input is consumed as 16-bit little-endian words; bits are taken from each word most-significant
  first (A6 lines 667–700). A multi-bit field is read MSB first.
- **Stream header** (first chunk only): 1 bit Intel-E8 flag; if set, two 16-bit fields (high, low) give the E8
  translation size (A6 146–155). Terraria: always 0 (L). Our decoders implement the flag as **unsupported → error**
  unless a real file needs it.
- **Block header:** 3-bit block type, then the block's uncompressed length as 24 bits (read 16 + 8, A6 170–173).
  Types: 1 = verbatim, 2 = aligned offset, 3 = uncompressed; 0 and 4–7 are errors.
  - *Verbatim:* main-tree lengths for symbols 0–255, then for 256–511 (two separate pretree runs), then length-tree
    lengths for 0–248 (A6 184–194).
  - *Aligned:* first 8 × 3-bit aligned-tree lengths, then exactly as verbatim (A6 177–182).
  - *Uncompressed:* the bit reader is re-aligned to a 16-bit boundary — 1–16 padding bits; **if the header ends
    exactly on a word boundary, a whole 16-bit word of padding is still consumed** (A6 196–199). Then R0, R1, R2
    as three UInt32 little-endian (12 bytes), then the raw bytes. If the block length is odd, one padding byte
    follows the raw bytes before the next block header (A6 165–166).
- **Tree lengths are delta-coded and persistent** (A6 585–625). Each run first reads 20 × 4-bit pretree lengths.
  Then for each target length: pretree symbol `z`:
  - 0–16: `new = (old − z) mod 17`;
  - 17: `4 + read(4)` zeros; 18: `20 + read(5)` zeros;
  - 19: `n = 4 + read(1)`, then another pretree symbol `z'`; **one** value `v = (old_first − z') mod 17` is
    computed from the old length of the *first* position of the run only, and all `n` positions are set to `v`
    (A6 602–608). Example: old lengths `[8, 9, 10, 11]`, `n = 4`, `z' = 1` → `[7, 7, 7, 7]`, not `[7, 8, 9, 10]`.

  `old` is the length from the previous block (all zero at stream start). Main and length tree lengths are never
  reset between blocks or chunks.
- **Huffman codes** are canonical: shorter codes first, equal lengths ordered by symbol value; codes are read MSB
  first. An all-zero length table is legal (the tree is then unused); otherwise the code must be complete.
- **Symbols:** main symbol `< 256` = literal. Otherwise `m = sym − 256`: length header `m & 7` (7 → add a length-tree
  symbol), match length = header (+ footer) + 2; position slot `m >> 3`.
  - Slots 0, 1, 2 = repeated offsets R0, R1, R2 (using R1 or R2 swaps it with R0).
  - Slot 3 = offset 1. Slots ≥ 4: `offset = position_base[slot] − 2 + extra`, where `extra_bits` is 0,0,0,0,1,1,2,2,…
    up to 17 and `position_base` its running sum (A6 76–95).
  - **Every slot ≥ 3 — slot 3 included — pushes its offset to the front of the queue:**
    `(R0, R1, R2) ← (offset, old R0, old R1)`, in verbatim and aligned blocks alike (A6 265–280). Example: from
    `(4, 1, 1)`, a slot-3 match gives `(1, 4, 1)`, so a following slot-1 match copies from offset 4.
  - In aligned blocks, a slot with `extra_bits ≥ 3` reads `extra_bits − 3` verbatim bits, shifts them left by 3 and
    adds one aligned-tree symbol; with exactly 3 it uses the aligned symbol alone; with 1–2 it reads verbatim bits
  as in a verbatim block (A6 362–395).
- R0 = R1 = R2 = 1 at stream start (A6 102). Matches copy from the circular window and may overlap their own
  output; a match may not run past the end of the current frame.

Further reading (not used for any claim above, check its license before reading): Microsoft's open specification
`[MS-PATCH]` (LZX DELTA) describes the same bitstream family.

## Sprite layout

### Blocks (`Tiles_<id>`)

A tile sheet is a grid of **cells**. The default cell is 16 × 16 pixels with a 2-pixel gutter to the right and below,
i.e. a **stride of 18** (A11, A12: 702 of 754 tiles). **`frameX`/`frameY` are already pixel offsets into the sheet,
gutter included** — they are not cell indices. The source rectangle is:

```text
source = (x = frameX, y = frameY, w = gridW, h = gridH)   // gridW×gridH = the tile's textureGrid (default 16×16)
```

(A8 line 4737). The gutter only matters when converting a cell index to `frameX`/`frameY`
(`frameX = column × (gridW + gapX)`). Per-tile values (A12): textureGrid 16×16 for 702 ids, others 20×20 (17, e.g.
torches 4, trees 5, palm trees 323), 16×20 (16, e.g. short plants 3), 16×18, 16×32, 20×16, 20×18, 24×34, 18×18,
24×26, 32×38, 16×15, 26×18; gap 2×2 for 748 ids, 2×4 (chairs 15, rockets 216, toilets 497), 2×3 (sinks 172),
0×0 (751, 752). A cell larger than 16×16 is drawn overlapping its neighbours; the exact draw offset per tile id is an
open question (deferred).

Where `frameX`/`frameY` come from:

- **Frame-important tile ids** — read from the `.wld` record (F, "Record layout"). The renderer uses them as stored.
- **Other blocks** — the `.wld` stores **no** frame; Terraria recomputes it on load from the neighbours
  ("self-framing"). The renderer has to do the same (A10). The base rule set picks one of 16 neighbour cases from the
  four direct neighbours of the same type, then one of three variants. Cell names in A10 are `<row letter><1-based
  column>`, so `B2`–`B4` = cells (1,1), (2,1), (3,1) → `frameX/frameY` (18,18), (36,18), (54,18).
- **Diagonal rules (deferred).** When all four direct neighbours are the same type, A10 (lines 109–112) first tries
  four higher-priority rules that also look at the diagonals: top-left and bottom-left missing → `A11`–`C11`;
  top-right and bottom-right missing → `A12`–`C12`; both top diagonals missing → `B7`–`B9`; both bottom diagonals
  missing → `C7`–`C9`. Only if none matches does `B2`–`B4` apply. **M4 ignores these rules** and always uses
  `B2`–`B4` for the four-neighbour case; worked example 1 therefore states all eight neighbours, so that it matches
  the source as well.

### Walls (`Wall_<id>`)

A wall cell is **32 × 32** with a 4-pixel gutter, **stride 36** (A8 4294–4295, A9 45). The `.wld` stores no wall
frame; it is computed from the four direct neighbours (A9 86–119):

1. `index` = N·1 + W·2 + E·4 + S·8, where a neighbour counts if it has a wall, or an active tile of a
   "truncates walls" type (A9 13: 54, 328, 459, 748). Tiles on the world border use cell (0,0).
2. If `index = 15`, add a centre sub-pattern chosen by `(x mod 3, y mod 3)` (A9 31–37; values 0–4).
3. A variant number picks a column of the table (A9 135–153):
   - **Ordinary walls** (`LargeFrameType = 0`): variant **0–2** only. Terraria picks it randomly when the wall is
     framed and the `.wld` does not store it; TEdit substitutes the deterministic `(7x + 11y) mod 3` (A9 150–153).
   - **Large-frame walls** (`LargeFrameType` 1 or 2, a per-wall property): variant **0–3**, taken from a fixed
     repeating pattern over `(x, y)` — 3 tiles wide × 4 high for type 1, 2 × 2 for type 2 (A9 15–29, 144–148).
     Only these walls use variant 3, whose cells lie in rows 5–6 (A9 60–79, fourth pair).
4. The (index, variant) table (A9 60–79) gives a cell `(column, row)`. For variants 0–2 every cell lies in rows 0–4,
   i.e. inside a 468 × 180 sheet.

**M4 rule:** ordinary walls use variant `(7x + 11y) mod 3` (the same substitute as TEdit, so the result is in 0–2
and never leaves rows 0–4); large-frame walls are deferred and drawn with the same 0–2 rule until a follow-up adds
their patterns and confirms their sheets have rows 5–6.

```text
source = (x = 36 × column, y = 36 × row, w = 32, h = 32)
dest   = top-left at (16 × tileX − 8, 16 × tileY − 8)        // a 32×32 sprite centred on the 16×16 tile
```

### Worked examples

| # | Case | Input | Source rectangle (x, y, w, h) | Basis |
|---|---|---|---|---|
| 1 | Dirt, `Tiles_0` (not frame-important), dirt on all eight neighbours (four sides and four diagonals), variant 0 | computed frame (18, 18) | **(18, 18, 16, 16)** → pixels 18–33 × 18–33 | A10 rule `B2`–`B4` (no diagonal rule matches), stride 18 |
| 2 | Dirt, only a right-hand neighbour, variant 0 | computed frame (162, 0) | **(162, 0, 16, 16)** | A10 rule `A10`–`C10`: column 9 × 18 = 162 |
| 3 | Torch, `Tiles_4` (frame-important, grid 20×20, gap 2) | `.wld` vector T6: `frameX 0, frameY 66` | **(0, 66, 20, 20)** — style row 66 / 22 = 3 | F (T6), A12 line 98 |
| 4 | Chest, `Tiles_21` (frame-important 2×2 object, grid 16, gap 2), style `s`, part `(dx, dy)` | `frameX = 36s + 18dx`, `frameY = 18dy` | style 1, bottom-right: **(54, 18, 16, 16)** | A12 line 3084 (`frameSize 2×2`) |
| 5 | Stone wall, `Wall_1`, no wall neighbours, variant 0 | index 0 → cell (9, 3) | **(324, 108, 32, 32)** | A9 line 60 |
| 6 | Wall with all four neighbours at `x mod 3 = 0`, `y mod 3 = 1` (centre sub-pattern 0), variant 0 | index 15 → cell (1, 1) | **(36, 36, 32, 32)** | A9 lines 34, 75 |

Expected sheet sizes (consistent with the size arithmetic, confirmed only by the opt-in test): `Tiles_0`
288 × 270 = 16 × 15 cells of 18; `Wall_1` 468 × 180 = 13 × 5 cells of 36.

### Special handling — what M4 covers

| Case | M4 | Deferred |
|---|---|---|
| Frame-important tiles with a 16×16 grid (most furniture, multi-tile objects) | draw each tile's own cell at `(frameX, frameY)`; multi-tile objects need nothing extra because every tile carries its own frame | — |
| Frame-important tiles with other grids (torches, plants, …) | draw with the tile's `textureGrid` size | exact per-id draw offsets |
| Non-frame-important blocks | base self-framing (same-type neighbours, 16 cases × 3 variants, deterministic variant) | the four diagonal-sensitive rules of the four-neighbour case (A10 109–112), blending with dirt/stone/other types, grass rules, slopes and half bricks (block style), 8-way framing for gemspark-like tiles (A13) |
| Walls | 4-neighbour framing with the table above, variant `(7x + 11y) mod 3` (0–2, rows 0–4 only) | Terraria's random variant, the variant patterns of `LargeFrameType` 1/2 walls (variant 3, rows 5–6) |
| Animated tiles (173 ids flagged `isAnimated` in A12, all frame-important) | draw the stored frame (static) | animation |
| Trees (5, 323, …), tree tops/branches, variant sheets (`Tiles_5_N`, `Tiles_2_Beach`, `Tiles_59_2`, …) | placeholder | yes |
| Paint, actuated/inactive tint, illumination, liquids, wires | — | yes |

## Tile framing

How a block whose frame is **not** stored in the `.wld` picks its cell in `Tiles_<id>`. This section refines the
"Other blocks" and "Diagonal rules" notes of "Sprite layout": it covers the diagonal rules, blending with a merge
partner (stone ↔ dirt), slopes, half blocks and the variant. Grass rules, gemspark 8-way framing and the 13
non-block self-framed ids (vines, beams, …) stay deferred (see "Not covered").

### Sources and evidence

| Id | Source | Revision | Used for |
|---|---|---|---|
| A8 | TEdit `src/TEdit/View/WorldRenderXna.xaml.cs` | `99928583` | block path 5709–5813: which tiles take it 5709, cobweb 5729–5735, stone family 5736–5746, merge test 5747–5766, back-check 5768–5783, merge-partner mask 5784–5795, grass 5796–5799, variant 5801, source rectangle 5813; half block and slope drawing 5899–5954 |
| A10 | TEdit `src/TEdit/Render/BlendRules.cs` | `99928583` | rule buckets: plain 93–112, merge-partner 120–148 and 168–179, grass 150–166 and 181–249; random variant 41 and 253–256; deterministic variant 258–264; bucket index 263; rule fields 370–375; cell names 401–415; matching 418–451; back-check table 44–67 |
| A13 | TEdit `src/TEdit.Terraria/Render/TileFraming.cs` | `99928583` | gemspark ids 15–16; open faces per block shape 43–51; variant choice 277–289 (large-frame patterns 18–32) |
| A14 | TEdit `src/TEdit.Terraria/Objects/TileProperty.cs` | `99928583` | `Merges` 162–178; `HasSlopes` 108 |
| A12 | TEdit `src/TEdit.Terraria/Data/tiles.json` | `99928583` | per-id `isFramed`, `canBlend`, `isStone`, `isGrass`, `mergeWith`, `largeFrameType`; dirt line 3, stone 14, grass 27, cobweb 4131, mud 4230, jungle grass 4242 |
| F | [header.md](file-format/header.md) (frame-important bitset), [tiles.md](file-format/tiles.md) ("Record layout", byte-2 bits 4–6 = block shape) | this repo | which ids are framed at runtime; the shape values 0–5 |
| S | **Sheet art**, local install L (1.4.5.8): `Tiles_0`, `Tiles_1`, `Tiles_7` decoded with `packages/assets` and inspected cell by cell, enlarged, outside the repository (nothing saved here) | checked 2026-10-07 | every cell marked "S" below was looked at and shows the outline/blend the rule promises |
| G | **In-game check** of a small generated world | **pending** — human steps H1–H5 below | — |

TEdit's rule list cites seancode's Terrafirma UV notes as its origin (A10 82–85); the page was not reachable as a
pinned revision and is not used as a source. Nothing below is taken from decompiled game code. The game itself has
not been observed yet: every rule is either "cited" (A-id) or additionally "S" (consistent with the art in the
game's own sheet); none is marked "G" until H1–H5 are done.

### Which tiles are framed at runtime

- **Frame-important ids** (header bitset, F) store `frameX`/`frameY`; they never take this path.
- All **other** ids are framed from their neighbours on load. In A12 that is **342** ids (`isFramed` absent):
  - **329** carry `canBlend` and take the block framer of this section (A8 5709) — dirt, stone, ores, sand,
    bricks, wood, … — except the two sub-families below;
  - **18 gemspark ids** use a separate 8-way framer (A13 15–16) — deferred;
  - **10 grass ids** (`isGrass`: 2, 23, 60, 70, 109, 199, 477, 492, 661, 662) use the block framer with extra
    grass rules (A10 150–249) — deferred;
  - **13 ids** without `canBlend` (cactus 80, vines, beams, columns, decorative cobweb 697, …) have their own
    framing — deferred.
- Every block sheet of this family is **16 columns × 15 rows** of 18-pixel cells, 288 × 270 (S: `Tiles_0`,
  `Tiles_1`, `Tiles_7`, `Tiles_57`, `Tiles_58`, `Tiles_59`, `Tiles_147`). Grass sheets are taller (`Tiles_60`
  288 × 396 = 22 rows, `Tiles_2` 288 × 1980 = 110 rows) — part of the deferred grass work.

Notation: `(c, r)` is a cell, column `c` and row `r`, both 0-based; the source rectangle is
`(18c, 18r, 16, 16)` (stride 18, see "Sprite layout"). A10 writes cells as `<row letter><1-based column>`, so A10's
`D10` is our `(9, 3)`. x grows to the right, y downwards; N/E/S/W are the edge neighbours, NE/NW/SE/SW the corners.

### Inputs: the 3 × 3 neighbourhood

For the centre tile `c` (type `t`) each of the 8 neighbours `n` is classified (A8 5729–5795, A14 162–178):

1. **Absent** — no active tile, or outside the world (A8 treats a missing neighbour as absent). Actuated tiles
   still count as present (A8 tests presence only).
2. **Connected** — the centre treats `n` as "more of itself":
   - `n` has the same type `t`; or
   - `t` is in the **stone family** (`isStone`, 33 ids: stone 1, ebonstone 25, pearlstone 117, crimstone 203, the
     gem stones 63–68, …) and `n` is in the stone family too (A8 5736–5746); or
   - `t` is **any other block** and `n` names `t` as its merge partner (dirt sees stone, sand, ores, bricks,
     … as connected, A8 5750–5757 with A14 173). TEdit also connects two tiles that name the *same* partner
     (copper ore ↔ iron ore, A14 175), and connects a tile to its own partner (copper ore → dirt, A14 174) — see
     open question O2.
   - Cobweb (51, partner "−1" in A12) connects to every present neighbour, edges only (A8 5729–5735).
3. **Merge partner** — `t` has a merge partner `p` (A12 `mergeWith`: **dirt (0)** for 119 ids, **mud (59)** for
   jungle and mushroom grass, **ash (57)** for hellstone 58) and `n` has type `p` (A8 5784–5795). Such a
   neighbour is shown as a *blend edge* (the partner's texture drawn into the centre's rim), not as a seam.
   For the stone family a dirt neighbour is a merge partner and **not** connected.
4. Anything else is treated like **absent** (the centre draws its outline towards it).

Example: stone next to dirt. From dirt's side, stone names dirt as partner → connected, so dirt draws no edge.
From stone's side, dirt is a merge partner → stone draws its dirt-blend rim. This matches the sheets (S): `Tiles_0`
has no stone-transition cells at all, `Tiles_1` has a full set of dirt-rimmed cells.

Write `Cn` for the set of connected neighbours and `Bn` for the merge-partner neighbours (both may include corners).

### Decision rules

The **edge part of `Cn`** (which of N/E/S/W are connected) selects one of 16 cases. Within a case, rules are tried
top to bottom; the first rule whose condition holds gives three cells `v0 / v1 / v2`, one per variant (next
section). Rules marked *partner* apply only when `t` has a merge partner; a tile without one (e.g. dirt) uses
only the unmarked rules. "`Bn` edges = X" means the merge-partner **edges** are exactly X (corners not compared).

**Plain cases** (A10 93–108; all 16 checked on `Tiles_0`, S):

| Connected edges | Cells v0 / v1 / v2 | Look |
|---|---|---|
| none | (9,3) (10,3) (11,3) | outlined all round |
| E | (9,0) (9,1) (9,2) | left end of a horizontal run |
| W | (12,0) (12,1) (12,2) | right end |
| N | (6,3) (7,3) (8,3) | bottom end of a vertical run |
| S | (6,0) (7,0) (8,0) | top end |
| E W | (6,4) (7,4) (8,4) | horizontal middle |
| N S | (5,0) (5,1) (5,2) | vertical middle |
| E S | (0,3) (2,3) (4,3) | top-left corner of a mass |
| W S | (1,3) (3,3) (5,3) | top-right corner |
| E N | (0,4) (2,4) (4,4) | bottom-left corner |
| W N | (1,4) (3,4) (5,4) | bottom-right corner |
| E W S | (1,0) (2,0) (3,0) | top surface |
| E W N | (1,2) (2,2) (3,2) | bottom surface |
| N S E | (0,0) (0,1) (0,2) | left surface |
| N S W | (4,0) (4,1) (4,2) | right surface |
| all four | see below | interior |

**All four edges connected** — the corners decide (A10 108–112; tried in this order, the first match wins;
checked on `Tiles_0`, S: the "missing" corners carry a small light notch):

1. SW and SE both not connected → (6,2) (7,2) (8,2)
2. NE and NW both not connected → (6,1) (7,1) (8,1)
3. NE and SE both not connected → (11,0) (11,1) (11,2)
4. NW and SW both not connected → (10,0) (10,1) (10,2)
5. otherwise → (1,1) (2,1) (3,1) (plain interior)

One missing corner alone does not change the frame. With all four corners missing rule 1 wins.

**Merge-partner rules** (A10 120–148 and 168–179). They are tried **before** the plain rule of the same case;
if none matches, the plain rule (and, for "all four", rules 1–5) applies. Cells checked on `Tiles_1`/`Tiles_7`
are marked S.

| Connected edges | `Bn` condition | Cells v0 / v1 / v2 | |
|---|---|---|---|
| none | edges = N E S W | (6,11) (7,11) (8,11) | S |
| none | edges = N S | (6,12) (6,13) (6,14) | S |
| none | edges = E W | (9,11) (10,11) (11,11) | |
| none | edges = S | (6,5) (6,6) (6,7) | S |
| none | edges = W | (0,13) (1,13) (2,13) | S |
| none | edges = N | (6,8) (6,9) (6,10) | |
| none | edges = E | (3,13) (4,13) (5,13) | S |
| E | edges = N W S | (12,5) (12,6) (12,7) | S |
| E | edges = W | (0,14) (1,14) (2,14) | |
| W | edges = N E S | (12,8) (12,9) (12,10) | |
| W | edges = E | (3,14) (4,14) (5,14) | |
| N | edges = E W S | (11,8) (11,9) (11,10) | |
| N | edges = S | (7,5) (7,6) (7,7) | |
| S | edges = N E W | (11,5) (11,6) (11,7) | |
| S | edges = N | (7,8) (7,9) (7,10) | |
| E W | edges = S | (13,0) (14,0) (15,0) | |
| E W | edges = N | (13,1) (14,1) (15,1) | S |
| E W | edges = N S | (8,10) (9,10) (10,10) | S |
| N S | edges = W | (13,3) (14,3) (15,3) | |
| N S | edges = E | (13,2) (14,2) (15,2) | S |
| N S | edges = E W | (10,7) (10,8) (10,9) | |
| E N | edges = W S | (2,6) (2,8) (2,10) | S |
| E N | edges = S | (4,5) (4,6) (4,7) | S |
| E N | edges = W | (0,12) (1,12) (2,12) | |
| W N | edges = E S | (3,6) (3,8) (3,10) | |
| W N | edges = S | (5,5) (5,6) (5,7) | |
| W N | edges = E | (3,12) (4,12) (5,12) | |
| E S | edges = N W | (2,5) (2,7) (2,9) | |
| E S | edges = W | (0,11) (1,11) (2,11) | |
| E S | edges = N | (4,8) (4,9) (4,10) | |
| W S | edges = N E | (3,5) (3,7) (3,9) | |
| W S | edges = N | (5,8) (5,9) (5,10) | |
| W S | edges = E | (3,11) (4,11) (5,11) | |
| E W N | edges = S | (8,5) (9,5) (10,5) | |
| E W S | edges = N | (8,6) (9,6) (10,6) | S |
| N S E | edges = W | (9,7) (9,8) (9,9) | S |
| N S W | edges = E | (8,7) (8,8) (8,9) | S |
| all four | SE corner is partner | (0,5) (0,7) (0,9) | S |
| all four | SW corner is partner | (1,5) (1,7) (1,9) | |
| all four | NW corner is partner | (1,6) (1,8) (1,10) | |
| all four | NE corner is partner | (0,6) (0,8) (0,10) | S |

Within one case the listed `Bn` conditions are mutually exclusive except "all four", which is tried in the order
shown (SE, SW, NW, NE). The order of the rows inside a case therefore only matters for "all four".

How the variant cells were derived: each A10 rule names a first and a last cell; v1 is the cell halfway between
them, rounded towards the last (A10 410–414). We list all three cells instead of the rule, so the table above is
ours; every value was recomputed from the two named cells and, where marked S, checked against the sheet art.

**Gaps.** A `Bn` edge set that is not listed for its case (e.g. stone with only dirt to the N and E and nothing
connected) falls back to the plain cell, which draws an outline where the game probably draws a dirt rim. The
sheet holds more blend cells than the rules reach (O3).

**Back-check** (A8 5768–5783, A10 44–67). TEdit runs a second pass: a connection from the centre to a neighbour
that is a merge relative (not the same type) is dropped when the neighbour's own chosen cell shows a closed edge
towards the centre. A10's 22 × 16 table records, per cell, which edges the cell leaves open. M4 does not need it:
with the recommended model (O2) a partner's cell always leaves its blend edge open. A later issue can derive the
open edges from the "Look" column above instead of copying A10's table.

### Variant

- **Inputs.** Ordinary blocks have three variants (`v0`–`v2`), each a different hand-drawn copy of the same shape.
  The `.wld` stores no frame for these tiles (F), so the variant is not stored either.
- **Game behaviour (cited, not yet observed).** TEdit's default rule lookup draws a random number 0–2 per tile
  (A10 41, 253–256), and TEdit's wall framer states that the game picks the variant at random when it frames a
  tile whose frame the `.wld` does not store (A9 150–153); only `largeFrameType` tiles follow a fixed pattern
  (A13 271–289). If so, the game itself changes variants on every reload and a
  viewer cannot reproduce the exact picture — H2 checks this.
- **Large-frame tiles** (`largeFrameType` 1 or 2 in A12: 24 ids, e.g. 273, 274, 284, 325, 357, 409, 618, 669–676)
  pick the variant from a fixed repeating pattern over `(x mod 3, y mod 4)` (type 1) or `(x mod 2, y mod 2)`
  (type 2) (A13 18–32, 281–285); a pattern value above 2 is clamped to 2 (A10 264). The pattern values are not
  restated here (O4); until then these ids use the default rule.
- **Recommended viewer behaviour:** `v = (7x + 11y) mod 3`, with `x`, `y` the tile's world coordinates — the same
  deterministic substitute TEdit uses (A13 288) and the one M4 already uses for walls. Deterministic, so renders
  are reproducible and testable; adjacent tiles rarely share a variant, which is the visual point of the
  variants. Never use `Math.random`.

### Slopes and half blocks

Block shape is byte-2 bits 4–6 of a tile record (F): 0 full, 1 half, 2–5 slopes. The names in F say which corner
is **cut away**; drawing them (A8 5909–5949) confirms that reading. Derived from that drawing code — each shape is
drawn as eight 2-pixel columns `i = 0…7` of the chosen cell:

| Shape | Cut corner | Column `i` draws | Full (solid) faces |
|---|---|---|---|
| 1 half | top half | cell rows 0–7, placed in tile rows 8–15 | S (W and E only half) |
| 2 top-right | NE | cell rows 0 … 15−2i, moved down by 2i | W, S |
| 3 top-left | NW | cell rows 0 … 2i+1, moved down by 14−2i | E, S |
| 4 bottom-right | SE | cell rows 2i … 15, placed at the top | W, N |
| 5 bottom-left | SW | cell rows 0 … 2i+1, placed at the top | E, N |

So a slope keeps the surface outline of its cell and slides it diagonally, column by column; it is not a plain
clip of the 16 × 16 cell. The half block uses only the upper half of the cell.

**Which cell a shaped tile uses.** TEdit's block framer (A8 5709–5813) ignores shapes completely: the cell is
chosen from the 3 × 3 neighbourhood exactly as for a full block (the centre's own shape and its neighbours' shapes
play no role), and only the drawing changes. TEdit's newer 8-way framer for gemsparks (A13 137–269) is stricter:
a neighbour connects only if both facing faces are full (per a face table, A13 43–51), and a corner only if the two
edges next to it connect. A13's face table agrees with the column above for shapes 0–3 but not for 4 and 5
(A13 gives shape 4 the faces N and E, shape 5 the faces N and S, which contradicts its own drawing code) — O5.

**M4 rule:** choose the cell ignoring shapes (as A8), then draw by the shape table. Whether the game breaks a
connection across a sloped face for ordinary blocks is open (O5, H3).

### Worked examples

`#` = centre, `d` dirt, `s` stone, `.` empty. Variant 0 everywhere (e.g. tile at `x = 0, y = 0`); for another
variant take `v1`/`v2` from the same rule. Rows are N, middle, S.

| # | Centre | Neighbourhood | Case → rule | Cell | Source rectangle | Basis |
|---|---|---|---|---|---|---|
| 1 | dirt | `...` / `.#.` / `...` | none → plain | (9,3) | (162, 54, 16, 16) | A10 93, S |
| 2 | dirt | `...` / `.#d` / `...` | E → plain | (9,0) | (162, 0, 16, 16) | A10 94, S |
| 3 | dirt | `...` / `d#d` / `ddd` | E W S (top surface) | (1,0) | (18, 0, 16, 16) | A10 106, S |
| 4 | dirt | `...` / `.#d` / `.dd` | E S (top-left corner) | (0,3) | (0, 54, 16, 16) | A10 102, S |
| 5 | dirt | `ddd` / `d#d` / `ddd` | all four, all corners → interior | (1,1) | (18, 18, 16, 16) | A10 108, S |
| 6 | dirt | `.d.` / `d#d` / `ddd` | all four, NE and NW missing | (6,1) | (108, 18, 16, 16) | A10 111, S |
| 7 | dirt | `.d.` / `d#d` / `.d.` | all four, all corners missing → rule 1 wins | (6,2) | (108, 36, 16, 16) | A10 112, S |
| 8 | dirt | `ddd` / `d#s` / `ddd` | stone names dirt as partner → E connected → interior | (1,1) | (18, 18, 16, 16) | A8 5750, A14 173, S (`Tiles_0` has no stone edges) |
| 9 | stone | `sss` / `s#d` / `sss` | N S W, `Bn` edges = E (dirt to the right) | (8,7) | (144, 126, 16, 16) | A10 148, S |
| 10 | stone | `ddd` / `d#d` / `ddd` | none, `Bn` edges = N E S W (stone pocket in dirt) | (6,11) | (108, 198, 16, 16) | A10 126, S |
| 11 | stone | `.d.` / `s#s` / `...` | E W, `Bn` edges = N (dirt above, air below) | (13,1) | (234, 18, 16, 16) | A10 171, S |
| 12 | stone | `sss` / `s#s` / `ssd` | all four, SE corner is dirt | (0,5) | (0, 90, 16, 16) | A10 179, S |
| 13 | stone | `ss.` / `d#s` / `dd.` | E N, `Bn` edges = W S | (2,6) | (36, 108, 16, 16) | A10 131, S |
| 14 | dirt, shape 2 (top-right cut) | `...` / `d#.` / `dd.` | W S (shape ignored) | (1,3) | (18, 54, 16, 16), drawn column by column per shape 2 | A10 105, A8 5909–5918 |
| 15 | dirt, shape 1 (half) | `...` / `d#d` / `...` | E W | (6,4) | (108, 72, 16, 8) drawn into tile rows 8–15 | A10 98, A8 5903–5907 |

Example 8 shows the asymmetry of merging: the same dirt/stone pair gives dirt a seamless interior and stone a dirt
rim (example 9 from the other side). Examples 6 and 7 are the inner corners where two empty diagonals meet a
solid mass.

### Human steps (in-game check, G)

A small world made with our own generator or a fresh "small" world, nothing committed. Screenshots go to
`local-renders/` (gitignored).

- **H1** Build the 15 worked examples in a flat dirt/stone area (Journey mode, 1:1 zoom, lighting full), save,
  read the tiles with `Terraria.WorldInspector`, screenshot, and compare each centre tile with the listed cell.
- **H2** Save and reload the world twice; note whether the dirt/stone variants of the same tiles change (random
  per load) or stay (seeded).
- **H3** Hammer a dirt block into each of the shapes 1–5 inside a dirt mass; check whether its full neighbours
  draw an outline towards the cut faces (O5) and that the shape value read by the inspector matches the "Cut
  corner" column.
- **H4** Place copper ore fully surrounded by dirt, and copper next to iron ore; check whether the ore draws a full
  dirt rim (cell (6,11)) and whether the two ores show a seam (O2).
- **H5** Stone with dirt only to the N and E and air elsewhere: record what the game draws (O3).

### Not covered (deferred)

Grass rules (A10 150–249, the relaxed corner matching A10 454–505 and the taller grass sheets), gemspark 8-way
framing (A13), the back-check, the large-frame patterns, cactus/vines/beams/columns, modded tiles, walls (already
in "Walls"), tile animation, paint and lighting.

### Open questions

- **O1** Does the game re-roll the variant on every load (H2)? The recommendation stands either way.
- **O2** Merge relatives. TEdit connects a dirt-merging tile to dirt and to every other dirt-merging tile; only the
  stone family keeps dirt as a pure blend partner. The ore sheets carry the same full dirt-rim cells as stone
  (S: `Tiles_7` (6,11) and (8,7) show dirt rims), which only appear if dirt is a *partner*, not a connection, for
  ores too. **Recommended:** treat every tile with a partner like the stone family — connected = same type (or
  same stone family), partner = its `mergeWith` type — and let only the partner itself (dirt) see its relatives
  as connected. Confirm with H4 before relying on it for ore ↔ ore seams.
- **O3** Unlisted `Bn` edge combinations fall back to a plain outline (H5); the sheets contain blend cells that
  no listed rule reaches.
- **O4** Large-frame variant patterns (24 ids): restate the patterns from an independent observation (H-step in
  the follow-up) rather than from A13.
- **O5** Slopes: do full neighbours of a sloped tile keep their connection (A8) or break it at a cut face (A13
  style)? And A13's face entries for shapes 4 and 5 disagree with the drawing code.

Proposed follow-up issues: [planning/tile-framing-follow-ups.md](planning/tile-framing-follow-ups.md).

## License review of existing decoders

The repository is public; it has no `LICENSE` file yet (open question 1). "Read" = may be read to understand the
format, never copied; "Depend" = may be a build or runtime dependency.

| Candidate | Language | License | Read | Depend | Reason |
|---|---|---|---|---|---|
| MonoGame `LzxDecoder.cs` (A6) | C# | dual **LGPL-2.1 / Ms-PL**, user's choice ([file header, lines 1–34](https://github.com/MonoGame/MonoGame/blob/55b5621b/MonoGame.Framework/Content/LzxDecoder.cs#L1-L34)) | yes | **no** | Ms-PL would allow it, but the code is internal to `MonoGame.Framework` (needs a graphics device for `Texture2D`) — far too heavy for a codec |
| MonoGame `LzxDecoderStream.cs` (A5) | C# | **Ms-PL** — the header ([lines 1–3](https://github.com/MonoGame/MonoGame/blob/55b5621b/MonoGame.Framework/Utilities/LzxStream/LzxDecoderStream.cs#L1-L3)) refers to the repository's [`LICENSE.txt`](https://github.com/MonoGame/MonoGame/blob/55b5621b/LICENSE.txt) | yes | no | same |
| MonoGame content readers (A1–A4) | C# | **Ms-PL** ([`LICENSE.txt`](https://github.com/MonoGame/MonoGame/blob/55b5621b/LICENSE.txt)) | yes | no | same |
| [FNA](https://github.com/FNA-XNA/FNA) (`24031e5b`) | C# | framework **Ms-PL** ([`licenses/LICENSE`](https://github.com/FNA-XNA/FNA/blob/24031e5b/licenses/LICENSE)); its LZX decoder dual **LGPL-2.1 / Ms-PL**, user's choice ([`licenses/lzxdecoder.LICENSE`](https://github.com/FNA-XNA/FNA/blob/24031e5b/licenses/lzxdecoder.LICENSE)) | yes | no | same lineage as MonoGame; whole framework |
| libmspack `lzxd.c` (A7) | C | **LGPL-2.1** | yes | no | the canonical decoder, but native — unusable in the browser and an unwanted native dependency in .NET |
| [xnb-js](https://github.com/Lybell-Art/xnb-js) (`2e533abf`) | JS | **LGPL-3.0** | readme only | no | LGPL in a bundled PWA adds relinking obligations; we would also lose control of error reporting |
| [xnbcli](https://github.com/LeonBlade/xnbcli) (`499929e4`) | JS (Node) | **GPL-3.0** | **no** | no | copyleft; do not read the code to keep our implementation clearly independent |
| TEdit (A8–A13) | C# | Ms-PL | yes | no | already a cited source for the `.wld` format; its texture loading goes through XNA |
| tModLoader | C# | MIT | yes (M7) | no | mod assets are M7 |

**Recommendation:** write both decoders (.NET and TS) **from this document**, with no dependency. The format subset
is small (one platform, one version, one reader, one surface format, 64 KiB LZX window, no E8), the two codecs must
report the same errors, and every candidate library either drags in a framework or brings a copyleft license. The
.NET implementation is the reference; the TS one is independent (ADR 0001).

## Atlas

`buildSpriteAtlas(contentDir)` (`packages/assets`) decodes every `Images/Tiles_<id>.xnb` and `Images/Wall_<id>.xnb`
once (names matched case-insensitively; `Wall_Outline`, `Tiles_<id>_<n>` variants and everything else are ignored)
and packs them into square RGBA pages, 4096 × 4096 by default. It runs in a Worker (`atlas-worker.ts`) and never
touches the network; the Worker reports the number of `fetch` calls it saw (always 0).

- **Packing:** shelf packing, tallest sheet first, with 2 transparent pixels of padding around every sheet so
  sampling never bleeds into a neighbour. A sheet that does not fit an empty page (including padding) is rejected with
  `AtlasSheetTooLargeError`.
- **Index:** `(kind, id) → { page, x, y, width, height, frameWidth, frameHeight, gapX, gapY }`: the per-sheet frame and gutter
  of "Sprite layout" (default tiles 16×16 / 2, walls 32×32 / 4; the 56 tile ids whose grid or gutter differs from the default — e.g. tile 4
  20×20, tile 3 and 24 16×20, tile 15 gutter 2×4, tiles 751/752 18×18 with no gutter — carry their own values, restated from A12's
  per-id `textureGrid`/`frameGap`; all others the default), the family defaults, the page size, padding and `ATLAS_FORMAT_VERSION`.
- **Cache:** the origin private file system, one directory per fingerprint holding `page-<n>.rgba` (raw RGBA) and
  `index.json`, written last so an entry without it is never read. The fingerprint hashes the name, size and
  last-modified time of every matched sheet plus the format version; storing a new entry removes the old ones. A build
  with an unchanged fingerprint decodes no `.xnb`; any changed, added or removed sheet rebuilds.
- **Progress and cancellation:** `scan`, `decode` (one event per sheet), `pack` and `store` events; aborting (also during the cache
  write) rejects with an `AbortError` and removes the uncommitted entry, so no partial cache entry exists.
- **Missing sheets:** an undecodable file or unreadable file is listed in `missing` (name and reason) and the rest is built. The report is stored with the cache
  entry (`missing.json`) and restored on a cache hit. A scan that could not read every matched file is never cached.

## Test strategy (no game files)

### Synthetic XNB files

Both codecs build their inputs in test code (the .NET side in `Terraria.WorldCodec.Synthetic` or a sibling assets
project); nothing is derived from game files.

1. **Uncompressed XNB** (flags `0x00`): `XNB` `w` `05` `00`, UInt32 file size, then the payload of "Payload" with a
   small texture (e.g. 2 × 3, distinct RGBA bytes per pixel). Covers header, reader table and `Texture2D` parsing
   without LZX.
2. **LZX, uncompressed blocks** (flags `0x80`): bits `0` (no E8), `011` (type 3), 24-bit length; 4 padding bits
   (28 header bits → next word boundary); R0–R2 = 1, 1, 1; the raw payload; a padding byte if the length is odd.
   Wrap in chunks: a 2-byte big-endian block size for full 32 KiB frames, `FF` + frame size + block size for the
   last; end with `00 00`. A payload larger than 32 768 bytes exercises multi-chunk framing.
3. **LZX, verbatim literal-only blocks:** main tree lengths 8 for symbols 0–255 and 0 for 256–511; length tree all
   0. Delta coding from all-zero: length 8 is pretree symbol `(0 − 8) mod 17 = 9`; zeros are symbol 0 or runs with
   symbol 18. Give the pretree two symbols of length 1 (e.g. 9 and 18; 0 and 18) so every pretree is complete.
   With 256 literals of length 8 the canonical code of a literal is the byte itself, so the block body is the
   payload written MSB first into 16-bit little-endian words. This exercises tree reading, delta coding and the bit
   reader without writing an LZX compressor.
4. **Hand-assembled verbatim blocks for the two easy-to-miss rules** (no compressor needed, bits written by the
   test builder):
   - *Repeated-offset queue:* an uncompressed block that sets R0–R2 = 4, 1, 1, followed by a verbatim block whose
     main tree is complete with two match symbols (length header 0): literals 0–253 get length 8; literals 254 and
     255 and the match symbols 264 (256 + 8, slot 1) and 280 (256 + 24, slot 3) get length 9; every other length is
     0. Capacity: 254/256 + 4/512 = 1. (Giving all 256 literals length 8 already fills the tree, so any added match
     symbol would oversubscribe it.) Canonical codes: bytes 0–253 keep their own value as 8-bit codes; 254, 255, 264
     and 280 get the 9-bit codes 508–511, so payload literals 254/255 must use those. Body: some literals, a slot-3
     match (offset 1), then a slot-1 match; the expected output copies from offset 4. A decoder that does not push
     slot 3 onto the queue copies from offset 1 and fails.
   - *Pretree symbol 19 over changing old lengths:* two consecutive verbatim blocks; the first leaves four
     consecutive main-tree lengths at different values (e.g. 8, 9, 10, 11), the second updates them with one
     symbol-19 run (`n = 4`, `z' = 1`). Assert the resulting lengths are all 7 (directly on the tree reader, or via
     a payload whose decoding only succeeds with those lengths).
5. **Aligned blocks and general matches** are only covered by the opt-in integration test (L uses aligned blocks
   exclusively) unless a later issue adds a minimal encoder.
6. **Negative vectors:** bad magic, platform ≠ `w`, version ≠ 5, unknown flag bit, file-size mismatch, truncated
   header, truncated chunk, block type 0 or 4–7, E8 flag set, frame total ≠ decompressed size, wrong reader name,
   surface format ≠ 0, data length ≠ `w × h × 4`, trailing bytes. Each gets a precise error (names decided by the
   implementation issue; the two codecs must agree).

Synthetic `.xnb` files that both codecs share are generated (like the `.wld` fixtures) and small; committing them
needs a `.gitignore` rule `*.xnb` with an exception for the fixture directory (follow-up).

### Opt-in integration test: `TERRARIA_CONTENT`

- `TERRARIA_CONTENT` = path to a local `Terraria/Content` directory. **CI never sets it**; when unset the tests are
  skipped (xUnit v3 `Assert.SkipUnless` / vitest `describe.skipIf`), and the skip is visible in the output.
- Assertions only, no output files: every `Tiles_0…753` and `Wall_1…366` (case-insensitive names) decodes; header
  file size = file length; frame total = decompressed size; reader = `Texture2DReader`, format 0, one level, data
  length = `w × h × 4`; `Tiles_0` is 288 × 270 and `Wall_1` 468 × 180.
- Never write decoded pixels into the repository; renders made by hand go to `local-renders/` (gitignored).

## Open questions

1. The repository has no `LICENSE` file. The "Depend" column assumes we want to stay free of copyleft; a license
   decision would not change the recommendation.
2. Is Terraria's `Color` data premultiplied alpha (the XNA content pipeline default)? Affects blending, not decoding.
   Check visually in the opt-in test's manual follow-up.
3. Draw offsets for cells larger than 16 × 16 (torches 20 × 20, plants 16 × 20, …), per tile id.
4. Which walls use variant rows 5–6 of the wall table, given that `Wall_1` (468 × 180) has only rows 0–4.
5. Whether any file in a full install has the E8 flag set or uses a non-`0xFF` last chunk (L checked seven files;
   the opt-in test checks all).

Proposed follow-up issues: [planning/assets-follow-ups.md](planning/assets-follow-ups.md).
