// Liquid sprites (docs/assets.md, "Liquids"): which sheet each liquid kind draws from, how high a liquid amount fills
// its tile and which sheet row a sprite pixel of a liquid tile reads. The chunk pass's sprite program does the same
// (shaders.ts); the tests pin both.

/**
 * The `Liquid_<n>` sheet of CWM liquid kinds 1–4 (water, lava, honey, shimmer), measured in the art (S): Liquid_0 is
 * the forest water, Liquid_1 lava, Liquid_11 honey. Shimmer's Liquid_14 is a grey mask the game colours while drawing,
 * so shimmer (null) is drawn in its measured colours (shimmerPixel), cut to its fill and through shapes like the others. Water is always the forest style: the biome water styles 2–10, 12 and 13
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

/**
 * Sprite pixels a liquid reaches into the block beside or below it (G, in-game screenshots: liquid meets blocks
 * without air between them; block art is transparent up to 2 rows deep at its edges); drawn under the block's
 * sprite, so only its transparent edge pixels show it, in the liquid's own colours.
 */
export const LIQUID_BLEED = 2;

/**
 * The neighbour whose liquid sprite pixel (x, y) (0–15) of a block without liquid of its own shows, under the block:
 * the liquid above in the top LIQUID_BLEED rows (full, under liquid), else the liquid beside it in the LIQUID_BLEED
 * columns next to that side (the fuller one where both reach), at the neighbour's own level. Null for none.
 */
export function liquidBleed(
  x: number, y: number, above: TileLiquid, left: TileLiquid, right: TileLiquid,
): { readonly side: "above" | "left" | "right"; readonly kind: number; readonly amount: number } | null {
  if (y < LIQUID_BLEED && above.kind !== 0 && above.amount !== 0) return { side: "above", kind: above.kind, amount: 255 };
  const fromLeft = x < LIQUID_BLEED && left.kind !== 0 && left.amount !== 0;
  const fromRight = x >= TILE_PIXELS - LIQUID_BLEED && right.kind !== 0 && right.amount !== 0;
  if (fromRight && (!fromLeft || right.amount > left.amount)) return { side: "right", kind: right.kind, amount: right.amount };
  if (fromLeft) return { side: "left", kind: left.kind, amount: left.amount };
  return null;
}

/**
 * Shimmer's colours in sprite mode (G: measured in in-game screenshots of a shimmer pool, 2026-10-14; its sheet is a grey
 * mask the game colours while drawing, which the viewer does not reproduce). The surface is a rainbow along x: its top
 * row cycles every SHIMMER_CYCLE world pixels through SHIMMER_TOP (cyan, lilac, purple, magenta, pink, peach, pale teal),
 * the second row through the more saturated SHIMMER_SECOND, rows 2 and 3 fade from that to the body in thirds. The body
 * has sparkles at about one pixel in SHIMMER_SPARKLE_PERIOD, fixed per world pixel (the game's move), coloured by the
 * rainbow too: halfway from the second row's colour at their x to the body (shimmerSparkle).
 */
export const SHIMMER_CYCLE = 64;
export const SHIMMER_TOP: readonly (readonly [number, number, number])[] = [
  [159, 242, 255], [156, 169, 255], [196, 129, 255], [254, 111, 255], [255, 116, 255], [255, 177, 254], [255, 212, 240], [194, 208, 240],
];
export const SHIMMER_SECOND: readonly (readonly [number, number, number])[] = [
  [159, 185, 255], [155, 143, 255], [194, 128, 255], [252, 114, 255], [234, 137, 254], [252, 173, 253], [224, 212, 239], [172, 209, 241],
];
export const SHIMMER_BODY: readonly [number, number, number] = [155, 111, 233];
export const SHIMMER_SPARKLE_PERIOD = 113;

/** Whether world sprite pixel (x, y) (16 per tile) of a shimmer body sparkles: a fixed hash of the position. */
export function shimmerSparkles(x: number, y: number): boolean {
  let hash = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77)) >>> 0;
  hash = (hash ^ (hash >>> 15)) >>> 0;
  return hash % SHIMMER_SPARKLE_PERIOD === 0;
}

/** A keyframe cycle at world x: linear between its keyframes, SHIMMER_CYCLE / keyframes pixels apart, rounded. */
function cycleAt(keys: readonly (readonly [number, number, number])[], x: number): [number, number, number] {
  const step = SHIMMER_CYCLE / keys.length;
  const at = ((x % SHIMMER_CYCLE) + SHIMMER_CYCLE) % SHIMMER_CYCLE;
  const index = Math.floor(at / step), f = at % step;
  const a = keys[index] ?? [0, 0, 0], b = keys[(index + 1) % keys.length] ?? [0, 0, 0];
  const mix = (k: 0 | 1 | 2): number => Math.floor((a[k] * (step - f) + b[k] * f + step / 2) / step);
  return [mix(0), mix(1), mix(2)];
}

/** The second row's colour at x weighted `weight` thirds against the body's, rounded. */
function towardsBody(x: number, weight: number): [number, number, number] {
  const second = cycleAt(SHIMMER_SECOND, x);
  const mix = (k: 0 | 1 | 2): number => Math.floor((second[k] * weight + SHIMMER_BODY[k] * (3 - weight) + 1) / 3);
  return [mix(0), mix(1), mix(2)];
}

/** A sparkle's colour at world x: halfway from the second row's colour there to the body. */
export function shimmerSparkle(x: number): readonly [number, number, number] {
  const second = cycleAt(SHIMMER_SECOND, x);
  return [(second[0] + SHIMMER_BODY[0] + 1) >> 1, (second[1] + SHIMMER_BODY[1] + 1) >> 1, (second[2] + SHIMMER_BODY[2] + 1) >> 1];
}

/** Shimmer's colour at frame row `row` (liquidSheetRow) of world sprite pixel (x, y). */
export function shimmerPixel(row: number, x: number, y: number): readonly [number, number, number] {
  if (row === 0) return cycleAt(SHIMMER_TOP, x);
  if (row < 4) return towardsBody(x, 4 - row);
  return shimmerSparkles(x, y) ? shimmerSparkle(x) : SHIMMER_BODY;
}

/** Shimmer's waterfall: its core and its light edge (G: measured in an in-game screenshot of a shimmer waterfall). */
export const SHIMMER_WATERFALL: readonly [readonly [number, number, number], readonly [number, number, number]] = [[164, 161, 245], [164, 203, 255]];
