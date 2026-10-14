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

/** Tile types some frame of which the game draws other than as a plain 16 × 16 cell at its own tile. */
export const DRAWN_TILES: ReadonlySet<number> = new Set(BY_TYPE.keys());

const runAt = (runs: Runs, value: number): number | undefined => runs.find(([from, to]) => value >= from && value <= to)?.[2];

/**
 * How the game draws a tile of `type` with stored frame (frameX, frameY): its frameY run where that differs from the
 * type's base, else its frameX run, else the base; undefined for a type it draws as plain cells.
 */
export function drawVariant(type: number, frameX: number, frameY: number): DrawVariant | undefined {
  const entry = BY_TYPE.get(type);
  if (entry === undefined) return undefined;
  const [base, rows, columns] = entry;
  return terrariaSpriteObjects.drawVariants[runAt(rows, frameY) ?? runAt(columns, frameX) ?? base];
}
