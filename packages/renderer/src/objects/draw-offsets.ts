// How the game draws frame-important tiles (docs/assets.md, "Draw offsets"): the draw size, top offset and mirroring
// its own draw data gives each stored frame, observed at runtime (R, scripts/sprite-objects/observe.ps1) and folded
// into the generated table by scripts/sprite-objects/export.mjs.
import { terrariaSpriteObjects } from "./terraria-sprite-objects.generated.js";

/** [width, height, top offset in pixels below the tile's top, mirrored at an even x (1), at an odd x (1)]. */
export type DrawVariant = readonly [number, number, number, number, number];

type Runs = readonly (readonly [number, number, number])[];

const BY_TYPE: ReadonlyMap<number, readonly [number, Runs, Runs]> = new Map(
  terrariaSpriteObjects.drawTypes.map(([type, base, rows, columns]) => [type, [base, rows, columns]] as const),
);

/**
 * Stalactites and stalagmites (165), which the game shifts outside its draw data (observed alone or with stone above
 * or below, it reports none), drawn as the observed moss plants (184) are (G: in-game screenshots, the user's `stick`
 * world, 2026-10-14): the hanging rows (frameY 0 and 18: a two-tile stalactite, 72: a one-tile one; in the user's
 * worlds every such tile hangs from the ceiling or from the 165 above it) 2 pixels up, the standing rows (36, 54, 90)
 * 2 pixels down, so both touch the stone.
 */
const STALACTITES = 165;
const HANGING_ROWS: ReadonlySet<number> = new Set([0, 18, 72]);
const STANDING_ROWS: ReadonlySet<number> = new Set([36, 54, 90]);
const HANGING: DrawVariant = [16, 16, -2, 0, 0];
const STANDING: DrawVariant = [16, 16, 2, 0, 0];
/** Any other row of 165: drawn as a plain cell by the object pass (the chunk pass leaves the type to it). */
const PLAIN: DrawVariant = [16, 16, 0, 0, 0];

/**
 * The stages the game draws after all the tiles that are not solid, in this order (docs/assets.md, "Draw order"): the
 * hanging objects (chandeliers, lanterns, banners), the swaying multi-tile plants, the plants that sway, the moss plants
 * and the tree foliage. Within a stage, row by row from the top.
 */
export const DRAW_STAGE = { hanging: 0, swaying: 1, plants: 2, moss: 3, foliage: 4 } as const;

/** The hanging objects: type → [width, height] in tiles; their tiles are drawn 2 pixels up from their top tile. */
export const HANGING_OBJECTS: ReadonlyMap<number, readonly [number, number]> = new Map([
  [34, [3, 3]], [454, [4, 3]], [42, [1, 2]], [270, [1, 2]], [271, [1, 2]], [572, [1, 2]], [581, [1, 2]], [660, [1, 2]],
  [91, [1, 3]], [95, [2, 2]], [126, [2, 2]], [444, [2, 2]], [465, [2, 3]], [591, [2, 3]], [592, [2, 3]], [698, [1, 1]],
] as const);
/** The swaying multi-tile plants (sunflowers, cattails, …), drawn at their tile without centring. */
const SWAYING: ReadonlySet<number> = new Set([27, 233, 236, 238, 485, 489, 490, 493, 519, 521, 522, 523, 524, 525, 526, 527, 530, 651, 652, 702, 705]);
// Types whose draw data could not be observed keep the chunk pass's cell.
const PLANTS: ReadonlySet<number> = new Set(terrariaSpriteObjects.swaysInWind.filter((type) => !terrariaSpriteObjects.drawUnobserved.includes(type)));
const MOSS_PLANTS = 184;
/** frameX of the dye plants (227) that stand still. */
const STILL_DYE_PLANTS: ReadonlySet<number> = new Set([204, 238, 408, 442, 476]);

/** The stage (DRAW_STAGE) a tile of `type` with stored frameX is drawn in; undefined: row by row. */
export function drawStage(type: number, frameX: number): number | undefined {
  if (HANGING_OBJECTS.has(type)) return DRAW_STAGE.hanging;
  if (SWAYING.has(type)) {
    // Only part of these sheets sways: the rest is drawn with the tiles.
    if (type === 530 && frameX >= 270) return undefined;
    if (type === 705 && frameX % 486 >= 270) return undefined;
    if (type === 519 && Math.floor(frameX / 18) > 4) return undefined;
    return DRAW_STAGE.swaying;
  }
  if (type === MOSS_PLANTS) return DRAW_STAGE.moss;
  if (PLANTS.has(type) && !(type === 227 && STILL_DYE_PLANTS.has(frameX))) return DRAW_STAGE.plants;
  return undefined;
}

/**
 * Tile types some frame of which the game draws other than as a plain 16 × 16 cell at its own tile, or in a stage
 * after the other tiles.
 */
export const DRAWN_TILES: ReadonlySet<number> = new Set([...BY_TYPE.keys(), STALACTITES, ...HANGING_OBJECTS.keys(), ...SWAYING, ...PLANTS, MOSS_PLANTS]);

const runAt = (runs: Runs, value: number): number | undefined => runs.find(([from, to]) => value >= from && value <= to)?.[2];

/**
 * How the game draws a tile of `type` with stored frame (frameX, frameY): its frameY run where that differs from the
 * type's base, else its frameX run, else the base; undefined for a type it draws as plain cells.
 */
export function drawVariant(type: number, frameX: number, frameY: number): DrawVariant | undefined {
  if (type === STALACTITES) return HANGING_ROWS.has(frameY) ? HANGING : STANDING_ROWS.has(frameY) ? STANDING : PLAIN;
  const entry = BY_TYPE.get(type);
  if (entry === undefined) return DRAWN_TILES.has(type) ? PLAIN : undefined;
  const [base, rows, columns] = entry;
  return terrariaSpriteObjects.drawVariants[runAt(rows, frameY) ?? runAt(columns, frameX) ?? base];
}
