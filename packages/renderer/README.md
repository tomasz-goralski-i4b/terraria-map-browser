# Renderer

Framework-free, pure rendering of CWM planes. `renderChunk(world, cx, cy, options)` returns
`{ width, height, pixels }`, with row-major straight-alpha RGBA bytes at one pixel per tile.
Chunk coordinates are indices of 128 × 128 regions; right and bottom edges are cropped.
Negative, non-integer or past-the-edge chunk indices throw a `RangeError`.
`options.surfaceY` is the first underground row (the CWM does not contain a surface depth).
`options.layers` independently enables background, walls, blocks and liquids.

## Placeholder palette

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
Placeholder colours are hashed once per palette entry and cached per palette (CWM palettes are
append-only), not once per chunk.
