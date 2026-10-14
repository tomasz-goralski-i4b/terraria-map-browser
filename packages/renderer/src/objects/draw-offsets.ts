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

/** Tile types some frame of which the game draws other than as a plain 16 × 16 cell at its own tile. */
export const DRAWN_TILES: ReadonlySet<number> = new Set([...BY_TYPE.keys(), STALACTITES]);

const runAt = (runs: Runs, value: number): number | undefined => runs.find(([from, to]) => value >= from && value <= to)?.[2];

/**
 * How the game draws a tile of `type` with stored frame (frameX, frameY): its frameY run where that differs from the
 * type's base, else its frameX run, else the base; undefined for a type it draws as plain cells.
 */
export function drawVariant(type: number, frameX: number, frameY: number): DrawVariant | undefined {
  if (type === STALACTITES) return HANGING_ROWS.has(frameY) ? HANGING : STANDING_ROWS.has(frameY) ? STANDING : PLAIN;
  const entry = BY_TYPE.get(type);
  if (entry === undefined) return undefined;
  const [base, rows, columns] = entry;
  return terrariaSpriteObjects.drawVariants[runAt(rows, frameY) ?? runAt(columns, frameX) ?? base];
}
