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
`options.layers` independently enables background, walls, blocks and liquids.
`options.mapPalette` supplies map colours (see below); without it every block and wall uses its placeholder.

`createMapRenderer(canvas, options)` is the WebGL2 backend. It draws exactly the pixels `renderChunk` produces for
the same `mapPalette`, which the browser tests assert for every layer combination.

## Terraria map palette

`terrariaMapPalette` (`src/palette/terraria-map-palette.generated.ts`) holds Terraria's map colours: per vanilla
tile and wall ID one colour per map option, water, lava, honey and shimmer, the background colours and the paint
colours. It is generated from a local game
installation and committed ([ADR 0002](../../docs/adr/0002-shipped-map-palette.md)); after a game update run

```powershell
./scripts/map-palette/export.ps1 -TerrariaAssembly '<Terraria directory>/TerrariaServer.exe'
```

and commit the regenerated module. With a map palette:

- **Content** (`contentColor`): the first map option of vanilla content; IDs without a map colour, mod and unknown
  content keep their placeholder. Frame-dependent options are not applied yet.
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

For example, vanilla id 1 is block `[157, 173, 94, 255]`, wall `[78, 86, 47, 255]`.
Rendering reads the column-major planes directly, without semantic tile views or per-tile objects.
Colours are resolved once per palette entry and cached per CWM palette and map palette (CWM palettes
are append-only), not once per chunk.
