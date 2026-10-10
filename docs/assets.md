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
| A11 | TEdit `src/TEdit.Terraria/Objects/TileProperty.cs` | `99928583` | defaults `TextureGrid 16×16`, `FrameGap 2×2`: lines 95–96 |
| A12 | TEdit `src/TEdit.Terraria/Data/tiles.json` | `99928583` | per-tile `textureGrid`, `frameGap`, `frameSize`, `isFramed`, `isAnimated` (754 entries, ids 0–753); dirt line 3, torch 98, tree 256, chair 867, chest 3084 |
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
| Tile variant sheets | `Tiles_5_0` … `Tiles_5_6`, `Tiles_2_Beach`, `Tiles_59_2`, `Tiles_199-gross`, `Tiles_59.bak` | not addressed by a tile id. `Tiles_5_N` is a pixel copy of block N + 1 of `Tiles_5` (`Tiles_5_6` differs from block 7 in 2 372 pixels), so trees need only `Tiles_5` ("Trees"); the others are deferred |
| Tree and wire sheets | `Tree_Tops_0` … `Tree_Tops_31`, `Tree_Branches_0` … `Tree_Branches_31`, `Shroom_Tops`, `WiresNew`, `Actuator` | not addressed by a tile id; in the atlas ("Trees", "Wires"). `Wires`, `Wires2`–`Wires4` (an older layout) are not used |
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
are not expected here), mip count ≠ 1 (`MalformedContent`, decided in #89), a data length
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
- **Other blocks** — the `.wld` stores **no** frame; Terraria computes it on load from the neighbours
  ("self-framing"), and the renderer has to do the same. "Tile framing" below gives the rules (neighbours, diagonal
  corners, merging, slopes, variants) and the framing database that holds the game's own result for every
  neighbourhood. For example a dirt block with dirt on all eight neighbours takes cell (1,1), (2,1) or (3,1) by its
  variant → `frameX/frameY` (18,18), (36,18), (54,18).

### Walls (`Wall_<id>`)

A wall cell is **32 × 32** with a 4-pixel gutter, **stride 36**: the frames the game writes are multiples of 36 (R).
The `.wld` stores no wall frame; the game computes it from the neighbours (R, [ADR 0003](adr/0003-observe-framing-in-the-game.md)):

1. **Neighbours.** Only the four side neighbours count; the diagonals never change the cell (R: 0 of the 6 561
   neighbourhoods of each of the 366 walls). A side neighbour counts when it has **any** wall (another wall type counts
   exactly like the same wall) or an active block of type 54, 328, 459 or 748.
2. **Interior.** A wall whose four sides all count takes its cell by position, repeating every 3 tiles in both
   directions. At variant 0, by `(x mod 3, y mod 3)`:

   | | x mod 3 = 0 | 1 | 2 |
   |---|---|---|---|
   | **y mod 3 = 0** | (6,2) | (1,1) | (1,1) |
   | **1** | (1,1) | (6,1) | (10,0) |
   | **2** | (1,1) | (11,0) | (1,1) |

3. **Variant.** Ordinary walls (344 of 366) take a random variant whenever they are framed, as blocks do; the cells of
   every variant are in rows 0–4. The viewer uses `(7x + 11y) mod 3` (chosen, as for blocks).
4. **Large-frame walls** (22) ignore the variant and take their cells by position, using row 5 as well: 146, 147,
   167, 179 and 354 repeat every **3 × 12** tiles; 185, 224, 274, 323–330, 355, 358, 359, 362, 363 and 366 every
   **6 × 6**.

The framing database holds every wall's cell for all 6 561 neighbourhoods, its interior cells at 12 × 12 positions
and its variant map, so these rules can be checked against it.

How the viewer applies them (#147; `packages/renderer/src/framing/frame-wall.ts`):

- A neighbour outside the world counts as absent (not observed: the observer frames walls inside a world only).
- The interior cell comes from the database's interior table at `(x mod 12, y mod 12)`, which covers both
  large-frame periods; ordinary walls then take their variant through the variant map. The map records the variants
  of the cells the 6 561-neighbourhood table uses, so of the interior cells only (6, 2) varies; the others keep their
  variant-0 cell, as an unobserved block variant does (chosen; observing every interior cell's variants is a
  follow-up).
- Large-frame walls take their non-interior cells from their 6 561-neighbourhood table, observed at the reference
  position (30, 30) only (chosen: the edges at other positions are not observed).
- Overlapping overhangs are drawn row by row from the top, left to right within a row, each over the ones before
  (chosen); blocks are drawn over walls.

```text
source = (x = 36 × column, y = 36 × row, w = 32, h = 32)
dest   = top-left at (16 × tileX − 8, 16 × tileY − 8)        // a 32×32 sprite centred on the 16×16 tile (A8)
```

### Frames past the sheet's edge

Some frame-important tiles store frames past their sheet's edge: they have more styles than fit one row of the sheet,
and the styles that do not fit continue at the sheet's start in a second block, further along the other axis. Measured
(S) in the art of L: the first block's styles end where its art ends (the period, rounded up to the next style), and
the second block starts where the art resumes along the other axis. Six local worlds store such frames for 87–89, 93,
101, 185 and 187, and every wrapped object assembled from its tiles looks whole (#147); the other rows rest on the art
alone. The sheets are a few pixels short of the period where the last gap is trimmed, or padded past it:

| Tile id | Content | Sheet | Wraps past | Second block |
|---|---|---|---|---|
| 14 | tables (3 × 2) | 1928 × 74 | x = 1890 | y + 38 |
| 15, 497 | chairs, toilets (1 × 2, 40-pixel rows) | 72 × 2038 | y = 2040 | x + 36 |
| 18 | work benches (2 × 1) | 2048 × 40 | x = 2016 | y + 20 |
| 34 | chandeliers (3 × 3, on and off) | 214 × 2000 | y = 1998 | x + 108 |
| 42 | lanterns (1 × 2, on and off) | 70 × 2016 | y = 2016 | x + 36 |
| 79, 90 | beds, bathtubs (4 × 2, both directions) | 286–288 × 2016–2048 | y = 2016 | x + 144 |
| 87, 88, 89 | pianos, dressers, sofas (3 × 2) | 1996–1998 × 72 | x = 1998 | y + 36 |
| 91 | banners (1 × 3, three blocks) | 1998 × 162 | x = 1998 | y + 54 |
| 93 | lamps (1 × 3, on and off) | 70 × 2048 | y = 1998 | x + 36 |
| 100, 139 | candelabras, music boxes (2 × 2) | 142–144 × 2016 | y = 2016 | x + 72 |
| 101 | bookcases (3 × 4) | 1996 × 142 | x = 1998 | y + 72 |
| 104 | clocks (2 × 5) | 2016 × 180 | x = 2016 | y + 90 |
| 105 | statues (2 × 3, both directions in bands below each other) | 1980 × 272 | x = 1980 | y + 54 |
| 172 | sinks (2 × 2, 38-pixel rows) | 72 × 2014 | y = 2014 | x + 36 |
| 185, 649 | small piles, the 2 × 1 row (y = 18; 649 holds it alone) | 1908 × 54, 1908 × 36 | x = 1908 | y + 18 |
| 187, 648 | large piles 2 (3 × 2) | 1890 × 72 | x = 1890 | y + 36 |

So a stored frame `f` past the period `p` reads the cell at `f − k·p`, shifted by `k` times the second block's offset,
`k = ⌊f / p⌋` (`wrappedFrame` in `packages/renderer/src/gpu/frame-wrap.ts`). Lamps wrap at style 37 (y = 1998): the
first block's art ends there, although 2048 rows would hold one more partial style. Small piles' 1 × 1 row ends at
x = 1474, far short of the period. Any other sheet with a side of 1800 pixels or more either holds its styles within
the sheet or uses its other blocks for something else (doors, chests, paintings 240 and 242, piles 186 and 647); a
frame past the edge of a sheet not in the table keeps its map colour.

### Minecart tracks

A minecart track (tile 314) stores **piece indices**, not sheet offsets (R: `scripts/sprite-objects`, ADR 0003): the
game's own accessors read the front piece from `frameX` and the back piece from `frameY`, and its placement writes
`frameY = -1` for an ordinary track. A track with a back piece is a junction: both pieces are drawn, the back one first
and the front one over it (chosen: the order is not observable without the game's renderer). `Tiles_314` is
144 × 144 pixels, 8 × 8 cells of 16 pixels at a stride of 18; the game's source-rectangle function gives every piece a
whole cell (R). Pieces 0–35 exist; any other value draws the track in its map colour (chosen). Placing tracks shows
what the pieces are (R): a horizontal run is 2, 1, …, 1, 3 (left end, middles, right end); a diagonal down to the
right is 11, 8, …, 8, 12; pressure-plate tracks (style 1) use 20 and 21, boosters (styles 2, 3) 30 to 35.

Each piece may draw **extras** on a neighbouring tile (R: the game's `DrawLeftDecoration`, `DrawRightDecoration`,
`DrawBumper` and `DrawBouncyBumper` per piece): a decoration under a slope, on the tile **below** the track, and a
bumper at an end, on the tile **above** it. Where they go was measured in the art (S): a decoration's art continues the
bottom edge of the slopes that draw it (piece 4's bottom row runs into the top row of the left-down decoration), and the
bumper's posts continue into the top rows of the ends that draw it. The viewer draws an extra only on a tile without a
block (chosen: blocks keep their pixels), over whatever lies there, and the extras of both pieces of a junction. The
track's own pieces are drawn by the chunk pass; its extras, which reach the neighbouring tiles, by the object pass
("Trees"), over the chunk pass.

| Piece | Cell (column, row) | Extras | Piece | Cell | Extras | Piece | Cell | Extras |
|---|---|---|---|---|---|---|---|---|
| 0 | (0, 0) | — | 12 | (6, 1) | bumper | 24 | (2, 2) | bouncy bumper |
| 1 | (1, 0) | — | 13 | (7, 1) | bumper | 25 | (3, 2) | bouncy bumper |
| 2 | (2, 1) | bumper | 14 | (2, 0) | — | 26 | (4, 2) | left-down, bouncy bumper |
| 3 | (3, 1) | bumper | 15 | (3, 0) | — | 27 | (5, 2) | right-down, bouncy bumper |
| 4 | (0, 2) | left-down | 16 | (4, 0) | left-down | 28 | (6, 2) | bouncy bumper |
| 5 | (1, 2) | right-down | 17 | (5, 0) | right-down | 29 | (7, 2) | bouncy bumper |
| 6 | (0, 1) | — | 18 | (6, 0) | — | 30 | (2, 3) | — |
| 7 | (1, 1) | — | 19 | (7, 0) | — | 31 | (3, 3) | — |
| 8 | (0, 3) | right-down | 20 | (0, 4) | — | 32 | (4, 3) | right-down |
| 9 | (1, 3) | left-down | 21 | (1, 4) | — | 33 | (5, 3) | left-down |
| 10 | (4, 1) | left-down, bumper | 22 | (0, 5) | — | 34 | (6, 3) | right-down |
| 11 | (5, 1) | right-down, bumper | 23 | (1, 5) | — | 35 | (7, 3) | left-down |

The extras' cells (R: the game names them as pieces 36–39): left-down decoration **(0, 6)**, right-down decoration
**(1, 6)**, bumper **(0, 7)**, bouncy bumper **(1, 7)**. The table is generated
(`packages/renderer/src/objects/terraria-sprite-objects.generated.ts`, `scripts/sprite-objects/export.mjs`). Pieces
30–35 have a second animation frame (row 4 instead of row 3: a pressed plate); the viewer draws frame 0 (animation is
out of scope).

```text
source = (x = 18 × column, y = 18 × row, w = 16, h = 16)   // per piece; back piece first, then the front piece
dest   = the track's tile; a decoration the tile below it, a bumper the tile above it
```

### Trees

Trees (common 5, gem trees 583–589, vanity trees 596 and 616, ash trees 634), palms (323) and the giant mushroom (72)
store frames, but their sprites reach past their tiles and their tops and branches come from other sheets, chosen by
the ground under the tree and the world header. Everything marked R was observed with
`scripts/sprite-objects/observe.ps1` (ADR 0003): trees grown by the game's own `WorldGen.GrowTree`, `GrowPalmTree`
and `GrowShroom`, and synthetic trees over every block type, asked for their draw data (`TileDrawing.GetTileDrawData`),
biome (`GetTreeBiome`, `GetPalmTreeBiome`) and foliage (`WorldGen.GetCommonTreeFoliageData`, `GetGemTreeFoliageData`,
`GetVanityTreeFoliageData`, `GetAshTreeFoliageData`) under every tree top variation 0–63 at 30 consecutive columns.
The tables the viewer needs are generated (`terraria-sprite-objects.generated.ts`, see "Minecart tracks").

**Which tiles carry foliage (R).** A tree tile with `frameY` 198, 220 or 242 is leafy, its variant `(frameY − 198) / 22`;
with `frameX` 22 it is the **top** (`IsTileALeafyTreeTop`), with 44 a **left branch** (its trunk one tile to the
right) and with 66 a **right branch** (trunk to the left; `IsTileATreeBranch` reports the offset). Their own trunk cells
are empty art; every other frame is an ordinary trunk cell (bare branch stubs and roots included).

**Trunk cells.** The draw data gives every trunk tile a 20 × 20 cell at its stored frame (R). The common tree's cell is
shifted right by **176 · (biome + 1)** pixels: `Tiles_5` holds eight 176-pixel blocks, and the game's biome of the tree
(by the ground under its trunk: forest −1 → block 0, corruption 0 → 1, hallow 2 → 3, snow 3 → 4, crimson 4 → 5, jungle
5 → 6, mushroom 6 → 7; block 2 was not seen) picks one (R). `Tiles_5_0` … `Tiles_5_6` are pixel copies of blocks 1–7 and
are not needed. Gem, vanity and ash trees use their own sheet unshifted (R). The art of every trunk cell fills columns
2–17 of its 20 (roots and branch stubs reach to 0 and 19) and rows 0–15, with roots reaching 19 (S), so the cell is
drawn **2 pixels left of its tile, at its top**, overhanging 2 pixels to each side and 4 below (chosen from the art).
Cells are drawn column by column, each from the top, so a lower cell covers the overhang of the one above (chosen).

**Top and branch style.** The foliage data names a style (`Tree_Tops_<style>` and `Tree_Branches_<style>`), a frame
offset and the top's frame size (R; the frame sizes match the sheets' layouts, S). Which style depends on the **ground**
under the trunk and, for some grounds, on one of the world's **13 tree top variations** (`treeTopVariations` in the
header, F):

- forest grounds (grass 2, golf grass 477): the variation of the tree's **forest zone**, the zone by the header's three
  `treeX` boundaries (x < treeX[0] → zone 0, < treeX[1] → 1, < treeX[2] → 2, else 3; the variation index is the zone).
  Variation 0 gives style 0, any other v style **v + 5** (so the forest values 0–5 give styles 0, 6–10), 80 × 80;
- snow (147): variation 6; the styles by value are irregular (value 0: style 12, but 18 in every tenth column;
  1: 4; 2: 16; 3: 17; …), so the table lists each value 0–63;
- corruption (23, 661) style 1, crimson (199, 662) 5, jungle (60) 13 at 116 × 96, mushroom grass (70) 14, hallow
  (109, 492) 3 at 80 × 140 with the frame offset **3 · (x mod 3)** (nine frames), whatever the variations;
- gem trees on any of 15 stone-like blocks styles 22–28 (116 × 96), vanity trees 29 and 30 (118 × 96), the ash tree
  31 (116 × 96).

The frame is the tile's variant plus the offset; the offset is taken at the top's or branch's own column (R: a branch
reports the frame of its own column). A ground the table does not list draws no foliage (the trunk cells still draw).
The header's `treeStyles` do not change the foliage (R: only the variations do). A variation outside 0–63 takes the
variation-0 style (chosen; real worlds store small values).

**Placement (chosen from the art, S).** A top frame `w × h` sits on its tile: its bottom on the tile's bottom, centred
(left edge `16x + 8 − ⌊w/2⌋`); the trunk stub at the bottom of every 80-pixel-wide top spans columns 32–47, exactly
the tile (two 114- and 118-wide styles are off by one pixel). A branch frame (40 × 40; left branches in column 0, right
ones at x = 42; rows by frame) is centred vertically on its tile (12 pixels above it) and touches the trunk: a left
branch's right edge on its tile's right edge, a right branch's left edge on its tile's left edge (their art stubs run
into the trunk there).

**Palms (R).** A palm stores its column's cell in `frameX` (66 the base, 0/22/44 trunk, 88/110/132 the leafy top in
three variants) and its lean in `frameY`: an offset in pixels (even, −16 to 16 in grown palms, changing by 2 a tile up
the trunk). The draw data replaces `frameY` with **22 · row**, the row by the sand under the palm: sand (53) 0,
crimsand (234) 1, pearlsand (116) 2, ebonsand (112) 3; on any other ground the game names row −1 (outside the sheet)
and the viewer draws nothing (chosen). The cell is drawn shifted right by the lean (chosen: the sign is not
observable). The top comes from `Tree_Tops_15` (80 × 80, three columns by variant, four rows by the palm row; chosen
from the sheet's layout), placed like a tree top and shifted by the top tile's lean. The oasis rows 4–7 of `Tiles_323`
were not observed.

**The giant mushroom (R, S).** Its stem cells are 16 × 18 at the stored frame (R: draw data), drawn at the tile, 2
pixels overhanging below. The tile with `frameX` 36 is the top: its own cell is empty art and its cap is
`Shroom_Tops` (three 60 × 42 caps at a stride of 62, the column `frameY / 18`), centred on the tile, its bottom on the
tile's bottom (chosen: the cap's stem stub spans columns 22–37).

**How the viewer draws them (#238).** The chunk pass shows what lies behind a tree tile (walls, background), faded in
over its map colour like any sprite. An **object pass**, drawn after the chunk pass in sprite mode, draws the sprites of
every visible chunk and the chunks around it as quads at their pixel positions: first the trunk cells (and the track
extras), then the branches, then the tops and caps, so the foliage covers neighbouring trunks and blocks (chosen; the
game's layering is not observable). Its sprites are collected on the CPU per chunk from the planes and the header's
`treeX` and `treeTopVariations` (`toRenderableWorld` passes them as `RenderableWorld.trees`), and collected again for
the chunks around an edited tile. Liquids and the colour overlay of the chunk pass lie under the object pass; wires are
drawn over it ("Wires").

### Wires

`WiresNew` (288 × 288) holds 16 × 16 wire pieces at a stride of 18: **16 columns**, one per combination of the four
sides a wire continues to, and **16 rows**. Measured in the art (S): a piece's art reaches the top edge of its cell
exactly when its column has bit 1, the right edge with bit 2, the bottom edge with bit 4 and the left edge with bit 8
(column 0 is a lone dot, column 15 a cross), so

```text
column = (up ? 1 : 0) + (right ? 2 : 0) + (down ? 4 : 0) + (left ? 8 : 0)   // the same colour on that side neighbour
row    = 0 red, 1 blue, 2 green, 3 yellow                                   // rows 0–3 by their colour (S)
source = (x = 18 × column, y = 18 × row, w = 16, h = 16)
```

Rows 4–15 repeat the four colours with other looks (thinner, broken, diagonal); which one the game shows when is not
observable without its renderer, so the viewer uses rows 0–3 (chosen; open question). `Actuator` is one 16 × 16 image.
The older `Wires`, `Wires2`–`Wires4` sheets (90 × 72, one colour each) are not used.

How the viewer draws them (#241): only a side neighbour with a wire of the **same colour** counts; a neighbour outside
the world counts as none. In sprite mode a **wire pass** draws every chunk once more after the chunk pass and the
object pass ("Trees"): per tile the shown colours in the order **red, blue, green, yellow** (each over the ones
before, so yellow ends on top as in the colour overlay), then the **actuator** over them. The layer toggles (red, blue,
green, yellow, actuators) select what is drawn, and a neighbour's hidden colour still connects (the piece does not
change when another colour is hidden). Below `SPRITE_MIN_ZOOM` the colour overlay of the chunk pass stays; from there
to `SPRITE_FULL_ZOOM` the pieces fade in over the overlay. Without `WiresNew` in the atlas the wire pass draws the
overlay; an actuator without its sheet its overlay colour. The pass blends over what is drawn (premultiplied), so over
a fully transparent pixel (background hidden and nothing behind the wire) a half-transparent wire pixel darkens
slightly, unlike the chunk pass's overlay rule (chosen).

### Worked examples

| # | Case | Input | Source rectangle (x, y, w, h) | Basis |
|---|---|---|---|---|
| 1 | Dirt, `Tiles_0` (not frame-important), dirt on all eight neighbours (four sides and four diagonals), variant 0 | computed frame (18, 18) | **(18, 18, 16, 16)** → pixels 18–33 × 18–33 | R ("Tile framing", example 5), stride 18 |
| 2 | Dirt, only a right-hand neighbour, variant 0 | computed frame (162, 0) | **(162, 0, 16, 16)** | R ("Tile framing", example 2): column 9 × 18 = 162 |
| 3 | Torch, `Tiles_4` (frame-important, grid 20×20, gap 2) | `.wld` vector T6: `frameX 0, frameY 66` | **(0, 66, 20, 20)** — style row 66 / 22 = 3 | F (T6), A12 line 98 |
| 4 | Chest, `Tiles_21` (frame-important 2×2 object, grid 16, gap 2), style `s`, part `(dx, dy)` | `frameX = 36s + 18dx`, `frameY = 18dy` | style 1, bottom-right: **(54, 18, 16, 16)** | A12 line 3084 (`frameSize 2×2`) |
| 5 | Stone wall, `Wall_1`, no wall neighbours, variant 0 | cell (9, 3) | **(324, 108, 32, 32)** | R (framing database) |
| 6 | Wall with all four neighbours at `x mod 3 = 0`, `y mod 3 = 1`, variant 0 | cell (1, 1) | **(36, 36, 32, 32)** | R (framing database) |

Expected sheet sizes (consistent with the size arithmetic, confirmed only by the opt-in test): `Tiles_0`
288 × 270 = 16 × 15 cells of 18; `Wall_1` 468 × 180 = 13 × 5 cells of 36.

### Special handling — what M4 covers

| Case | M4 | Deferred |
|---|---|---|
| Frame-important tiles with a 16×16 grid (most furniture, multi-tile objects) | draw each tile's own cell at `(frameX, frameY)`; multi-tile objects need nothing extra because every tile carries its own frame; frames past the sheet's edge wrap ("Frames past the sheet's edge") | — |
| Frame-important tiles with other grids (torches, plants, …) | draw with the tile's `textureGrid` size | exact per-id draw offsets |
| Non-frame-important blocks | the cell framed by "Tile framing" and its database (#141, #146), grass and moss included; half blocks and slopes cut per "Slopes and half blocks"; falling blocks with nothing below them in map colours | paint, lighting |
| Walls | the cell framed by "Walls" and the framing database (#147), a 32 × 32 cell centred on the tile, below the blocks | paint, lighting |
| Animated tiles (173 ids flagged `isAnimated` in A12, all frame-important) | draw the stored frame (static) | animation |
| Minecart tracks (314) | the stored pieces' cells, a junction's back piece under its front piece, decorations below and bumpers above (#239, "Minecart tracks") | pressure-plate and booster animation, minecarts, paint |
| Trees (5, 583–589, 596, 616, 634), palms (323), the giant mushroom (72) | trunk cells by ground, tops and branches by ground, zone and tree top variation, palm rows and lean, mushroom caps, in an object pass over the chunk pass (#238, "Trees") | wind sway, paint, lighting, the oasis palm rows |
| Other variant sheets (`Tiles_2_Beach`, `Tiles_59_2`, …) | — | yes |
| Wires and actuators | the `WiresNew` piece the four same-colour side neighbours give, red to yellow, the actuator on top, over everything in a wire pass; the colour overlay below `SPRITE_MIN_ZOOM` (#241, "Wires") | animation, the wiring tools' translucency modes, the other `WiresNew` rows |
| Paint, actuated/inactive tint, illumination, liquids | — | yes |

## Tile framing

This section explains how a block or wall whose frame is **not** stored in the `.wld` picks its cell: diagonal
corners, merging with other types (for example stone ↔ dirt), slopes and half blocks, the variant, grass and moss,
large-frame blocks, walls. Cactus, vines, beams and the other non-block self-framed ids stay deferred ("Not covered").

**How we derived it.** Everything here comes from the game itself, observed as a black box, and from the game's own
sheet art. The **cell catalogue** (what each cell of a sheet looks like) is **measured from the art** (S). The
**selection** (which cell the game gives which neighbourhood) is **observed at runtime** (R, [ADR 0003](adr/0003-observe-framing-in-the-game.md)):
the installed game's framing is called on synthetic tiles and the frames it writes are recorded, for every
neighbourhood of every pair of self-framed types. The result is committed as the **framing database**
(`packages/renderer/src/framing/terraria-framing.generated.ts`); the rules below are our own description of it and
are checked against it. In-game screenshots (G) were the first check and stay as history. No rule, table or value
comes from another editor's code or data.

### Sources and evidence

| Id | Source | Revision | Used for |
|---|---|---|---|
| F | [header.md](file-format/header.md) (frame-important bitset), [tiles.md](file-format/tiles.md) ("Record layout", byte-2 bits 4–6 = block shape) | this repo | which ids store their frames; the shape values 0–5 |
| S | **Sheet art**: local install L (1.4.5.8), sheets decoded with `packages/assets` and measured with [`packages/assets/tools/measure-tile-sheets.ts`](../packages/assets/tools/measure-tile-sheets.ts) (prints to the terminal; no pixels are saved) | measured 2026-10-07 and (layout agreement, grass and moss, large-frame sheets) 2026-10-08 | the cell catalogue ("Measuring the sheet", "Grass and moss sheets") |
| G | **In-game check** of v2 and v3 Frozen observation worlds, generated from `SJCO1` | user screenshots, 2026-10-08 20:27–20:29 and 20:59–21:01; disposable game saves | [Observation results](#observation-results-2026-10-08) and [Frozen-world results](#frozen-world-results) |
| R | **Runtime observation** ([ADR 0003](adr/0003-observe-framing-in-the-game.md)): the installed game's `WorldGen.TileFrame` and `Framing.WallFrame` called on synthetic tiles by [`scripts/framing/observe.ps1`](../scripts/framing/observe.ps1); only the frames they write are recorded. Also the game's track, tree and draw-data functions (`Minecart.GetSourceRect`, `WorldGen.Get…TreeFoliageData`, `TileDrawing.GetTileDrawData`, …) called on synthetic tiles by [`scripts/sprite-objects/observe.ps1`](../scripts/sprite-objects/observe.ps1); only what they return is recorded | L (1.4.5.8), 2026-10-09 and 2026-10-10 | every rule below; the [framing database](#the-framing-database); [Runtime observation results](#runtime-observation-results-2026-10-09) |

Evidence marks: **S** (measured in the art), **G** (seen in a screenshot; only the cases visible there), **R**
(observed at runtime: exact, because it reads the frame the game writes, so pixel-identical cells are told apart),
**chosen** (our decision where the game leaves a choice, such as the variant). R never reads code: the game is a
black box called on our own input. Nothing here comes from decompiled game code.

### Which tiles are framed at runtime

- **Frame-important ids** (header bitset, F) store `frameX`/`frameY` and never take this path.
- **333 block types** frame from their neighbours (R: every type whose 3 × 3 centre takes an interior cell, in five trials out of five, when framed
  by the game). They are listed in the framing database (`blockTypes`): dirt, stone, ores, sand, bricks, wood, grass,
  moss, gemspark and the other placeable blocks. Each has its tables there.
- **Falling blocks** among them (sand, ebonsand, pearlsand, crimsand, silt, slush, shell piles and the four coin piles) fall when nothing is
  below them, so the game never frames them in such a place. R observes them standing on a stone floor below the
  neighbourhood's bottom row (outside the centre's 3 × 3); a neighbourhood in which a tile still falls or moves is
  recorded as **unstable** (cell `(63, 63)`, `UNSTABLE_CELL`) instead of a cell.
- Other ids that store no frame but have no block interior (cactus 80, vines, beams, columns, …) frame by rules of
  their own; deferred.
- **Walls** (every wall type, 366 in 1.4.5.8) frame from their four side neighbours ("Walls" in "Sprite layout").
- Sheet sizes (S): dirt, stone and most blocks use **288 × 270** = 16 columns × 15 rows of 18-pixel cells. The moss
  sheets (moss blocks 179–183, 534, 536, 539, 625, 627; moss bricks 512–517, 535, 537, 540, 626, 628) are
  **288 × 396** (22 rows) and share the layout of the grass sheets, which are 288 × 396 too (`Tiles_2` is 288 × 1980).
  See "Grass and moss sheets". The 24 large-frame ids use **234 × 180** sheets (see "Variant").

Notation: `(c, r)` is a cell, column `c` and row `r`, both 0-based. Its source rectangle is `(18c, 18r, 16, 16)`
(stride 18, see "Sprite layout"). x grows to the right and y downwards. N/E/S/W are the edge neighbours and
NW/NE/SE/SW the corner neighbours.

### Measuring the sheet (S)

For every cell we record a **look**: one letter per side (N, E, S, W) and one per corner (NW, NE, SE, SW).

- **Pixel classes** come from the colour statistics of the sheet itself. *Outline* is a colour that occurs in the
  2-pixel ring around cells at least four times as often as in their 8 × 8 middle (stone `23,23,23`, copper
  `55,5,10`, dirt `30,19,12` and `73,57,63`; a colour never seen in the middle qualifies at once). The first
  version demanded "never in the middle" and found no outline in 8 sheets whose dark outline colour also shades the
  body (ids 9, 41, 43, 47, 120, 169, 190, 311); the ratio gives stone, copper and dirt the same outline colours as
  before. *Partner* means the colours of the dirt sheet (`114,81,56`, `151,107,75`, `30,19,12`).
  *Transparent* means alpha 0. Everything else is *body*.
- **Side** (middle 12 pixels of the outermost row or column): `d` (**rim**: the partner's texture reaches the edge)
  when partner pixels are at least as many as body pixels and as outline plus transparent pixels. Otherwise `o`
  (**open**: the body runs to the edge) when body pixels outnumber all others, else `x` (**closed**: outlined or
  cut away).
- **Corner** (2 × 2 corner pixels): `d` with ≥ 3 partner pixels, `x` (**notch**) with ≥ 3 outline or transparent
  pixels, else `o`. A corner carries information only when both of its sides are `o`. In dirt the notch is drawn
  as four light highlight pixels (`191,143,111`, `169,125,93`) instead of outline; they are passed as notch colours.

The rules above are implemented in `packages/assets/tools/sheet-measure.ts` (unit-tested on synthetic sheets) and
run against a local install with:

```bash
pnpm --filter @studio/assets build
node packages/assets/tools/measure-tile-sheets.ts --content "<Terraria>/Content" --tile 1 --partner 0 --compare 7
node packages/assets/tools/measure-tile-sheets.ts --content "<Terraria>/Content" --tile 0 --notch 191,143,111 --notch 169,125,93
```

It prints the outline colours, the look counts, the rim side codes without a cell, the sheet map below and the
cells that differ from each `--compare` sheet. Every figure in this subsection comes from that output.

**Layout agreement (`--agree`).** Pixel classes break down on patterned art: brick mortar along an open edge reads
as outline, and a sheet may draw its rims in colours that the partner sheet does not use. The agreement test
classifies no colour. Given a reference measurement (the `--tile` sheet) and another sheet, it learns from the
other sheet's own art how often each colour (transparent included) occurs in 2-pixel side bands whose reference
letter is `o`, `x` or `d`. It then predicts every side of every look from the *other* looks only: all variants of
the look are held back, so a look is never predicted from its own copies. It reports how many sides come out as
the reference says. A sheet that shares the layout scores close to all sides. A sheet with another layout scores
far lower, because the colours of a held-back look follow no side letter:

```bash
node packages/assets/tools/measure-tile-sheets.ts --content "<Terraria>/Content" --tile 1 --partner 0 --agree 41 --agree 19
```

Controls (other layouts, measured against stone): platforms `Tiles_19` 328/732 sides (45 %), cactus `Tiles_80`
134/336 (40 %; small sheet), gemspark `Tiles_255` 221/288 (77 %; only rows 0–4 fit), grass `Tiles_2` 514/732
(70 %), the 21 moss sheets 497–528/732 (68–72 %).

Results:

- **Stone (`Tiles_1`) and copper ore (`Tiles_7`) measure identically.** Their 183 non-empty cells form **61
  distinct looks**, each held by exactly **3 cells**: the three variants. 24 looks have no rim side: the 16
  `o`/`x` side patterns plus 8 extra corner looks among the all-open cells (4 notch looks and 4 rim-corner looks).
  The other 37 looks have at least one rim side.
- **Dirt (`Tiles_0`)**, measured without a partner and with its notch colours, matches stone on all **60 cells
  of the 20 looks without any rim** (the 16 side patterns and the 4 notch looks). The other 123 cells hold
  different dirt art. Dirt has no partner, so the 111 rim-side slots are never selected. The 12 rim-corner slots
  are different: in dirt they measure as **single notches** in the same corner (for example (0,5) has a notch SE
  where stone has a rim corner SE; (0,9) and (1,9) measure as plain). Whether the game draws them for a dirt tile
  with one missing diagonal is open (O7).
- **Other dirt-partner sheets.** The self-framed, non-grass ids whose partner is dirt (R): 21 have taller
  288 × 396 sheets (moss, see "Grass and moss sheets"). The first pass (`--partner 0 --compare 1`) proved 48 of the
  90 sheets of 288 × 270: **29** match stone cell for cell, and **19** match on every side and rim and differ only
  because the four notch looks are drawn without a notch (bricks, sand, …). The agreement test against stone
  (`--tile 1 --partner 0 --agree <id>`) settles the rest. Over the 89 sheets other than stone, plus ash and
  hellstone:
  - **82** score 729–732 of 732 sides (≥ 99.6 %), among them wood (30), mud (59), ash (57), hellstone (58) and 4 of
    the 8 sheets without a unique outline colour (9, 47, 120, 169);
  - **3** score 721–726 (≥ 98.5 %): pink brick 44, crimstone 203, pumpkin block 251;
  - **5** score 665–710 (91–97 %), and all their disagreements but one are open sides that the art draws dark: blue
    brick 41 (666) and green brick 43 (668) draw mortar along the S edge of every cell, dynasty wood 311 (665) frames
    every cell, cactus block 188 (708) and glowing mushroom block 190 (710; plus one rim side read as closed) draw
    dark seams across open edges;
  - **1** does not share the rim art: **coralstone 315** (435/732, 59 %). Its rows 0–4 follow the stone layout, but
    its 111 rim slots and its interior looks hold one plain sandy texture with no partner art at any side, so the
    art cannot say where a rim belongs (O6).

  Result: **88 of the 89** sheets, ash and hellstone share stone's layout of sides and rims (hellstone 732/732, with
  ash as its partner, R); whether a sheet draws the four notch looks is per sheet (`--compare 1`). The test
  checks *where* the sheet draws distinct art, not what the rim art shows; that mud's rims look stone-grey rather
  than dirt-brown is therefore still only a visual note.

The **sheet map** below gives the measured side code `NESW` of every cell of `Tiles_1`. `----` marks an empty
cell.

```text
       0    1    2    3    4    5    6    7    8    9   10   11   12   13   14   15
  0  ooox xooo xooo xooo oxoo oxox xxox xxox xxox xoxx oooo oooo xxxo xodo xodo xodo
  1  ooox oooo oooo oooo oxoo oxox oooo oooo oooo xoxx oooo oooo xxxo doxo doxo doxo
  2  ooox ooxo ooxo ooxo oxoo oxox oooo oooo oooo xoxx oooo oooo xxxo odox odox odox
  3  xoox xxoo xoox xxoo xoox xxoo oxxx oxxx oxxx xxxx xxxx xxxx ---- oxod oxod oxod
  4  ooxx oxxo ooxx oxxo ooxx oxxo xoxo xoxo xoxo ---- ---- ---- ---- ---- ---- ----
  5  oooo oooo dood ddoo oodx oxdo xxdx oxdx oodo oodo oodo ddod dodd ---- ---- ----
  6  oooo oooo oodd oddo oodx oxdo xxdx oxdx dooo dooo dooo ddod dodd ---- ---- ----
  7  oooo oooo dood ddoo oodx oxdo xxdx oxdx odoo oood odod ddod dodd ---- ---- ----
  8  oooo oooo oodd oddo doox dxoo dxxx dxox odoo oood odod oddd dddo ---- ---- ----
  9  oooo oooo dood ddoo doox dxoo dxxx dxox odoo oood odod oddd dddo ---- ---- ----
 10  oooo oooo oodd oddo doox dxoo dxxx dxox dodo dodo dodo oddd dddo ---- ---- ----
 11  xood xood xood xdoo xdoo xdoo dddd dddd dddd xdxd xdxd xdxd ---- ---- ---- ----
 12  ooxd ooxd ooxd odxo odxo odxo dxdx ---- ---- ---- ---- ---- ---- ---- ---- ----
 13  xxxd xxxd xxxd xdxx xdxx xdxx dxdx ---- ---- ---- ---- ---- ---- ---- ---- ----
 14  xoxd xoxd xoxd xdxo xdxo xdxo dxdx ---- ---- ---- ---- ---- ---- ---- ---- ----
```

Every side code except `oooo` belongs to exactly three cells. The 27 `oooo` cells split by their corners
(`NW NE SE SW`) into nine interior looks:

| Interior look | Meaning | Cells |
|---|---|---|
| `oooo` | plain interior | (1,1) (2,1) (3,1) |
| `xxoo` | notches NW and NE | (6,1) (7,1) (8,1) |
| `ooxx` | notches SE and SW | (6,2) (7,2) (8,2) |
| `oxxo` | notches NE and SE | (11,0) (11,1) (11,2) |
| `xoox` | notches NW and SW | (10,0) (10,1) (10,2) |
| `oodo` | rim corner SE | (0,5) (0,7) (0,9) |
| `oood` | rim corner SW | (1,5) (1,7) (1,9) |
| `dooo` | rim corner NW | (1,6) (1,8) (1,10) |
| `odoo` | rim corner NE | (0,6) (0,8) (0,10) |

**Variant order (R):** the three cells of a look are `v0`, `v1`, `v2` in reading order (row first, then column): the
game's variant 0, 1 and 2 give exactly these cells (for example dirt (0,3) → (2,3), (4,3); stone (9,7) → (9,8), (9,9)).
The database holds the full variant map of every type.

### Neighbour classes

A neighbour with no active tile, or outside the world, is **absent** (`x`). For a present neighbour, R shows that
every self-framed type `t` treats every other self-framed type `u` in exactly one of four ways, over all 6 561
neighbourhoods of `t` with `u` (the framing database records which way for all 333 × 332 pairs):

1. **Like itself** (`o`): `t` frames exactly as if `u` were `t`. This is far wider than a "stone family": stone, for
   example, treats 212 other types like itself, among them wood, bricks, gem stones and grass.
2. **Like air** (`x`): `u` is a **seam**. Ores beside other ores or beside stone are seams (copper beside stone and
   beside iron frame identically, R).
3. **As its partner** (`d`): `t` draws its rim looks toward `u` (rows 5–14 of the stone layout). Dirt is the partner
   of 133 types (stone, the ores, sand, bricks, wood, …); ash of hellstone; snow (147) of the ice blocks 161, 163, 164,
   170, 200, 224, 738; sand (53) of 397 and 747; mud (59) of dirt and of the jungle grasses ("Grass and moss sheets").
   Stone, copper, hellstone (with ash) and coralstone frame **identically** against their partner.
4. **As a relative** (own table, no rims): `t` connects to `u` at corners and, at edges, only where `u`'s own cell
   keeps its rim toward `t` (the **edge check**, below). Dirt sees the 133 types it is the partner of this way; most
   stone-like blocks see the sand types (53, 112, 116, 234, 495) this way.

Neighbourhoods with **three or more** types at once (for example dirt with stone and copper around it) are not
tabulated: in them each neighbour takes the letter of its own pair, and R checks the resulting rules (below) for the
observed pairs. Cobweb (51) treats almost every block like itself and is one of the 333 types.

### Choosing the cell

Given the letters of the eight neighbours (`x` absent or seam, `o` like itself or a connecting relative, `d` partner):

1. **Sides** (`NESW`) other than `oooo`: take the look with exactly these sides in the sheet map. 28 of the 65 side
   codes that contain `d` have no cell (`dddx ddox ddxd ddxo ddxx dodx doxd doxx dxdd dxdo dxod dxxd dxxo oddx odxd
   odxx oxdd oxxd xddd xddo xddx xdod xdox xodd xodx xxdd xxdo xxod`). For those, **turn every `d` side into `x`**
   and look again. All 16 `o`/`x` codes exist, so this always finds a cell. R: exactly these 28 codes fall back, for
   stone, copper, hellstone and coralstone with every corner of their own type (G saw all 28 in game).
2. **Sides `oooo`:** the corners decide. If **all four corners are `x`**, select the **NW+NE notches**. Otherwise
   walk the nine interior looks in this order and take the first whose every non-`o` corner equals the wanted corner
   letter: rim SE, rim SW, rim NE, rim NW, notches SE+SW, NW+NE, NE+SE, NW+SW, plain interior. R: this predicts all 81
   corner combinations of stone with dirt corners and all 16 of dirt and of stone with air. Consequences: one missing
   corner, or two opposite ones, keep the plain interior (no one-notch look exists in the stone layout). Dirt's
   rim-corner slots, whose art shows single notches, are selected only as rim corners toward mud, dirt's own partner
   (R), never for a missing corner (O7).
3. **Variant:** cell `v` of the look, with `v` from "Variant".

**Edge check.** The open edges of a cell are its sides that are not `x` (`o` or `d`). A relative `n` at an edge of
the centre takes its own cell first; the centre treats that edge as `o` only if `n`'s cell has `d` on the side facing
the centre (that side can only be `d` or `x`, because `n` sees the centre as its partner). It is `x` when step 1's
fallback removed the rim. Without the check the centre would draw an open edge against an outline (example 14).
Examples 8 and 14 show both sides of it (G, R).

**Inputs beyond 3 × 3.** A tile without relatives takes its cell from its 3 × 3. A tile with relatives (dirt beside
stone, …) additionally needs **one bit per relative edge neighbour**: whether that neighbour's cell keeps its rim.
Relatives chain (below: up to five steps, dirt → sand → hardened sand → sandstone → desert fossil → 407), so
implementations frame in **passes by depth**: a type of depth 0 has no relatives, a type of depth `k` frames after its
relatives, all of depth below `k`. Stone and the ores have depth 0; dirt has depth 5, because sand is one of its
relatives. What a tile actually reads is the chain present around it: dirt beside stone needs one step (two passes),
dirt beside sand beside hardened sand needs more. A tile whose chain around it is `k` steps long depends on the tiles up
to `k + 1` away. An edit therefore changes cells up to `d + 1` tiles around it, where `d` is the deepest depth
(`BlockFraming.depth`; dirt has 5 because of sand) among the types within 6 tiles of the edit, before and after it.
Re-framing 13 × 13 tiles costs microseconds, so an editor should simply always invalidate 13 × 13. R:
framing in two passes, in one pass and with the game's own range framing gives identical cells (for the observed
pairs).

**Implementation (`frameBlock`, `packages/renderer/src/framing/frame-block.ts`).** The letters come from the
database, never from a list of types:

- A type **follows the block layout** when its table alone equals the steps above (275 types, among them sand and
  the other falling types wherever they stand). Grass, moss, gemspark and the 3 × 4 large-frame blocks do not: they
  read their cells from the database's tables directly. Position-framed types read the table of their position
  `(x mod 6, y mod 4)` in neighbourhoods of air and themselves.
- A pair table is **like itself**, **like air** or **partner** when it equals the steps with that letter wherever the
  game kept the neighbourhood (the extra tables of the falling types differ only where a tile fell). It is a
  **relative** when the other type sees the centre as its partner and the table connects at corners like itself.
  Any other pair table is looked up directly. Mud beside dirt is one: mud connects to dirt at every edge, even where
  dirt's own cell lost its rim, and draws notches toward dirt in its corners, so it follows no letter.
- **Passes.** The region helper frames each type in the pass after its relatives ("Inputs beyond 3 × 3"), by the
  types' depth (not the chain present, which would need a search per tile): it frames the tiles up to `k` around the
  region for the deepest type `k` in it (5 for any region with dirt) and reads one more ring. Every tile is framed
  once; the passes only re-scan the types.
- Neighbours that are not self-framed blocks (furniture, platforms, modded or unknown content) count as absent, but
  they hold up a falling block above them. In a neighbourhood of three or more types, a centre that reads a table
  directly takes its first neighbour of a table-read type as the other type (else its first partner or relative),
  reads relatives as itself and every other partner or table-read neighbour as that type: the database tabulates
  pairs only.
- For grass, gemspark and the large-frame blocks the database records, in about 230 neighbourhoods **without** the
  other type, other cells in their pair tables than in their tables alone: the game's result there depends on more
  than the 3 × 3. `frameBlock` uses the table alone for them.
- `frameBlock` returns no cell for a falling block with nothing below it (the database's unstable neighbourhoods).
- A centre that reads a table still applies the edge check to a relative that is not the table's other type: its
  edge connects only where the relative keeps its rim (mud beside chlorophyte and one of its table types, dirt or
  668, meets this case).
- `frameRegion` writes one `Uint16` per tile, the packed cell `column · 64 + row` or `NO_CELL` (0xFFFF), column-major
  like the CWM planes, so a renderer can keep it as a per-chunk plane. It frames about 120–160 ns per tile in Node
  (1024 × 1024 mixed terrain), with no per-tile allocations.

### Variant

- **Inputs.** Ordinary blocks have three variants (`v0`–`v2`), hand-drawn copies of the same look (S: 3 cells per
  look). The `.wld` stores no frame for these tiles (F), so it stores no variant either.
- **Game behaviour (R).** Framing a tile with reset draws its variant at random (about a third each); framing it
  again without reset keeps the variant the tile remembers in memory. The `.wld` stores no variant, so every load
  draws new ones and no viewer can reproduce the exact picture (O1). Walls behave the same (R).
- **Large-frame tiles (R).** 24 ids frame by **world position** and ignore the remembered variant. Seven repeat over
  `(x mod 3, y mod 4)`: 273, 274, 284, 325, 357, 618, 736. Seventeen repeat over `(x mod 2, y mod 2)`: 409, 669–676,
  735, 737, 741–743, 745, 746, 749. Cells of a plain interior (sides and corners `o`):

  | Kind | (0,0) | (1,0) | (2,0) | (0,1) | (1,1) | (2,1) | (0,2) | (1,2) | (2,2) | (0,3) | (1,3) | (2,3) |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|
  | 3 × 4 | (2,1) | (3,6) | (2,1) | (1,1) | (3,1) | (1,1) | (2,1) | (2,1) | (3,6) | (1,1) | (1,1) | (3,1) |
  | 2 × 2 | (1,1) | (2,1) | | (3,1) | (3,6) | | | | | | | |

  Row 6 is the second copy of the rim-free block (below), so the "six cells per look" are the three of row 1 and the
  three of row 6, spread by position. The database holds each large-frame type's whole table at all 24 positions
  `(x mod 6, y mod 4)`, so the other looks are recorded too.
- **Large-frame sheets (S).** All 24 sheets are **234 × 180**: 13 columns × 10 rows. Rows 0–4 hold the rim-free
  block of the stone layout (columns 0–12; no rim art), and rows 5–9 repeat it at the same positions with the same
  side codes, so every look has **six** cells, not three (`--tile 273 --rows 10` lists every side code ×6). Against
  stone's rows 0–4 (`--tile 1 --rows 5 --agree <id>`), 15 sheets score 240/240 sides; 735, 737, 741, 743, 745 and
  746 score 166–236 because of patterned edges. Some draw the four notch looks (409), others draw them as plain
  interiors (273).
- **Grass-like blocks without a partner (R).** A block of grass (or moss, or the ids 381, 512–517, 534–540, 625–628,
  633) with no air, no partner and no other block around takes the plain interior or the full-partner-rim cell (6,11)
  in a checkerboard by `(x + y) mod 2`, which shifts with the variant. The database holds these types' tables by
  position too. Such fully enclosed slabs are rare in worlds.
- **Viewer behaviour (chosen):** `v = (7x + 11y) mod 3`, where `x` and `y` are the tile's world coordinates. The game
  is random, so any deterministic choice is as faithful as another; this one makes renders reproducible and testable,
  and neighbouring tiles rarely share a variant, which is the visual point of the variants. Never use `Math.random`.

### Slopes and half blocks

The block shape is stored in byte-2 bits 4–6 of a tile record (F): 0 full, 1 half, 2–5 slopes. The names in F give
the corner that is **cut away**: shape 2 the NE corner, 3 NW, 4 SE, 5 SW; the half block cuts its top half.

**Face rule (R).** A side of the centre is connected (`o`) only when the centre's own face there is whole **and** the
neighbour on that side is present with a whole face toward the centre. The half block cuts only its top face (its
half-height side faces count as whole); a slope cuts the two faces at its cut corner: shape 2 N and E, shape 3 N and W,
shape 4 S and E, shape 5 S and W. The cell is then chosen from those sides and the corners as for a full block. R
checked it against every dirt centre of each of the 6 shapes with its four side neighbours each air or dirt of each
shape (14 406 neighbourhoods, corners full): **14 406 predicted, no exception**.

**Corner rule (R).** A corner neighbour counts by **presence** alone, whatever its shape. R checked every combination
of a full centre whose sides connect (each side in every shape with a whole face toward the centre) and whose corners
are air or a block in every shape: **460 992** for dirt and **5 483 712** for stone with dirt corners, **all
predicted**. So a shape only matters through the faces of the centre and of its side neighbours.

**Drawing** a shaped tile (how the chosen 16 × 16 cell is cut and moved into the tile) is not framing, and the runtime
observation does not cover it. It is cited from TEdit's drawing code (A8 5909–5949), which draws each shape as eight
2-pixel columns `i = 0…7` of the chosen cell. Sprite mode draws it so (`shapedColumns`,
`packages/renderer/src/framing/chunk-cells.ts`, and the chunk shader). It has **not** been compared with in-game
renders yet; that comparison is the manual test of #146:

| Shape | Cut corner | Column `i` draws | Whole faces |
|---|---|---|---|
| 1 half | top half | cell rows 0–7, placed in tile rows 8–15 | S (W and E only half) |
| 2 top-right | NE | cell rows 0 … 15−2i, moved down by 2i | W, S |
| 3 top-left | NW | cell rows 0 … 2i+1, moved down by 14−2i | E, S |
| 4 bottom-right | SE | cell rows 2i … 15, placed at the top | W, N |
| 5 bottom-left | SW | cell rows 0 … 2i+1, placed at the top | E, N |

Shapes 2–4 keep the outline of the cell and slide it diagonally, column by column; only shape 5 is a plain per-column
crop of the 16 × 16 cell. The half block uses only the upper half of the cell. The whole faces agree with the face
rule (R).

### Worked examples

`#` = centre, `d` dirt, `s` stone, `c` copper ore (`Tiles_7`), `i` iron ore (`Tiles_6`), `.` empty. Rows run N to S,
centre at `x = 0, y = 0`, so the variant is 0. For another variant, take `v1`/`v2` of the same look. Every row is the
game's own result (R, and `packages/renderer/tests/framing-database.test.ts` checks the database against them).
"Wanted" lists the wanted side letters `NESW` (plus corners `NW NE SE SW` for `oooo`).

| # | Centre (sheet) | Neighbourhood | Wanted → look | Cells v0 / v1 / v2 | Source rectangle (v0) | Evidence |
|---|---|---|---|---|---|---|
| 1 | dirt (0) | `...` / `.#.` / `...` | `xxxx` isolated | (9,3) (10,3) (11,3) | (162, 54, 16, 16) | S, R |
| 2 | dirt | `...` / `.#d` / `...` | `xoxx` left end | (9,0) (9,1) (9,2) | (162, 0, 16, 16) | S, R |
| 3 | dirt | `...` / `d#d` / `ddd` | `xooo` top surface (edge) | (1,0) (2,0) (3,0) | (18, 0, 16, 16) | S, R |
| 4 | dirt | `...` / `.#d` / `.dd` | `xoox` top-left corner | (0,3) (2,3) (4,3) | (0, 54, 16, 16) | S, R |
| 5 | dirt | `ddd` / `d#d` / `ddd` | `oooo` + `oooo` plain interior | (1,1) (2,1) (3,1) | (18, 18, 16, 16) | S, R |
| 6 | dirt | `.d.` / `d#d` / `ddd` | `oooo` + `xxoo` inner corners N | (6,1) (7,1) (8,1) | (108, 18, 16, 16) | S, R |
| 7 | dirt | `.d.` / `d#d` / `.d.` | `oooo` + `xxxx` → NW+NE notches (four-corner rule) | (6,1) (7,1) (8,1) | (108, 18, 16, 16) | S, G, R |
| 8a | dirt | `dds` / `d#s` / `dds`, stone mass to the E | E is a relative whose cell keeps its W rim (8b) → `oooo` + `oooo` | (1,1) (2,1) (3,1) | (18, 18, 16, 16) | S, G, R |
| 8b | stone (1), the E neighbour of 8a | `dss` / `d#s` / `dss` | `oood` rim W | (9,7) (9,8) (9,9) | (162, 126, 16, 16) | S, G, R |
| 9 | stone | `sss` / `s#d` / `sss` | `odoo` rim E | (8,7) (8,8) (8,9) | (144, 126, 16, 16) | S, R |
| 10 | stone | `ddd` / `d#d` / `ddd` | `dddd` stone pocket in dirt | (6,11) (7,11) (8,11) | (108, 198, 16, 16) | S, R |
| 11 | stone | `.d.` / `s#s` / `...` | `doxo` rim N, air S | (13,1) (14,1) (15,1) | (234, 18, 16, 16) | S, R |
| 12 | stone | `sss` / `s#s` / `ssd` | `oooo` + `oodo` rim corner SE | (0,5) (0,7) (0,9) | (0, 90, 16, 16) | S, R |
| 13 | stone | `ss.` / `d#s` / `dd.` | `oodd` rims S and W | (2,6) (2,8) (2,10) | (36, 108, 16, 16) | S, R |
| 14a | stone | `.dd` / `.#d` / `...` | `ddxx` has no cell → `xxxx` | (9,3) (10,3) (11,3) | (162, 54, 16, 16) | S, G, R |
| 14b | dirt, the E neighbour of 14a (its own row `d#d`, N `d`, S `.`) | 3 × 3 `dd.` / `s#d` / `...` | W is a relative whose cell (14a) has no rim → `x`: `ooxx` bottom-left corner | (0,4) (2,4) (4,4) | (0, 72, 16, 16) | S, G, R |
| 15 | copper (7) | `ddd` / `d#d` / `ddd` | `dddd` full dirt rim | (6,11) (7,11) (8,11) | (108, 198, 16, 16) | S, G, R |
| 16a | copper | `...` / `c#i` / `...` | `xxxo` right end (seam to iron) | (12,0) (12,1) (12,2) | (216, 0, 16, 16) | G, R |
| 16b | iron (6), the E neighbour of 16a | `...` / `c#i` / `...` | `xoxx` left end | (9,0) (9,1) (9,2) | (162, 0, 16, 16) | G, R |
| 17 | copper | `sss` / `s#s` / `sss` | `xxxx` outlined ore in stone | (9,3) (10,3) (11,3) | (162, 54, 16, 16) | G, R |
| 18 | dirt, shape 2 (top-right cut) | `...` / `d#.` / `dd.` | N and E cut → `xxoo` top-right corner | (1,3) (3,3) (5,3) | (18, 54, 16, 16) | R |
| 19 | dirt, shape 1 (half) | `...` / `d#d` / `...` | N cut → `xoxo` horizontal middle | (6,4) (7,4) (8,4) | (108, 72, 16, 16) | R |

Example 8 shows how merging is asymmetric. In the same dirt/stone pair, dirt draws a seamless interior and stone
draws the dirt rim. Example 14 shows the other side of that boundary. Stone has no cell for rims on N and E, so it
falls back to a full outline. The dirt tile to its E then closes its own W edge, and both sides draw an outline
instead of an open edge meeting an outline. Examples 6 and 7 are inner corners, where empty diagonals meet a solid
mass; in example 7 all four diagonals are empty and the game draws the NW+NE notches.

### Grass and moss sheets

**Ids.** The 10 grass ids (2, 23, 60, 70, 109, 199, 477, 492, 661, 662) and the 21 moss ids (see "Which tiles are
framed at runtime"). Grass grows on its partner: dirt for 2, 23, 109, 199, 477, 492, mud for 60, 70, 661 and 662 (R:
jungle grass, corrupt and crimson jungle grass on mud frame **identically** to grass on dirt in all 6 561
neighbourhoods; on dirt they do not). Moss frames identically beside stone and beside dirt (R).

**Layout (S).** Grass and moss sheets have **22 rows**. All 10 grass sheets and the 11 moss *blocks* have
non-empty cells at the **same 252 positions**. The 10 moss *bricks* lack 30 of them: (8–10, 5–10), (11–13, 15–16)
and (8–13, 17). Rows 0–14 hold 174 cells: 147 of stone's 183 positions, without the single rims next to air
(13–15, 0–3), the rim corners (0–1, 5–10) and the three-rim looks (11–12, 5–10), plus 27 cells at (7–15, 12–14), where
every cell is outlined grass without partner art. Rows 15–21 hold 78 more cells; by their side codes they carry the
moved looks (single rims next to air in rows 18–21, six cells each; three-rim looks in (11–13, 15–16) and (8–13, 17);
interior looks with rim corners in (6–8, 18–21)) and grass looks that combine air on one side with partner on the
other three ((0–4, 15–17)). The extra **88 rows** of `Tiles_2` (rows 22–109) are four further 22-row blocks of pure
white pixels (`255,255,255,255`) at a subset of the 252 positions (183, 251, 252 and 252 cells); framing never selects
them (R), and what draws them is open (O9).

Sheet map of `Tiles_2` (`--tile 2 --partner-near 0 --rows 22`: dirt's colours without its outline, matched within
8 per channel, because grass draws dirt in lighting variants such as `150,107,76` for dirt's `151,107,75`):

```text
       0    1    2    3    4    5    6    7    8    9   10   11   12   13   14   15
  0  xddx xodo xodo xodo xxod oxox xxox xxox xxox xoxx ddoo oood xxxo ---- ---- ----
  1  odox dddd dddd dddd oxod oxox oodd oodo oodo xoxx odoo oood xxxo ---- ---- ----
  2  odxx doxo doxo doxo dxxd oxox dood dooo dooo xoxx odoo oodd xxxo ---- ---- ----
  3  xddx xxdd xddx xxdd xddx xxdd oxxx oxxx oxxx xxxx xxxx xxxx ---- ---- ---- ----
  4  ddxx dxxd ddxx dxxd ddxx dxxd xoxo xoxo xoxo ---- ---- ---- ---- ---- ---- ----
  5  ---- ---- dddd dddd xddx xxdd xxdx oxdx dodo dodo dodo ---- ---- ---- ---- ----
  6  ---- ---- dddd dddd oddx oxdd xxdx oxdx dodo dodo dodo ---- ---- ---- ---- ----
  7  ---- ---- dddd dddd oddx oxdd xxdx oxdx odod odod dddd ---- ---- ---- ---- ----
  8  ---- ---- dddd dddd ddox dxod dxxx dxox odod odod odod ---- ---- ---- ---- ----
  9  ---- ---- dodd ddod ddxx dxxd dxxx dxox odod odod odod ---- ---- ---- ---- ----
 10  ---- ---- oddd dddo ddox dxod dxxx dxox dddd dodo dodo ---- ---- ---- ---- ----
 11  xxdd xodd xodd xddo xddx xddo dddd dddd dddd xdxd xdxd xdxd ---- ---- ---- ----
 12  dxxd doxd doxd ddxo ddxx ddxo dxdx xoox xooo xxoo xoox xooo xxoo xoox xooo xxoo
 13  xxxd xxxd xxxd xdxx xdxx xdxx dxdx ooox oooo oxoo ooox oooo oxoo ooox oooo oxoo
 14  xoxd xoxd xoxd xdxo xdxo xdxo dxdx ooxx ooxo oxxo ooxx ooxo oxxo ooxx ooxo oxxo
 15  dddx dxdd xddd xddd xddd xoox xoox xoox xxoo xxoo xxoo ddod ddod ddod ---- ----
 16  dddx dxdd ddxd ddxd ddxd ooxx ooxx ooxx oxxo oxxo oxxo oddd oddd oddd ---- ----
 17  dddx dxdd oooo oooo oooo oooo oooo oooo dodd dodd dodd dddo dddo dddo ---- ----
 18  xodo xodo xodo xodo xodo xodo oodo oddo oddo ---- ---- ---- ---- ---- ---- ----
 19  doxo doxo doxo doxo doxo doxo dooo ddoo ddoo ---- ---- ---- ---- ---- ---- ----
 20  odox odox odox odox odox odox oodd oodd oodo ---- ---- ---- ---- ---- ---- ----
 21  oxod oxod oxod oxod oxod oxod dood dood dooo ---- ---- ---- ---- ---- ---- ----
```

Here `o` is grass reaching the edge, `d` partner (dirt) reaching the edge and `x` closed. The `x` letters are
reliable; `o` against `d` is not, because grass art puts a grass strip along every face that meets air and dirt
everywhere else. The art therefore confirms one shared grass layout but gives no rule for choosing among it.

**Selection (R).** The game's grass selection is the **framing database**: every grass type's table against its
partner and against every other type, over all 6 561 neighbourhoods. It does not reduce to the block rules: grass and
moss use rows 15–21 and the cells at (7–15, 12–14), and moss differs from grass beside its partner in 3 811 of the
6 561 neighbourhoods. An implementation selects grass and moss cells from the database (or reproduces it exactly).

**Worked examples (R).** `#` = grass centre (`Tiles_2`), `g` grass, `d` dirt, `s` stone, `.` air; rows N to S;
variant 0 at `x = y = 0`. "Measured look" is the side code of the v0 cell in the map above.

| # | Neighbourhood | Cells v0 / v1 / v2 | Source rectangle (v0) | Measured look | Note |
|---|---|---|---|---|---|
| G1 | `...` / `g#g` / `ddd` | (1,0) (2,0) (3,0) | (18, 0, 16, 16) | `xodo` | flat surface on dirt |
| G2 | `...` / `d#g` / `ddd` | (0,11) (1,11) (2,11) | (0, 198, 16, 16) | `xxdd` | the grass strip ends at the dirt to the W |
| G3 | `...` / `.#.` / `.d.` | (6,5) (6,6) (6,7) | (108, 90, 16, 16) | `xxdx` | single grass tile on dirt |
| G4 | `...` / `.#g` / `.dd` | (0,3) (2,3) (4,3) | (0, 54, 16, 16) | `xddx` | hill top-left |
| G5 | `ddd` / `g#g` / `...` | (1,2) (2,2) (3,2) | (18, 36, 16, 16) | `doxo` | grass on a ceiling |
| G6 | `ddd` / `d#d` / `ddd` | (1,1) (2,1) (3,1) | (18, 18, 16, 16) | `dddd` | buried: drawn as dirt with grass specks |
| G7 | `ggg` / `g#g` / `ggg` | (1,1) (2,1) (3,1) | (18, 18, 16, 16) | `dddd` | no face meets air: same cell as G6 (at even `x + y`, "Variant") |
| G8 | `gg.` / `g#g` / `ggg` | (2,6) (2,8) (2,10) | (36, 108, 16, 16) | `dddd`, corner NE `x` | one diagonal open |
| G9 | `.d.` / `.#g` / `.d.` | (0,15) (0,16) (0,17) | (0, 270, 16, 16) | `dddx` | air W, dirt N and S |
| G9-stone | `.s.` / `.#g` / `.s.` | (7,13) (10,13) (13,13) | (126, 234, 16, 16) | `ooox` | stone N and S: a grass-only cell |

**Moss (R).** Green moss (179) takes cells from rows 15–21 in 1 840 of the 6 561 neighbourhoods with stone, the same
beside stone and beside dirt. Its selection is its own (neither the block rule nor grass's); the database holds it.

### Human steps (in-game check, G)

Generate a disposable observation world from an unchanged vanilla corpus fixture. Prepare `local-renders/`
(gitignored), then run this command from the repository root:

```bash
dotnet run --project dotnet/Terraria.WorldCodec.Synthetic -- generate packages/test-fixtures/worlds/SJCO1.wld local-renders/framing-observations.wld
```

It writes a new `.wld` and `.wld.manifest.json`, refuses either existing output path, and accepts only corpus
paths whose bytes match `packages/test-fixtures/worlds/manifest.json`. It never edits the base. Do not commit
either output. Copy only the generated world to a new file in Terraria's local Worlds directory for the game
check; retain the original generated copy beside its manifest. It appears as **TMS Framing Tests #158 v3 Frozen** in
the world picker and has a deterministic world ID and GUID distinct from the base. The mode and opaque
sections are preserved except for time freezing (choose `SJCO1` for Journey mode). The generator sets
creative power 0 to `true` in section 10 ([format contract](file-format/entities.md#section-10--creative-journey-powers)),
preserving all other power values. The manifest records `timeFrozen: true`; tests reload the output and
check the stored setting. Use a disposable game copy and avoid replacing
any player world.

The cases are already stamped onto a flat stone terrace near the horizontal centre, at `height / 8` in the sky.
**You spawn directly on its stone floor; walk right to inspect the cases above you. No flight is needed.**
The default catalogue uses compact panels of several rows, all within 30 tiles above the floor. Three tiles of
headroom stay clear across the entire walking route. The manifest includes the menu name and spawn coordinates.
Sections run left to right; their numbers and names are in `sections` in the manifest. Each starts with a
gray-brick (38) column, `section number + 1` tiles tall. Cases are packed in catalogue order, with at least
two tiles of air between patterns and between a pattern and a marker or floor. Panel width is derived from
the total pattern area; individual patterns keep their original neighbourhoods. Extended catalogues use the
same packing rule and may need their own access arrangements if their panels exceed the default height.
The manifest gives each pattern's top-left `x,y`, dimensions, title and expected look/cells or `to observe`.
In patterns that contain `#`, that character identifies the focus tile; for the three-row worked examples it
is on the middle row. Both tiles of examples 8, 14 and 16 have separate cases and enough surrounding mass to
preserve the paired tile's own neighbourhood.

Find a case by its manifest ID (`B14a`, `G9`, `H3-shape2`, etc.) and print all its tiles:

```bash
dotnet run --project dotnet/Terraria.WorldInspector -- case local-renders/framing-observations.wld local-renders/framing-observations.wld.manifest.json B14a
```

The inspector checks the output hash, then prints types, shapes and frames at the manifest coordinates.
After Terraria saves the disposable copy, pass `--allow-changed-world` to inspect that copy with the original
manifest: the report explicitly notes the changed hash. Case coordinates still have to lie inside the world.
Screenshots go to `local-renders/`. The generator does not run the game or judge the observations (#120).

The data catalogue is `dotnet/Terraria.WorldCodec.Synthetic/framing-cases.json`: one entry per case, with
section, ID, title, character rows, legend and expected result. Legend cells accept vanilla `block`, `wall`,
numeric `shape` and optional `frameX`/`frameY`. Add an entry to add a case or section, without changing the
layout. `--catalogue <cases.json>` selects an extended catalogue; additional observation templates in
`AdditionalFramingCases.cs` and the map-option cases are appended automatically.

The v3 catalogue adds coralstone in dirt, at a boundary and in isolation; all 28 missing rim side codes;
full dirt next to shapes 1–5 on each cardinal side; opposite, three and four missing diagonals for dirt
and stone; and moss against stone on three sides, at a corner and in a pillar. These cases have observation
questions rather than fabricated expected game frames. Their IDs, coordinates and questions are in the manifest.
For variant stability, take a screenshot at a fixed standing position, save/reload twice and repeat it.
For map options, also capture the fullscreen game map. Keep Journey's time-freeze power enabled during
observations. [Plant updates](https://terraria.wiki.gg/wiki/Plants) are suspended while Journey time is frozen;
the generator stores the power before the first load. It does not prevent player edits or validate unsupported
isolated multi-tile objects. Compare any game-saved copy with the original manifest before treating it as intact.

- **Map options (#138)** Compare the generated **Map options** section in the game map and the viewer: gems
  (178), herbs (82–84), pots (28) and chests (21) each have exactly one isolated tile per option reachable by
  the shipped `tileOptions` rules, using a selecting frame. The section also has one tile for every content
  listed as depending on more than one frame axis or on position; the viewer keeps those at option 0. The
  manifest names the expected option. Pot **option 7 is pending the palette fix [#195](https://github.com/tomasz-goralski-i4b/terraria-map-browser/issues/195)**:
  no observed frame currently selects it, so there is no fabricated tile. It appears under `unreachableOptions`
  as tile 28, option 7, reason `no observed frame selects it`. Regenerating the palette with a selecting rule
  adds that case automatically and removes the unreachable entry. Until #195 is fixed, the generated pot
  option-8 case uses the observed `frameY=792`; larger pot frames are outside the current observed range.

- **H1** Inspect the generated **Blocks** cases `B1`–`B19` (Journey mode, 1:1 zoom, full lighting) and save.
  Read the tiles with `Terraria.WorldInspector`, take a screenshot, and compare each listed tile with its
  look (outline / open / rim per side). A look can be compared without knowing the variant.
- **H2** Save and reload the world twice. Note whether the variants of the same tiles change (random per load) or
  stay the same (seeded).
- **H3** Inspect **Shapes** cases `H3-shape1`–`H3-shape5`, each already shaped inside a dirt mass. Check whether
  its full neighbours draw an outline toward the cut faces (O5), and that the inspector's shape matches the
  "Cut corner" column.
- **H4** Inspect **Ores** cases `H4-15`, `H4-16a`, `H4-17`: copper surrounded by dirt (full rim or rim corner
  only?), copper next to iron (seam or no seam?), copper inside stone (outline?).
- **H5** Inspect **Rim fallback** cases `H5-14a`/`H5-14b`, **both tiles**: stone with dirt only to its N and E.
  Record whether stone draws an outline or a partial rim, and whether the dirt tile to its E draws an edge
  toward stone. Repeat with `H5-8a`/`H5-8b` for the case where the rim exists.
- **H6** Inspect **Diagonal hole** cases `H6-NW`, `H6-NE`, `H6-SE`, `H6-SW`: a dirt mass with a single one-tile
  hole at a diagonal of one dirt tile (all four edges dirt, one corner empty), once per corner. Record whether
  that tile shows a small notch in the corner (O7) or a plain interior.
- **H7** Inspect **Grass** examples `G1`–`G9` on dirt and `G9-stone` on stone.
  Identify each drawn cell by comparing its outline and grass/dirt split with the sheet cells, then compare
  it with the expected cells.
- **H8** Inspect **Moss** cases `H8-surface`, `H8-pillar`, `H8-hole`, `H8-boundary`: green moss on stone with
  an open surface, a single-tile pillar, a one-tile hole and a stone/dirt boundary. Record whether the drawn
  cells come from rows 15–21 of `Tiles_179` (grass rules) or only rows 0–14 (block rules) (O8).
- **H9** Inspect **Large frame** cases `H9-slab`/`H9-luminite`, each a 6 × 8 area: stone slab (273, type 1)
  and luminite brick (409, type 2). For every interior tile, record which of the six interior cells
  ((1,1) (2,1) (3,1) (1,6) (2,6) (3,6)) it shows. Write the pattern by world `x mod 3, y mod 4` (type 1)
  or `x mod 2, y mod 2` (type 2) (O4).
- **H10** Inspect **Jungle grass** cases `H10-corrupt`/`H10-crimson`, already placed on mud next to dirt. Record whether
  the brown under the grass is mud and whether a dirt neighbour is drawn as partner (O10).

### Observation results (2026-10-08)

The human supplied five game screenshots (`20261008202752_1.jpg`, `20261008202757_1.jpg`,
`20261008202807_1.jpg`, `20261008202820_1.jpg`, `20261008202827_1.jpg`) and three cropped PNGs
(`Screenshot 2026-10-08 202857.png`, `Screenshot 2026-10-08 202929.png`,
`Screenshot 2026-10-08 202946.png`). They cover the ten numbered sections of the generated v2 world.
The source files remain outside the repository. Texture comparisons use the local game's sheet art decoded
with `packages/assets`, not game code. JPEG colour error and duplicate sheet cells prevent some exact frame identifications.

The pristine generated world was compared read-only with its disposable game save, using inspector
`export-json` regions covering the whole cleared strip (`1838,150,256,16`, `2094,150,256,16`,
`2350,150,12,16`). The save is later than the screenshots, so its changes identify affected cases but do not
date each change relative to each screenshot. The comparison found exactly 23 changed positions in the strip:

- 11 dirt blocks became grass in G1 (3), G2 (4), G4 (2), and G9 (2).
- The bottom stone of H8-pillar became green moss; four mud blocks became corrupt/crimson jungle grass,
  two in each H10 case.
- Five previously empty positions gained vegetation: three vines, one plant, and one immature herb.
- `Map-block-82-option-2` and `Map-block-518-fallback` became air. The save cannot identify the cause.

All other positions in the strip retain their generated tile fields, including all Blocks, Shapes, Ores,
Rim fallback, Diagonal hole, and Large frame patterns. This validates their input neighbourhoods after play.
The grass, moss and jungle cases above must not be treated as unchanged copies of the manifest.

| Question | Evidence and conclusion | Remaining limit |
|---|---|---|
| O1 / H2, reload variants | One traversal, without a matched before/after reload pair. | Random versus seeded variants remains open. |
| O2 / H4, ore neighbours | Copper in dirt matches full-rim cell (6,11); copper in stone matches outlined cell (9,3). Copper beside iron has a visible seam. | Confirms the selected cases, not every ore pair. The small copper fleck in dirt is the centre of a full dirt rim, not a missing ore tile. |
| O3 / H5, missing rim | H5-14a stone matches outline (9,3), its duplicate matches (10,3), and the dirt east of it matches a closed-west cell (4,4). The valid boundary examples retain the stone west rim, matching (9,9) and (9,8). | The `ddxx` fallback and its dirt edge check are observed; the other 27 missing side codes and corner priorities are not. |
| O4 / H9, large frames | Both 6 × 8 panels load intact and show spatial texture patterns. | A complete coordinate-to-cell rule for either type, and its applicability to the other 22 ids, is not established. Do not assign six interior cell indices from appearance alone. |
| O5 / H3, shape neighbours | Full neighbours draw an edge toward the missing portion of the centre. For example, the north neighbour of the half block and of shape 2 matches (6,4), with its south edge closed; the east neighbour of shape 2 matches (5,1), with its west edge closed. | Treating every shaped neighbour as full is contradicted. The complete partial-face/diagonal algorithm remains open. |
| O6, exceptional layouts | No coralstone case is present. | Coralstone remains open; moss is limited to H8 below. |
| O7 / H6, missing dirt diagonal | The unobscured NE, SE and SW centres look like plain interiors; SW best matches (1,1). | JPEG comparisons are close for several cells; a damage number obscures NW. Supports the plain-interior choice but does not prove all four exact frames. |
| O8 / H8, moss framing | Stone bodies and green exposed edges. Several clear moss cells match rows 0–14: surface (3,0), pillar middle (5,1), hole neighbours (2,2), (4,2), (0,1). | No uniquely identified row 15–21 cell is demonstrated. Low-row matches do not prove the selection algorithm or that higher rows are unused; H8-pillar also changed during play. |
| O9, white grass masks | These rows were not exercised. | Remains outside the observation scope. |
| O10 / H10, jungle grass partner | Both jungle grass types spread into the supplied mud; adjacent dirt stays dirt. The screenshot shows a boundary toward that dirt. | Mud is confirmed as the growth substrate. Growth does not prove the complete sprite merge-partner rule, and both patterns changed. |

The unchanged grass cases visibly cover a narrow pillar (G3), a green ceiling edge (G5), a buried green
centre (G6), an all-grass mass (G7), and a missing diagonal (G8). These provide qualitative checks, not
exact sheet-cell assertions. G9-stone keeps its original pattern but gained a herb just outside it.

The Map options section contains individual tiles with synthetic stored frames, including fragments of
multi-tile sprites. It is not an in-game map screenshot, and partial pots or chests are not evidence of
malformed `.wld` records. These images do not validate map colours or make pot option 7 reachable.
Two map cases are absent from the final game save, so it is not a complete surviving catalogue.

### Frozen-world results

The next traversal supplied `Screenshot 2026-10-08 205952.png`, `210032.png`, `210054.png` and
`210106.png` (the latter names share the same `Screenshot 2026-10-08 ` prefix). They show the compact
v3 Frozen catalogue: 12 sections and 174 cases. The 21:01:10 game save retains creative power 0 as
`true`. Read-only inspector comparisons cover all **9,912 tiles** of the 354 × 28 cleared strip and
find **zero changed tile fields**. All grass, moss, jungle and map-option input patterns survived this
session. This confirms the intended effect of the stored time-freeze setting for this traversal.

Frame comparisons use the locally decoded sheet art and compensate for screenshot zoom and lighting.
Nearest texture matches are evidence of appearance, not a way to recover distinct frame coordinates when
several sheet cells have identical pixels. No game assets or screenshots are committed.

| Observation | Result |
|---|---|
| Missing rims, O3 | All 28 `Rim-missing-*` focus tiles best match cells with side code equal to their input code with every `d` replaced by `x`. Existing `o` sides stay connected. This confirms the documented fallback for all 28 side codes in the generated empty-diagonal contexts. |
| Corner priority, O3 | With four missing diagonals, dirt matches (7,1) and stone also matches (7,1): **NW+NE notches**, not the previously cited SE+SW preference. The three-hole cases (NW, NE, SW absent) also match NW+NE, at (7,1) for dirt and (8,1) for stone. Opposite-hole cases match plain interiors, (1,1) for dirt and (3,1) for stone. Other rotations of three holes and mixed rim/notch priorities remain unobserved. |
| One missing dirt diagonal, O7 | The clear NW, SE and SW centres support plain interiors. The NE texture match remains ambiguous after screenshot scaling; do not claim four independently identified frame cells. |
| Moss, O8 | The three new moss-against-stone cases match (1,2), (0,3), (5,1), respectively. These are the ordinary bottom edge, corner and vertical-column positions over rows 0–14, supporting the stone-family approximation for green moss in these contexts. No uniquely identified row 15–21 look is demonstrated; this does not prove such rows are never used by any moss. |
| Jungle grass, O10 | Both unchanged cases connect to the supplied mud below and show a closed edge toward dirt on the left; the grass focus best matches (4,3) for both 661 and 662. This supports **mud as the sprite merge partner**, in addition to the earlier growth evidence. |
| Coralstone, O6 | The dirt pocket suppresses the bright coral art at the enclosed centre; exposed boundary cells and the isolated tile show coloured coral. The isolated tile matches (10,3). Several enclosed cells are pixel-identical, so their exact frame/rim selection remains unresolved. |
| Shapes, O5 | The expanded centre/neighbor-shape patterns remain intact and show that cut faces affect surrounding artwork. The complete half-face and diagonal algorithm still needs derivation; the shape-independent renderer approximation is unchanged. |
| Map options | Every generated case survives the frozen traversal. The PNG shows sprites, not the fullscreen game map, so map colour agreement remains unverified. Pot option 7 remains the separate palette issue #195. |
| Reloads and large frames, O1/O4 | Stable input panels are now available. These four screenshots still do not provide a matched reload pair or a complete unambiguous coordinate-to-frame pattern. |

### Runtime observation results (2026-10-09)

Evidence R ([ADR 0003](adr/0003-observe-framing-in-the-game.md)). Pipeline, all local, nothing committed:

```bash
dotnet run --project dotnet/Terraria.WorldCodec.Synthetic -- generate packages/test-fixtures/worlds/SJCO1.wld local-renders/framing-observations.wld
node scripts/framing/export-cases.mjs local-renders/framing-observations.wld local-renders/framing-observations.wld.manifest.json local-renders/framing-cases.json
```

```powershell
./scripts/framing/observe.ps1 -TerrariaAssembly '<Terraria>/TerrariaServer.exe' -CasesPath local-renders/framing-cases.json -OutputPath local-renders/framing-observed.json
node scripts/framing/analyse.mjs local-renders/framing-observed.json local-renders/framing-cases.json local-renders/framing-report.md
```

The observer initializes the game's tile data with the game's own initialization, checks two sentinels (a dirt
interior frames at (1,1); stone beside dirt draws a dirt rim) and then records, for Terraria 1.4.5.8 on L:

- **Every catalogue case** of the generated world (116 cases outside the map options), all three variants of every
  tile. All worked examples 1–19 match their documented cells (example 7 as corrected to NW+NE).
- **Every 3 × 3 neighbourhood** (air, the centre's type or one other type on each of the 8 neighbours; 6 561 per pair)
  of 17 pairs: dirt/stone, stone/dirt, dirt/copper, copper/dirt, copper/stone, copper/iron, ash/hellstone,
  hellstone/ash, coralstone/dirt, coralstone/stone, moss/stone, moss/dirt, grass/dirt, jungle grass/mud, corrupt
  jungle grass/mud and /dirt, crimson jungle grass/mud.
- **Every side-shape combination** of a dirt centre (14 406), and **every block type's slab** at two origins and two
  variants (large frames).
- **Variants:** 90 frames with reset and 30 without.

Framing in two passes, in one pass, and with the game's own range framing (`WorldGen.RangeFrame`) gives identical
cells, so the results do not depend on the framing order.

#### The framing database

`observe.ps1 -Mode Database` (in parallel shards, about 15 minutes) records, for every one of the **333 self-framed
block types** and every other one, all 6 561 neighbourhoods of the pair, each type's variant map, the tables by
position of the position-dependent types, every **wall** type, and every shaped-corner combination. Verification is
part of the run: pairs are grouped by 64 probe neighbourhoods, every grouped pair gets its full table, every pair
treated like air or like itself is checked on 200 further neighbourhoods, and one of each in full; a run with any
failure is refused. The game keeps some state between frames: for a few sand-type neighbourhoods (about 0.07 % of
samples) the first frame after other tiles differs from every repeat, so each neighbourhood is framed twice and the
second, steady result is recorded. `scripts/framing/export-database.mjs` merges the shards, checks the shaped-corner rule over all
5.9 million combinations, and writes `packages/renderer/src/framing/terraria-framing.generated.ts` (86 KiB: 53
distinct tables, raw-deflated; the relation of every pair; the variant maps). `loadFramingDatabase` reads it;
`packages/renderer/tests/framing-database.test.ts` checks the worked examples against it in CI, without the game.

| Question | Answer (R) |
|---|---|
| O1 variants | Random on every framed load, remembered only in memory ("Variant"). Exact reproduction is impossible; `(7x + 11y) mod 3` stays. |
| O2 ore neighbours | Rules 3 and 5 hold over every neighbourhood ("Neighbour classes"). |
| O3 fallback and corners | The 28 fallback codes are exact; the corner order holds with rim NE before rim NW ("Choosing the cell"). |
| O4 large frames | 24 ids, position patterns 3 × 4 and 2 × 2, variant ignored ("Variant"). |
| O5 shapes | The face rule, 14 406 of 14 406 ("Slopes and half blocks"). Shaped corner neighbours not observed. |
| O6 coralstone | Frames identically to stone against dirt (rims) and against stone. |
| O7 one missing diagonal | Plain interior for each of the four corners, for dirt and stone. |
| O8 moss | Uses rows 15–21; same with stone or dirt around; own selection, not the grass rule ("Grass and moss sheets"). |
| O10 jungle grasses | Mud is the partner; identical to grass on dirt. |
| Grass examples | G1, G4–G8 match; G2, G3, G9 corrected. |
| Shaped corners | A corner neighbour counts by presence, whatever its shape (5 944 704 of 5 944 704). |
| Merging | Per pair: like air, like itself, as partner or as relative (database). |
| Walls | Any wall counts as a neighbour, never the diagonals; the blocks 54, 328, 459, 748 count too; variants random except 22 large-frame walls ("Walls"). |

`scripts/framing/observe.test.mjs` (opt-in, `TERRARIA_ASSEMBLY`) re-runs the pipeline and checks these statements
against a local installation.

### Not covered (deferred)

Non-block self-framed ids (cactus, vines, beams, columns, …), the white mask blocks of `Tiles_2` (O9), modded tiles,
tile animation, paint and lighting. Neighbourhoods of three or more types at once are covered by the rules, not by
tables (see "Neighbour classes").

### Open questions

Every question of the earlier lists is answered by the [runtime observation](#runtime-observation-results-2026-10-09) (R):
O1 (variants are random per load), O2 (merging, per pair in the database), O3 (fallback and corner order), O4 (large
frames), O5 (the face rule and the corner rule), O6 (coralstone frames like stone), O7 (one missing diagonal keeps
the plain interior), O8 (moss: its own selection, in the database) and O10 (mud is the jungle grasses' partner).
What stays open:

- **O9** `Tiles_2` rows 22–109 (white mask blocks): framing never selects them; what draws them is out of scope until a
  feature needs it.
- **Drawing shaped tiles**: how the chosen cell is cut into a slope or half block (the sprite-mode follow-up).
- **Mixed neighbourhoods**: three or more types around one centre follow the per-pair letters by the rules above;
  the observer can check any such neighbourhood on demand, but the database tabulates pairs only.

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
| TEdit (A8, A11, A12) | C# | Ms-PL | yes | no | already a cited source for the `.wld` format; its texture loading goes through XNA |
| tModLoader | C# | MIT | yes (M7) | no | mod assets are M7 |

**Recommendation:** write both decoders (.NET and TS) **from this document**, with no dependency. The format subset
is small (one platform, one version, one reader, one surface format, 64 KiB LZX window, no E8), the two codecs must
report the same errors, and every candidate library either drags in a framework or brings a copyleft license. The
.NET implementation is the reference; the TS one is independent (ADR 0001). The TS decoder was implemented first
(#89); the .NET one is pending (#73) and must reproduce the same vectors and error kinds.

## Atlas

`buildSpriteAtlas(contentDir)` (`packages/assets`) decodes every `Images/Tiles_<id>.xnb`, `Images/Wall_<id>.xnb`,
`Images/Tree_Tops_<n>.xnb` and `Images/Tree_Branches_<n>.xnb` (kinds `tile`, `wall`, `treeTop`, `treeBranch`), and
`Shroom_Tops`, `WiresNew` and `Actuator` (kinds `shroomTop`, `wire`, `actuator`, each id 0) once (names matched
case-insensitively; `Wall_Outline`, `Tiles_<id>_<n>` variants and everything else are ignored) and packs them into
square RGBA pages, 4096 × 4096 by default. Format 5 added the tree, cap, wire and actuator sheets. It runs in a Worker (`atlas-worker.ts`) and never
touches the network; the Worker reports the number of `fetch` calls it saw (always 0).

- **Packing:** shelf packing, tallest sheet first, with 2 transparent pixels of padding around every sheet so
  sampling never bleeds into a neighbour, and every sheet at an even pixel (format 4): the renderer's half-resolution
  atlas averages 2 × 2 pixels from even positions, and every cell, gutter and shape column of a sheet starts at an even
  pixel of it, so no half-resolution texel mixes a cell with its gutter. A sheet that does not fit an empty page
  (including padding) is rejected with `AtlasSheetTooLargeError`.
- **Index:** `(kind, id) → { page, x, y, width, height, frameWidth, frameHeight, gapX, gapY }`: the per-sheet frame and gutter
  of "Sprite layout" (default tiles 16×16 / 2, walls 32×32 / 4, tree tops 80×80 / 2 (other sizes come from the foliage
  table, "Trees"), branches 40×40 / 2, mushroom caps 60×42 / 2, wires 16×16 / 2, the actuator 16×16 / 0; the 56 tile ids whose grid or gutter differs from the default — e.g. tile 4
  20×20, tile 3 and 24 16×20, tile 15 gutter 2×4, tiles 751/752 18×18 with no gutter — carry their own values, restated from A12's
  per-id `textureGrid`/`frameGap`; all others the default), the family defaults, the page size, padding and `ATLAS_FORMAT_VERSION`.
- **Cache:** the origin private file system, one directory per fingerprint holding `page-<n>.rgba` (raw RGBA) and
  `index.json`, written last so an entry without it is never read. The fingerprint hashes the name, size and
  last-modified time of every matched sheet plus the format version; storing a new entry removes the old ones. A build
  with an unchanged fingerprint decodes no `.xnb`; any changed, added or removed sheet rebuilds.
- **Progress and cancellation:** `scan`, `decode` (one event per sheet), `pack` and `store` events; aborting (also during the cache
  write) rejects with an `AbortError` and removes the uncommitted entry, so no partial cache entry exists.
- **Connecting the folder (`apps/web/src/assets/asset-session.ts`):** *Connect Terraria assets* opens
  `showDirectoryPicker` (read). The handle is kept in IndexedDB; on the next visit the atlas is rebuilt (normally a
  cache hit) without a prompt while permission is still granted, a *reconnect* button is offered when the browser wants
  to ask again, and a refused or revoked permission silently forgets the folder. `<input webkitdirectory>` (*Select
  folder*) is the fallback where there is no directory picker, and is also offered next to it: Chrome's picker refuses
  folders it counts as system folders ("contains system files"), which includes everything under `Program Files`,
  Steam's default install location. `filesToContentDirectory` reads the files directly inside the picked folder's
  `Images` folder (or the picked folder itself). That input gives no handle, so only the atlas fingerprint is
  remembered; the next visit loads the atlas from the cache by fingerprint (Worker `load` request) and forgets it
  silently when it is no longer cached. A folder with no
  `Tiles_<id>`/`Wall_<id>` sheet is reported as the wrong folder and forgotten. The Worker transfers the atlas pages
  to the main thread (on one 1.4.5.8 install: 754 tile and 366 wall sheets on 6 pages of 4096², ~7 s cold).
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
5. **Hand-assembled aligned matches:** an uncompressed prefix containing the header and 64 distinct pixel bytes,
   then an aligned block with one four-byte match. Use aligned-tree lengths `[2, 2, 3, 3, 4, 4, 4, 4]`: symbol 5
   has code `1101`, so reading three raw bits cannot substitute for Huffman decoding. Slot 8 has exactly three
   extra bits and offset `16 − 2 + 5 = 19`; slot 10 has four extra bits, verbatim high bit 1 and offset
   `32 − 2 + (1 << 3) + 5 = 43`. Assert fixed RGBA bytes copied from different positions in the prefix. These
   cases run in CI without game content or a compressor; broader real-content coverage remains opt-in.
6. **Negative vectors:** bad magic, platform ≠ `w`, version ≠ 5, unknown flag bit, file-size mismatch, truncated
   header, truncated chunk, block type 0 or 4–7, E8 flag set, frame total ≠ decompressed size, wrong reader name,
   surface format ≠ 0, data length ≠ `w × h × 4`, trailing bytes. Each gets a precise error (`XnbErrorKind` in
   `packages/assets/src/xnb-error.ts`; the .NET decoder must report the same kinds).

Synthetic `.xnb` inputs are built in memory by test builders (`packages/assets/src/xnb-fixture.ts`); none are
committed. The .NET decoder (#73) must reproduce the same vectors.

### Opt-in integration test: `TERRARIA_CONTENT`

- `TERRARIA_CONTENT` = path to a local `Terraria/Content` directory. **CI never sets it**; when unset the tests are
  skipped (xUnit v3 `Assert.SkipUnless` / vitest `describe.skipIf`), and the skip is visible in the output.
- Assertions only, no output files: every `Tiles_0…753` and `Wall_1…366` (case-insensitive names) decodes; header
  file size = file length; frame total = decompressed size; reader = `Texture2DReader`, format 0, one level, data
  length = `w × h × 4`; `Tiles_0` is 288 × 270 and `Wall_1` 468 × 180.
- Sprite mode (#91): `apps/web/tests/terraria-sprites.browser.test.ts` builds an atlas of only the sheets the spawn area of
  `SCCO1.wld` needs (vitest browser command `buildLocalAtlas`, run on the Node side) and draws that area at 16 pixels
  per tile: every framed tile there has a sheet, sprites change the picture, and no pixel is the missing-texture
  checkerboard.
- Never write decoded pixels into the repository; renders made by hand go to `local-renders/` (gitignored).

## Editor thumbnails

Editor thumbnails (`apps/web/src/assets/thumbnails.ts`) use the same block and wall framing and source rectangles
as the chunk pass. Material thumbnails select one interior cell; Inspector thumbnails select the actual cell
from the world's neighbours or the stored, wrapped frame of frame-important blocks. Walls are always cropped to
their 16 × 16 centre. Pixels are copied directly from the atlas page, so no decoded sheet is allocated or retained.
Canvases store native cell pixels using `putImageData`; CSS `image-rendering: pixelated` fills the existing swatch
boxes without interpolating colours. Larger object cells are cropped to their top-left 16 × 16;
shorter cells retain their native height. Paint remains a corner mark.

## Open questions

1. The repository has no `LICENSE` file. The "Depend" column assumes we want to stay free of copyleft; a license
   decision would not change the recommendation.
2. Is Terraria's `Color` data premultiplied alpha (the XNA content pipeline default)? Affects blending, not decoding.
   Check visually in the opt-in test's manual follow-up.
3. Draw offsets for cells larger than 16 × 16 (torches 20 × 20, plants 16 × 20, …), per tile id.
4. Which walls use variant rows 5–6 of the wall table, given that `Wall_1` (468 × 180) has only rows 0–4.
5. Whether any file in a full install has the E8 flag set or uses a non-`0xFF` last chunk (L checked seven files;
   the opt-in test checks all).
6. Sprite objects (#238, #239, #241), not observable without the game's renderer: the direction of a palm's lean;
   which `WiresNew` rows 4–15 the game shows when; the layering of tree foliage against neighbouring blocks, liquids
   and wires; the draw order of a junction's two track pieces; `Tiles_5` block 2 (no ground produced it); the oasis
   palm rows. Each has a documented choice ("Minecart tracks", "Trees", "Wires").

Proposed follow-up issues: [planning/assets-follow-ups.md](planning/assets-follow-ups.md).
