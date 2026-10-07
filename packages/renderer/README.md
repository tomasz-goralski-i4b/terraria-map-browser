# Renderer

Framework-free (never imports React) rendering of CWM planes. `renderChunk` below is the CPU
reference implementation; the interactive backend is WebGL2 (`MapRenderer`, #87), whose output must equal
`renderChunk` pixel for pixel. There is no Canvas2D backend.

## CPU reference: `renderChunk`

 `renderChunk(world, cx, cy, options)` returns
`{ width, height, pixels }`, with row-major straight-alpha RGBA bytes at one pixel per tile.
Chunk coordinates are indices of 128 × 128 regions; right and bottom edges are cropped.
Negative, non-integer or past-the-edge chunk indices throw a `RangeError`.
`options.surfaceY` is the first underground row (the CWM does not contain a surface depth).
`options.layers` independently enables background, walls, blocks and liquids.
`options.mapPalette` supplies map colours (see below); without it every block and wall uses its placeholder.

`createMapRenderer(canvas, options)` is the WebGL2 backend. It draws exactly the pixels `renderChunk` produces for
the same `mapPalette`, which the browser tests assert for every layer combination.

## Terraria map palette

`terrariaMapPalette` (`src/palette/terraria-map-palette.generated.ts`) holds Terraria's map colours: per vanilla
tile and wall ID one colour per map option, plus water, lava, honey and shimmer. It is generated from a local game
installation and committed ([ADR 0002](../../docs/adr/0002-shipped-map-palette.md)); after a game update run

```powershell
./scripts/map-palette/export.ps1 -TerrariaAssembly '<Terraria directory>/TerrariaServer.exe'
```

and commit the regenerated module. `contentColor` uses the first map option of vanilla content and falls back to
the placeholder for IDs without a map colour, mod and unknown content. Frame-dependent options, paint and depth
shading are not applied yet.

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
