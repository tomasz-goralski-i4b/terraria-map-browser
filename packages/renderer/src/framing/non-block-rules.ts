import { NO_CELL } from "./cells.js";
import type { BlockRegion } from "./cells.js";
import type { FramingDatabase } from "./framing-database.js";

/**
 * Self-framed tiles that are not blocks (docs/assets.md, "Vines and cactus"): hanging types (vines) take their cell
 * from the tiles above, below and beside them, standing types (cactus) from the plant they belong to. Cells are packed
 * column · 64 + row, NO_CELL where the game leaves the tile without a frame of its own.
 */

/** The tile id at (x, y): the vanilla id, −1 without a tile or outside the world, any other number for other content. */
export type TypeAt = (x: number, y: number) => number;

const pack = (column: number, row: number): number => column * 64 + row;

/** The chosen variant of a tile whose cell the game picks at random: the block framing's (7x + 11y) mod 3. */
const variantOf = (x: number, y: number): number => (((7 * x + 11 * y) % 3) + 3) % 3;

/** One hanging type: per tile above that holds it, the tiles that join it and its cells per combination. */
export interface HangingRule {
  readonly byAbove: ReadonlyMap<number, HangingGroupRule>;
}

/** The tiles that join a hanging tile under one group of tiles above, and its cells. */
export interface HangingGroupRule {
  readonly below: ReadonlySet<number>;
  readonly west: ReadonlySet<number>;
  readonly east: ReadonlySet<number>;
  /** Per combination (1 below joined + 2 west joined + 4 east joined), the packed cells the game picks among. */
  readonly cells: readonly (readonly number[])[];
}

/**
 * The cell of a hanging tile with `above`, `below`, `west` and `east` around it (−1: none), at (x, y): among the cells
 * the game picks from at random, the one the position chooses. NO_CELL when nothing above holds it.
 */
export function hangingCell(
  rule: HangingRule, above: number, below: number, west: number, east: number, x: number, y: number,
): number {
  const group = rule.byAbove.get(above);
  if (group === undefined) return NO_CELL;
  const combo = (group.below.has(below) ? 1 : 0) + (group.west.has(west) ? 2 : 0) + (group.east.has(east) ? 4 : 0);
  const cells = group.cells[combo] ?? [];
  return cells[variantOf(x, y) % cells.length] ?? NO_CELL;
}

/** One standing type and the grounds it stands on. */
export interface StandingRule {
  readonly type: number;
  readonly roots: ReadonlySet<number>;
}

/** How a standing tile belongs to its plant. */
const TRUNK = 0;
/** A branch whose trunk is east of it (it grows out to the west). */
const WEST_BRANCH = 1;
/** A branch whose trunk is west of it. */
const EAST_BRANCH = 2;
/** Not part of a rooted plant: no trunk to find, or a branch beside the trunk's lowest tile. */
const LOOSE = 3;

/** The lowest tile of the column of standing tiles from (x, y) down. */
function columnBottom(rule: StandingRule, typeAt: TypeAt, x: number, y: number): number {
  let bottom = y;
  while (typeAt(x, bottom + 1) === rule.type) bottom++;
  return bottom;
}

/**
 * The role of the standing tile at (x, y): a trunk when its column stands on a root; otherwise, from the column's
 * lowest tile, a branch of the trunk beside it, looking west first and only at a tile that stands on something
 * (a standing tile or a root). A branch beside its trunk's lowest tile, or without a trunk, is loose.
 */
function roleOf(rule: StandingRule, typeAt: TypeAt, x: number, y: number): number {
  const bottom = columnBottom(rule, typeAt, x, y);
  if (rule.roots.has(typeAt(x, bottom + 1))) return TRUNK;
  const stands = (sx: number): boolean => typeAt(sx, bottom) === rule.type
    && (typeAt(sx, bottom + 1) === rule.type || rule.roots.has(typeAt(sx, bottom + 1)));
  const side = stands(x - 1) ? -1 : stands(x + 1) ? 1 : 0;
  if (side === 0) return LOOSE;
  const trunkBottom = columnBottom(rule, typeAt, x + side, bottom);
  if (!rule.roots.has(typeAt(x + side, trunkBottom + 1)) || trunkBottom === bottom) return LOOSE;
  return side === 1 ? WEST_BRANCH : EAST_BRANCH;
}

/**
 * The cell of the standing tile at (x, y) (docs/assets.md, "Cactus"):
 * - a trunk takes column 0, plus 1 with an arm to the east and 4 with an arm to the west (an arm: a standing tile
 *   beside it with no standing tile below; to the west, also none beyond it), and row 0 at its top, row 2 at its
 *   bottom or with an arm, else row 1;
 * - a branch takes (6, 2) (west) or (6, 1) (east) as a lone tile beside its trunk, else column 3 (west) or 2 (east)
 *   with row 0 at its top, 2 at its lowest tile and 1 between;
 * - a loose tile takes (0, 0) beside a rooted tile of its row, else no cell.
 */
export function standingCell(rule: StandingRule, typeAt: TypeAt, x: number, y: number): number {
  const own = rule.type;
  const role = roleOf(rule, typeAt, x, y);
  const north = typeAt(x, y - 1) === own;
  const south = typeAt(x, y + 1) === own;
  if (role === TRUNK) {
    const west = typeAt(x - 1, y) === own && typeAt(x - 1, y + 1) !== own && typeAt(x - 2, y) !== own;
    const east = typeAt(x + 1, y) === own && typeAt(x + 1, y + 1) !== own;
    const column = (east ? 1 : 0) + (west ? 4 : 0);
    return pack(column, !north ? 0 : !south || west || east ? 2 : 1);
  }
  if (role === WEST_BRANCH || role === EAST_BRANCH) {
    const column = role === WEST_BRANCH ? 3 : 2;
    if (!south) return north ? pack(column, 2) : role === WEST_BRANCH ? pack(6, 2) : pack(6, 1);
    return pack(column, north ? 1 : 0);
  }
  const rooted = (sx: number): boolean => typeAt(sx, y) === own && roleOf(rule, typeAt, sx, y) !== LOOSE;
  return rooted(x - 1) || rooted(x + 1) ? pack(0, 0) : NO_CELL;
}

/** Standing tiles a plant's extent search visits at most around one change. */
const MAX_PLANT_TILES = 4096;

/**
 * The tiles whose cells a change at (x, y) can change through the standing plants touching its 3 × 3: every standing
 * tile connected to them (diagonals included), with two columns and a row around (a trunk reads two columns west, a
 * tile one row down). Null without standing tiles there.
 */
export function standingExtent(
  rule: StandingRule, typeAt: TypeAt, x: number, y: number, width: number, height: number,
): BlockRegion | null {
  const seen = new Set<number>();
  const stack: number[] = [];
  const visit = (vx: number, vy: number): void => {
    if (vx < 0 || vy < 0 || vx >= width || vy >= height || typeAt(vx, vy) !== rule.type) return;
    const key = vx * height + vy;
    if (seen.has(key) || seen.size >= MAX_PLANT_TILES) return;
    seen.add(key);
    stack.push(vx, vy);
  };
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) visit(x + dx, y + dy);
  if (seen.size === 0) return null;
  let left = x;
  let top = y;
  let right = x;
  let bottom = y;
  while (stack.length > 0) {
    const vy = stack.pop() ?? 0;
    const vx = stack.pop() ?? 0;
    left = Math.min(left, vx);
    right = Math.max(right, vx);
    top = Math.min(top, vy);
    bottom = Math.max(bottom, vy);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx !== 0 || dy !== 0) visit(vx + dx, vy + dy);
  }
  const l = Math.max(0, left - 2);
  const t = Math.max(0, top - 1);
  return { left: l, top: t, width: Math.min(width, right + 3) - l, height: Math.min(height, bottom + 2) - t };
}

/** The non-block framing of a database: which types it covers, their cells, and how far a change reaches. */
export interface NonBlockFraming {
  /** Whether `type` is a hanging or standing type the database covers. */
  readonly covers: (type: number) => boolean;
  /** The packed cell of the tile of `type` at (x, y), or NO_CELL. */
  readonly cell: (typeAt: TypeAt, type: number, x: number, y: number) => number;
  /** The area beyond a change's 3 × 3 whose cells it can change (standingExtent of every standing type); null: none. */
  readonly extent: (typeAt: TypeAt, x: number, y: number, width: number, height: number) => BlockRegion | null;
}

export function createNonBlockFraming(database: FramingDatabase): NonBlockFraming {
  const packed = (index: number): number => {
    const [column = 0, row = 0] = database.cells[index] ?? [];
    return pack(column, row);
  };
  const hanging = new Map<number, HangingRule>();
  for (const [id, type] of database.hanging) {
    const byAbove = new Map<number, HangingGroupRule>();
    for (const group of type.groups) {
      const entry = {
        below: new Set(group.below), west: new Set(group.west), east: new Set(group.east),
        cells: group.cells.map((cells) => cells.map(packed)),
      };
      for (const above of group.above) byAbove.set(above, entry);
    }
    hanging.set(id, { byAbove });
  }
  const standing = new Map<number, StandingRule>();
  for (const [id, type] of database.standing) standing.set(id, { type: id, roots: new Set(type.roots) });
  const standingRules = [...standing.values()];

  return {
    covers: (type) => hanging.has(type) || standing.has(type),
    cell: (typeAt, type, x, y) => {
      const hangs = hanging.get(type);
      if (hangs !== undefined) {
        return hangingCell(hangs, typeAt(x, y - 1), typeAt(x, y + 1), typeAt(x - 1, y), typeAt(x + 1, y), x, y);
      }
      const stands = standing.get(type);
      return stands === undefined ? NO_CELL : standingCell(stands, typeAt, x, y);
    },
    extent: (typeAt, x, y, width, height) => {
      let extent: BlockRegion | null = null;
      for (const rule of standingRules) {
        const area = standingExtent(rule, typeAt, x, y, width, height);
        if (area === null) continue;
        if (extent === null) {
          extent = area;
          continue;
        }
        const left = Math.min(extent.left, area.left);
        const top = Math.min(extent.top, area.top);
        extent = {
          left, top,
          width: Math.max(extent.left + extent.width, area.left + area.width) - left,
          height: Math.max(extent.top + extent.height, area.top + area.height) - top,
        };
      }
      return extent;
    },
  };
}
