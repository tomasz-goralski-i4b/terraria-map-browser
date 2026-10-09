# Renderer

Framework-free (never imports React) rendering of CWM planes. `renderChunk` below is the CPU
reference implementation; the interactive backend is WebGL2 (`MapRenderer`, #87), whose output must equal
`renderChunk` pixel for pixel. There is no Canvas2D backend.

## CPU reference: `renderChunk`

 `renderChunk(world, cx, cy, options)` returns
`{ width, height, pixels }`, with row-major straight-alpha RGBA bytes at one pixel per tile.
Chunk coordinates are indices of 128 × 128 regions; right and bottom edges are cropped.
Negative, non-integer or past-the-edge chunk indices throw a `RangeError`.
`options.surfaceY` and `options.rockY` are the world's surface and rock levels (`surfaceLevel`/`rockLevel` of the
world metadata, fractional): the sky is above `surfaceY`, the rock layer starts at `rockY`.
`options.layers` independently enables background, walls, blocks and liquids. `layers.wires` is a mask of the CWM
`flags` bits to show as the wire overlay (`WIRE_LAYER`: red, blue, green, yellow wire, actuator); absent or 0 shows
none.
`options.mapPalette` supplies map colours (see below); without it every block and wall uses its placeholder.

`createMapRenderer(canvas, options)` is the WebGL2 backend. At one pixel per tile and above it draws exactly the
pixels `renderChunk` produces for the same `mapPalette`; from the overview threshold up to one pixel per tile it draws
exactly the pixels `filterTiles` (below) makes of them. The browser tests assert both for every layer combination.

- **Chunk pages.** Chunks are cached in pages of 32. A page is two array textures, one per plane format, with one
  layer per plane and chunk: layer `slot × planes + plane`, where `slot` is the chunk's place in the page.
  - `R16UI`, 7 planes: block, wall, flags, frameX, frameY, and the framed block and wall cells of sprite mode
    (`PLANES_16` in `src/gpu/shaders.ts`). The shader masks the wire and actuator bits of `flags` and sign-extends the
    frames from their 16-bit pattern.
  - `R8UI`, 5 planes: liquid kind, liquid amount, block paint, wall paint, block shape (`PLANES_8`).

  32 chunks × 7 planes = 224 layers, within the 256 that WebGL2 guarantees (`MAX_ARRAY_TEXTURE_LAYERS`), with room
  for one more 16-bit plane. A page is about 9.8 MiB. A layer holds its chunk plus an apron of one tile of each
  neighbouring chunk (130 × 130 texels), stored transposed (texel (s, t) = tile (y, x)), so the box filter below can
  cross chunk edges. Absent optional planes (`flags`, `frameX`, `frameY`) are never uploaded: a uniform (`uPresent`)
  tells the shader to read them as 0. Switching the wire overlay is a uniform change.
- **Uploads straight from the planes.** A chunk upload reads no tile in JavaScript. CWM planes are column-major
  (`x × height + y`), so a chunk with its apron is a rectangle of a plane, and a transposed layer row is a world
  column. One `texSubImage3D` per present plane reads that rectangle in place: `UNPACK_ROW_LENGTH` = world height,
  `UNPACK_IMAGE_HEIGHT` = world width, `UNPACK_SKIP_ROWS` = the first column, `UNPACK_SKIP_PIXELS` = the first row,
  `UNPACK_ALIGNMENT` = 1. At the world's edges the apron is cut and the clipped rectangle is uploaded; texels outside
  the world are never read. The frame planes (`Int16Array`) are uploaded through `Uint16Array` views of the same
  memory. A frame issues one instanced draw call per page, not per chunk.
- **Map options on the GPU.** The frame → option rules of the map palette (`tileOptions`) are an `RGBA32I` texture:
  one header per palette index (first range, range count, axis, colour of option 0) and one texel per range (from,
  to, colour of its option). The shader applies `mapOption`'s rule per tile, the first range holding the frame
  winning, and option 0 otherwise. Content without a rule uses its palette colour. The headers are written with the
  palette colours, so building the tables is the only CPU work, once per palette entry.
- **Texture units.** The chunk pass binds the two page textures, the palette, the background and paint colours, the
  rules and the overview: 6 of the 16 that WebGL2 guarantees. With sprite mode's atlas pages and lookup the map uses 8. Creating the renderer fails with a clear error if the GPU offers fewer
  units or array layers than needed.
- **Adding a plane** (16-bit like the framed `cell`, or 8-bit like `shape`): add it to `PLANES_16` (or `PLANES_8`) in
  `src/gpu/shaders.ts`, add its source to `planesOf` in `src/gpu/map-renderer.ts` (with a `PRESENT` bit if it is
  optional), and read it in the shader with `plane16(texel, PLANES_16.<name>)`. It costs one more layer per chunk and
  one more `texSubImage3D` per chunk upload, not a new texture or texture unit. Check that `CHUNKS_PER_PAGE` × planes
  stays within 256.
- **Overview.** Below `1 / factor` pixels per tile (factor 2, larger only when the world exceeds
  `MAX_TEXTURE_SIZE`) the map is drawn from an overview: a mipmapped `RGBA8` texture with one texel per
  factor × factor tiles, built on the GPU from the chunk pages as the mean of those tiles (premultiplied, so
  mipmaps average transparency correctly). It is one draw call for the whole world and is filtered, so zoomed-out
  views do not shimmer while panning. Building it is subject to the same per-frame upload budget; texels never built
  stay clear. Its texels are built over the filter footprint around the viewport, not only the visible chunks.
- **Upload budget.** A scheduled frame uploads chunks until it has spent `maxUploadMillisecondsPerFrame` (default
  8 ms; it always uploads one) or reached `maxChunkUploadsPerFrame` (default 256), so a fast machine uploads more
  chunks per frame than a slow one and input stays responsive on both. `render()` ignores both limits. A chunk
  upload costs about 0.07–0.09 ms, nearly all of it in the `texSubImage3D` calls (about 6–9 µs each on an Intel
  Arc GPU, mostly per-call overhead, not bytes), so a frame uploads about 90 chunks: the time budget, not the count
  cap, still ends a frame's uploads, and the cap stays at 256.
- **Overview rebuild.** Layer changes and palette appends mark every texel stale without clearing it: old texels stay
  drawn until the rebuild overwrites them, so the map never blanks. The rebuild is a sweep in one fixed order: the
  visible chunks by distance from the centre of the view, then the rest of the filter footprint the same way. A frame
  builds the chunks in that order until one does not fit its upload budget, and stops there: a chunk that is still
  resident is never rebuilt ahead of the front, so the new view grows from the centre as one region. Mipmaps are
  regenerated after every batch. The cost of a layer toggle:
  - no upload at half a pixel per tile and above, or whenever the footprint's chunks are resident;
  - at overview zoom, for worlds larger than the chunk cache (Medium, Large and larger custom sizes), the sweep
    re-uploads evicted chunks within the upload budget. Measured on an Intel Arc GPU: a synthetic 16000 × 4000 world
    takes about 40 frames (100 when chunks were interleaved on the CPU), and a 16400 × 4800 modded world full of
    frame-selected content about 60 frames, 1 s (211 frames, 3.5 s before);
  - never a re-parse.

  A lost context loses the texture with everything else, so after a restore the overview is built from scratch.
- **Box filter below one pixel per tile.** Between the overview threshold and one pixel per tile the chunk pass does
  not point-sample one tile per pixel (that aliases: speckle and shimmer while panning). It averages the tiles the
  pixel covers, weighted by covered area, exactly as `filterTiles(tiles, camera, viewport)` does on the CPU:
  - the footprint is `1 / zoom` tiles per axis, capped at `MAX_FILTER_TILES` (2), with edges rounded to 1/64 tile
    (`FILTER_SUBTILE`); it covers at most 3 × 3 tiles;
  - the colour is the premultiplied mean of the in-world tiles under it (the overview build's rule), in unsigned
    integers rounded half up, so the GPU output equals the reference;
  - a pixel whose centre is outside the world is not drawn.

  At half a pixel per tile with an aligned camera a pixel is exactly an overview texel, so crossing the threshold
  changes the filter footprint, not the look. It costs nothing elsewhere: draw calls are unchanged, and at one pixel
  per tile and above (`uFilter` 0) the pass reads one tile per pixel, bit-exact with `renderChunk`. The canvas is not
  multisampled, so a pixel the world's edge crosses is not blended by coverage.
- **Chunk cache.** A chunk is needed in overview mode only until its texels are built, so zoomed-out views keep the
  baseline cache (512 chunks, about 160 MiB) however large the world is. At half a pixel per tile and above the
  cache grows to the visible set, which the viewport bounds. While chunks are still loading there, the overview is
  drawn under them instead of a hole; a complete frame is exact.
- **Sprite mode (#91).** `setAtlas(atlas)` uploads a sprite atlas (`@studio/assets`' `SpriteAtlas`, square RGBA8 pages)
  once, as one `RGBA8` array texture with a layer per page; `stats().atlasUploads` counts it. A lookup texture
  (`RGBA32I`, `SPRITE_SHEET_ROW` in `src/gpu/shaders.ts`) holds per palette index the tile sheet of its content ID
  (page, place, size, frame size) and the wall sheet of its wall ID (four texels per index), written with the palette,
  so it grows when the palette is appended; mod and unknown content and IDs without a sheet are *missing*, trees (`SPRITE_DEFERRED_TILES`: tree trunks, tops and
  branches are deferred, docs/assets.md) keep their map colour. A missing block with a stored frame is drawn as a
  generated missing-texture checkerboard (`MISSING_SPRITE_COLORS`, magenta and black, 2 × 2 squares per tile; not a
  game asset), so content without a sprite stands out; the web app lists it under the Sprites row. `setSpriteMode(true)` makes the chunk pass, from
  `SPRITE_MIN_ZOOM` (5) pixels per tile, draw a block that has a stored frame (`frameX`, `frameY` ≥ 0: frame-important
  tiles; the codec stores −1 for the others) and a sheet from that sheet: sprite pixel `sub` (0–15 per axis) of the tile
  reads sheet pixel `frame + sub × cell / 16`, so a cell larger than 16 × 16 is scaled into the tile (the game's exact
  draw offsets are deferred, docs/assets.md).
  - **Zoom (#146).** Sprites start at `SPRITE_MIN_ZOOM` (5 pixels per tile, 500 %) and fade in over the block's map
    colour until `SPRITE_FULL_ZOOM` (7.5, 750 %), by `spriteSampling(zoom).weight`, so crossing the threshold is not
    a jump. Below 16 pixels per tile a screen pixel covers more than one sprite pixel: it is the straight-alpha mean
    of `samples × samples` sprite pixels spread over its footprint (`16 / zoom` sprite pixels; 2 × 2 at 8–15, up to
    4 × 4 at 5), kept inside the tile's own cell so neighbouring cells never bleed in; from 16 pixels per tile it is
    one sprite pixel, as before. This is what keeps non-integer zooms (1377 %) from shimmering.
  - **Chunk borders.** Each chunk is its own quad; a pixel on the border can compute the tile just across it (the
    quad's edge and the pixel's position round apart). The pass then keeps the chunk's own tile and moves the sprite
    position to that tile's near edge, so the border never shows the far edge of a tile.

  Transparent sprite pixels show the wall, else the background, behind
  them; paint is not applied to sprites; liquids and wires still draw over them. A half-transparent sprite pixel with
  nothing behind it is the one partly transparent pixel liquids can land on outside map mode: there they use the
  general straight-alpha rule (`over` in `src/gpu/shaders.ts`, rounded to nearest); map mode stays bit-exact. Everything else, the box filter and
  the overview keep map colours. The mode is a uniform: switching it or crossing the threshold uploads no chunk planes and no atlas (the
  one exception is a resident chunk's cells, uploaded once on its first draw at a sprite zoom with a framing; see
  below). The
  atlas pages use 2 more texture units (8 in all).
- **Self-framed blocks in sprite mode (#146).** Blocks the `.wld` stores no frame for (dirt, stone, ores, sand, grass,
  moss, gemspark, large-frame blocks, …) take their cell from their neighbours. With `setFraming(createBlockFraming(db))`
  each chunk is framed by `frameRegion` (`src/framing/frame-block.ts`) on its first upload at a sprite zoom, never at
  map-colour zooms, reading its neighbours' tiles across the chunk border. `createChunkCellCache`
  (`src/framing/chunk-cells.ts`) keeps the result per chunk (one `Uint16Array`, `column · 64 + row` or `NO_CELL`,
  column-major) while the chunk stays resident, and the renderer uploads it as the 16-bit `cell` plane of the chunk's
  page; panning over resident chunks frames nothing (`stats().framedTiles`). A chunk uploaded at a map zoom gets its
  cells, one more upload, when sprites appear. Framing runs on the main thread, where the planes are, at about 5 ms
  per 128 × 128 chunk of mixed terrain (Node), so it counts against the upload time budget: a frame frames about one
  chunk, and a chunk whose cells did not fit yet still draws, its self-framed blocks in map colours (its instance
  lacks `CELLS_INSTANCE_BIT`). The CPU keeps 32 KiB of cells per framed resident chunk (16 MiB at the 512-chunk
  baseline). The chunk pass draws cell `(c, r)` from sheet pixels `(18c, 18r)`, cut
  by the tile's shape (the 8-bit `shape` plane) into the eight 2-pixel columns of `shapedColumns` (docs/assets.md,
  "Slopes and half blocks"); the cut-away part shows what lies behind. A block without a cell (a falling block with
  nothing below it, which the database marks unstable) keeps its map colour. `invalidateTiles(tiles)` is the editing
  entry point: it recomputes the cached cells of the `(2d + 3)²` area around each tile (`d` the deepest
  `BlockFraming.depth` within 6 tiles, so at most 13 × 13) and uploads the touched resident chunks again on their next
  draw.
- **Walls in sprite mode (#147).** The `.wld` stores no wall frame either. `createBlockFraming` also builds
  `walls` (`createWallFraming`, `src/framing/frame-wall.ts`): a wall's cell comes from its four side neighbours (any
  wall, or an active block of 54, 328, 459 or 748; a neighbour outside the world is absent), four counting sides take
  the interior cell of the position `(x mod 12, y mod 12)`, ordinary walls then vary by `(7x + 11y) mod 3` through the
  database's variant map, and the 22 large-frame walls (identity variant maps) ignore it. `createChunkWallCellCache`
  (`src/framing/chunk-wall-cells.ts`) frames each chunk *with its one-tile apron* (130 × 130 cells, `NO_CELL` past the
  world's edges, about 0.6 ms per chunk in Node, 33 KiB per resident chunk), framed and uploaded together with the
  block cells as the 16-bit `wallCell` plane (the whole layer); `stats().framedWalls` counts it. The chunk pass draws
  a wall's 32 × 32 cell from sheet pixels `(36c, 36r)` centred on its tile, so it overhangs 8 pixels on every side: a
  sprite pixel is covered by its own wall and the three neighbours on its quadrant's side, drawn row by row from the
  top, left to right within a row, each over the ones before (a chosen order), then over the background. Blocks draw
  over the wall layer. A wall that is not vanilla content keeps its map colour on its own tile, a vanilla wall without
  a sheet the missing-texture checkerboard; wall paint is not applied to sprites. The wall layer fades in over the
  walls' map colours like blocks do (`SPRITE_FULL_ZOOM`) and is sampled like them below 16 pixels per tile. Cost: the
  walls the samples can reach are looked up once per pixel into plain variables (an array indexed by a computed index
  made the first version 10–25 times slower on an Intel Arc GPU), samples composite in premultiplied floats (within
  one unit of integer compositing), and under an opaque block sprite the layer is skipped. On that GPU a 1600 × 900
  sprite frame of underground terrain takes 1.4–8 ms with walls against 2–5 ms without;
  `tests/wall-sprites-cost.browser.test.ts` (tagged perf) bounds the ratio.
  `invalidateTiles` recomputes the 3 × 3 cells around each changed tile in every cached chunk whose apron holds them.
- `tileAt` and anything that reads tile data (names, coordinates) use the camera and the CWM planes, never GPU
  textures, so neither path changes them.

## Terraria map palette

`terrariaMapPalette` (`src/palette/terraria-map-palette.generated.ts`) holds Terraria's map colours: per vanilla
tile and wall ID one colour per map option, water, lava, honey and shimmer, the background colours and the paint
colours. It is generated from a local game
installation and committed ([ADR 0002](../../docs/adr/0002-shipped-map-palette.md)); after a game update run

```powershell
./scripts/map-palette/export.ps1 -TerrariaAssembly '<Terraria directory>/TerrariaServer.exe'
```

and commit the regenerated module. With a map palette:

- **Content** (`contentColor`): the map option a block's frame selects. Content with several options (pots, herbs, gems,
  chests, trees, ...) has a rule in `tileOptions`/`wallOptions`: the first inclusive range of `frameX` or `frameY`
  (`mapOption`) holding the frame gives the option, a frame outside every range option 0. The rules are observed from
  the game by `scripts/map-palette/observe.ps1` and shipped as data by `export.ps1`. Content whose option depends on
  more than one frame coordinate is not ruled and keeps option 0; the exporter lists those IDs, with what they depend
  on, in a comment of the generated module. As observed in Terraria 1.4.5.8:
  - position in the world: tiles 149, 160, 627, 628, 692; wall 27;
  - both frame coordinates together: tiles 185, 187, 240, 648, 649;
  - a map colour outside the content's own options (the game draws them as other content): tiles 184, 227, 518, 519,
    572, 591.

  Walls have no frames, so they use their rule at frame 0. IDs without a map colour, mod and unknown content keep
  their placeholder.
- **Background** (`backgroundColor`): above `surfaceY` the sky gradient entry `floor(y / surfaceY × 255)`; below it
  the dirt colour, from `rockY` the rock colour, and in the bottom 200 rows the underworld colour. Terraria draws
  the dirt and rock layers in one colour each; only the sky is a gradient.
- **Paint** (`paintedColor`, `paint` on blocks, `wallPaint` on walls): a colour paint keeps the base brightness,
  each paint channel × `max(base channels)` / 255, truncated. Negative paint (30) inverts blocks and inverts walls
  at half brightness (`(255 − c) >> 1`). Shadow paint (29) is a near-black grey, approximated as `floor(blue / 34)`.

These rules were observed from the game's own map functions on synthetic input (ADR 0002), not read from its code.
`scripts/map-palette/observe.test.mjs` checks them against a local installation (`TERRARIA_ASSEMBLY`, opt-in): for
Terraria 1.4.5.8 every background row matches; of 44,051 painted colours 6 are one step brighter than the game's
(its floating-point rounding of exact products); the shadow approximation is exact for 83 % and at most 5/255 off.

## Placeholder colours

These colours are generated independently and use no Terraria assets or third-party tables.
For vanilla content, the stable key is ASCII `vanilla:<decimal id>`, independent of its palette
index. Hash it with FNV-1a: start at unsigned 2166136261; for each character, XOR its code,
multiply by 16777619 and retain the low unsigned 32 bits. Block RGB is
`[64 + (hash & 127), 64 + ((hash >>> 8) & 127), 64 + ((hash >>> 16) & 127)]`.
Wall RGB is each block channel divided by two and rounded down. Both are opaque.
Unknown and mod refs use opaque magenta `[255, 0, 255, 255]` for either layer.

The draw order is background → walls → blocks → liquids. Background RGB is sky
`[100, 160, 220]` for `y < surfaceY`, underground `[40, 30, 20]` otherwise, both opaque.
Absent blocks/walls (plane value 65535) contribute nothing. Water, lava, honey and shimmer
RGB are respectively `[40, 110, 230]`, `[255, 80, 20]`, `[240, 180, 40]`, `[180, 100, 240]`.
Liquid opacity is exactly `amount / 255`; kind none or amount zero contributes nothing.
Composite with standard source-over in straight alpha, rounding final channels to nearest
integer (`Math.round`). A disabled background starts at transparent black. Disabled layers
contribute nothing. Paint, frames, shape and flags do not alter this initial placeholder view.

**Wire overlay** (after liquids). A tile whose `flags & layers.wires` has a wire bit takes the colour of its topmost
shown wire: yellow over green over blue over red, the game's drawing order. With no wire shown it takes the actuator
colour if its actuator bit is shown (`WIRE_COLORS`). Over an opaque pixel the colour is blended with
`WIRE_ALPHA` = 192, per channel `⌊(2 × (wire × 192 + c × 63) + 255) / 510⌋` (the shader uses the same integer
expression). Over a non-opaque pixel the result is the wire colour with alpha 192. Bits 5 and up (inactive,
invisible, full-bright) are never shown.

For example, vanilla id 1 is block `[157, 173, 94, 255]`, wall `[78, 86, 47, 255]`.
Rendering reads the column-major planes directly, without semantic tile views or per-tile objects.
Colours are resolved once per palette entry and cached per CWM palette and map palette (CWM palettes
are append-only), not once per chunk.
