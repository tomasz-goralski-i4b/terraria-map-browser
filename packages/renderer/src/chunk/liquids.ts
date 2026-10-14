// Liquid sprites (docs/assets.md, "Liquids"): which sheet each liquid kind draws from, how high a liquid amount fills
// its tile and which sheet row a sprite pixel of a liquid tile reads. The chunk pass's sprite program does the same
// (shaders.ts); the tests pin both.

/**
 * The `Liquid_<n>` sheet of CWM liquid kinds 1–4 (water, lava, honey, shimmer), measured in the art (S): Liquid_0 is
 * the forest water, Liquid_1 lava, Liquid_11 honey. Shimmer's Liquid_14 is a grey mask the game colours while drawing,
 * so shimmer is drawn in its flat map colour (null), cut to its fill and through shapes like the others. Water is always the forest style: the biome water styles 2–10, 12 and 13
 * depend on where the player stands, which a world file does not record.
 */
export const LIQUID_SHEETS: readonly (number | null)[] = [0, 1, 11, null];

/**
 * The opacity (0–255) of a liquid's front layer, by kind 1–4: drawn over the walls, blocks and objects behind the
 * liquid, which itself lies over its opaque back layer (the art hiding the background; docs/assets.md, "Liquids").
 * Water's half is chosen to match in-game screenshots (plants stay visible under water, darkened); lava and honey are
 * chosen (open question).
 */
export const LIQUID_SPRITE_ALPHA: readonly number[] = [128, 230, 191, 191];

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

/** A tile's liquid: CWM kind (0 none, 1–4) and amount (0–255). */
export interface TileLiquid {
  readonly kind: number;
  readonly amount: number;
}

/**
 * The liquid a half block or slope without liquid of its own shows in the part its shape cuts away, under the block
 * (G: the game fills that part from the pool around it; the file stores no liquid there). Liquid above fills the tile,
 * under liquid; otherwise the fuller side neighbour (the left one on a tie) at its own level, with the surface. Null
 * without liquid around.
 */
export function shapedTileLiquid(above: TileLiquid, left: TileLiquid, right: TileLiquid): (TileLiquid & { readonly surface: boolean }) | null {
  if (above.kind !== 0 && above.amount !== 0) return { kind: above.kind, amount: 255, surface: false };
  const side = right.kind !== 0 && right.amount > (left.kind === 0 ? 0 : left.amount) ? right : left;
  return side.kind !== 0 && side.amount !== 0 ? { kind: side.kind, amount: side.amount, surface: true } : null;
}

/**
 * Whether a liquid tile shows the surface piece: not when the tile above holds liquid, its own or, for a half block
 * or slope (`aboveShape` not 0) without its own, the liquid flowing into its shape from its neighbours (`shapedTileLiquid`
 * of the tile above: its upper, left and right neighbours). So a pool along a slope has one surface, at its top.
 */
export function liquidHasSurface(
  above: TileLiquid, aboveShape: number, aboveAbove: TileLiquid, aboveLeft: TileLiquid, aboveRight: TileLiquid,
): boolean {
  if (above.kind !== 0 && above.amount !== 0) return false;
  return aboveShape === 0 || shapedTileLiquid(aboveAbove, aboveLeft, aboveRight) === null;
}
