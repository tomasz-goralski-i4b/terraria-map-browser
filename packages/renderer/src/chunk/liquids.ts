// Liquid sprites (docs/assets.md, "Liquids"): which sheet each liquid kind draws from, how high a liquid amount fills
// its tile and which sheet row a sprite pixel of a liquid tile reads. The chunk pass's sprite program does the same
// (shaders.ts); the tests pin both.

/**
 * The `Liquid_<n>` sheet of CWM liquid kinds 1–4 (water, lava, honey, shimmer), measured in the art (S): Liquid_0 is
 * the forest water, Liquid_1 lava, Liquid_11 honey. Shimmer's Liquid_14 is a grey mask the game colours while drawing,
 * so shimmer keeps its map colour (null). Water is always the forest style: the biome water styles 2–10, 12 and 13
 * depend on where the player stands, which a world file does not record.
 */
export const LIQUID_SHEETS: readonly (number | null)[] = [0, 1, 11, null];

/**
 * The opacity (0–255) a liquid's sprite pixels are drawn with, by kind 1–4. The art is opaque; the game draws liquids
 * translucent, and its exact opacity is not observable without its renderer, so these are chosen: water half, honey
 * three quarters, lava nearly opaque (open question in docs/assets.md).
 */
export const LIQUID_SPRITE_ALPHA: readonly number[] = [128, 230, 191, 255];

/** Sprite pixels across one tile. */
const TILE_PIXELS = 16;

/** The first row of a frame's body: rows 0–1 are the surface highlight, 2–3 its edge, 4–15 one flat colour (S). */
export const LIQUID_BODY_ROW = 4;

/** The height in sprite pixels a liquid amount (0–255) fills, from the tile's bottom: rounded up, 255 is the tile. */
export function liquidFillPixels(amount: number): number {
  return Math.ceil((amount * TILE_PIXELS) / 255);
}

/**
 * The row of a liquid frame that sprite pixel row `y` (0–15, from the tile's top) of a liquid tile filled `fill`
 * pixels high reads, or null above the liquid. A surface tile (no liquid in the tile above) shows the frame from its
 * top row at the liquid's top; a tile under liquid repeats the body rows, so no surface line runs through a pool.
 */
export function liquidSheetRow(y: number, fill: number, surface: boolean): number | null {
  const top = TILE_PIXELS - fill;
  if (y < top) return null;
  const depth = y - top;
  return surface ? depth : LIQUID_BODY_ROW + (depth % (TILE_PIXELS - LIQUID_BODY_ROW));
}
