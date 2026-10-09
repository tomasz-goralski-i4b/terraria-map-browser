import type { ContentRef } from "@studio/world-model";
import type { SourceRect } from "./chunk-cells.js";
import { NO_CELL } from "./cells.js";
import type { BlockRegion } from "./cells.js";
import type { FramingDatabase } from "./framing-database.js";

/** Side bits of a wall's neighbourhood: set where that side neighbour counts (docs/assets.md, "Walls"). */
export const WALL_SIDE = { north: 1, east: 2, south: 4, west: 8 } as const;

/** Sheet pixels per wall cell: a 32 × 32 cell and a 4-pixel gutter (docs/assets.md, "Walls"). */
export const WALL_CELL_STRIDE = 36;
export const WALL_CELL_PIXELS = 32;
/** Pixels a wall cell reaches past its 16 × 16 tile on every side: the cell is centred on the tile. */
export const WALL_OVERHANG: number = (WALL_CELL_PIXELS - 16) / 2;

/** The sheet rectangle of a packed wall cell (`column · 64 + row`); null for NO_CELL. */
export function wallSourceRect(cell: number): SourceRect | null {
  if (cell === NO_CELL) return null;
  return {
    x: (cell >> 6) * WALL_CELL_STRIDE, y: (cell & 63) * WALL_CELL_STRIDE, width: WALL_CELL_PIXELS, height: WALL_CELL_PIXELS,
  };
}

/** What the wall framer reads of a world: a CanonicalWorld satisfies it. Planes are column-major (`x * height + y`). */
export interface WallFramingWorld {
  readonly width: number;
  readonly height: number;
  readonly planes: {
    readonly block: Uint16Array;
    readonly wall: Uint16Array;
  };
  readonly palette: readonly ContentRef[];
}

export interface WallFraming {
  /**
   * The packed cell (column · 64 + row) of a wall of vanilla type `wall` whose counting side neighbours are `sides`
   * (WALL_SIDE bits) at (x, y), with variant `variant` (0–2; default (7x + 11y) mod 3); NO_CELL when `wall` is not a
   * wall type. Four counting sides take the interior cell of the position (x mod 12, y mod 12); ordinary walls then vary
   * by the variant map, large-frame walls ignore the variant.
   */
  readonly wallCell: (wall: number, sides: number, x: number, y: number, variant?: number) => number;
  /** Block types that count as a wall's side neighbour (where an active block of the type stands). */
  readonly neighbourBlocks: ReadonlySet<number>;
  /** The cell of the wall at (x, y) of `world`; NO_CELL without a wall or for a wall that is not vanilla content. */
  readonly cellAt: (world: WallFramingWorld, x: number, y: number) => number;
  /**
   * Frames every wall of `region` of `world` into `out`: per tile, column-major like the CWM planes (index
   * (x − left) · height + (y − top)), the packed cell or NO_CELL. It reads the tiles around the region; neighbours
   * outside the world count as absent.
   */
  readonly frameRegion: (world: WallFramingWorld, region: BlockRegion, out: Uint16Array) => void;
}

const ABSENT = 0xffff;
const ALL_SIDES = 15;
/** Interior positions repeat every 12 tiles in both directions (the database records 12 × 12). */
const POSITIONS = 12;
/** The interior table's corner code with every corner the same wall (Σ 1 × 3^k); the diagonals never matter. */
const SAME_CORNERS = 40;
/** The 81 corner codes per interior position. */
const CORNER_CODES = 81;
/** Neighbourhood code (NEIGHBOUR_ORDER NW N NE W E SW S SE, digit 1 the same wall) of each side bit set. */
const SIDE_CODES = Array.from({ length: 16 }, (_, sides) =>
  ((sides & WALL_SIDE.north) !== 0 ? 3 : 0) + ((sides & WALL_SIDE.east) !== 0 ? 81 : 0)
  + ((sides & WALL_SIDE.south) !== 0 ? 729 : 0) + ((sides & WALL_SIDE.west) !== 0 ? 27 : 0));

const pack = (column: number, row: number): number => column * 64 + row;
const modulo = (value: number, by: number): number => ((value % by) + by) % by;

/** One wall type's cells, derived from the database on first use. */
interface WallCells {
  /** Side bits (not all four) → packed variant-0 cell; −1 when not observed. */
  readonly bySides: Int16Array;
  /** Position (y mod 12) · 12 + (x mod 12) → packed variant-0 interior cell; −1 when not observed. */
  readonly interior: Int16Array;
  /** Packed cell → its variant-1 and variant-2 packed cells (−1 not observed), shared by variant map. */
  readonly variants: Int16Array;
}

export function createWallFraming(database: FramingDatabase): WallFraming {
  const packedOfCell = database.cells.map(([column, row]) => pack(column, row));
  const packedAt = (table: number, index: number): number => {
    const cell = database.tableCell(table, index);
    return cell === -1 ? -1 : packedOfCell[cell] ?? -1;
  };
  const variantTables = new Map<number, Int16Array>();
  const derived = new Map<number, WallCells | null>();

  const variantTable = (map: number): Int16Array => {
    let table = variantTables.get(map);
    if (table !== undefined) return table;
    table = new Int16Array(64 * 64 * 2).fill(-1);
    for (let cell = 0; cell < database.cells.length; cell++) {
      const packed = packedOfCell[cell] ?? -1;
      for (const variant of [1, 2]) {
        const varied = database.mapVariantCell(map, cell, variant);
        if (packed !== -1 && varied !== -1) table[packed * 2 + variant - 1] = packedOfCell[varied] ?? -1;
      }
    }
    variantTables.set(map, table);
    return table;
  };

  const cellsOf = (wall: number): WallCells | null => {
    const known = derived.get(wall);
    if (known !== undefined) return known;
    const tables = database.wallTables(wall);
    const cells = tables === null ? null : {
      bySides: Int16Array.from(SIDE_CODES, (code) => packedAt(tables.table, code)),
      interior: Int16Array.from({ length: POSITIONS * POSITIONS }, (_, position) =>
        packedAt(tables.interiorByPosition, position * CORNER_CODES + SAME_CORNERS)),
      variants: variantTable(tables.variants),
    };
    derived.set(wall, cells);
    return cells;
  };

  const wallCell = (wall: number, sides: number, x: number, y: number, variant = modulo(7 * x + 11 * y, 3)): number => {
    const cells = cellsOf(wall);
    if (cells === null) return NO_CELL;
    const base = sides === ALL_SIDES
      ? cells.interior[modulo(y, POSITIONS) * POSITIONS + modulo(x, POSITIONS)] ?? -1
      : cells.bySides[sides & ALL_SIDES] ?? -1;
    if (base === -1) return NO_CELL;
    if (variant === 0) return base;
    // A variant the database did not observe keeps the variant-0 cell, as for blocks.
    const varied = cells.variants[base * 2 + variant - 1] ?? -1;
    return varied === -1 ? base : varied;
  };

  const neighbourBlocks: ReadonlySet<number> = new Set(database.wallNeighbourBlocks);

  /** Whether the tile at plane index `index` counts as a wall's side neighbour: any wall, or a counting block. */
  const counts = (world: WallFramingWorld, index: number): boolean => {
    const { wall, block } = world.planes;
    if ((wall[index] ?? ABSENT) !== ABSENT) return true;
    const content = block[index] ?? ABSENT;
    if (content === ABSENT) return false;
    const ref = world.palette[content];
    return ref?.kind === "vanilla" && neighbourBlocks.has(ref.id);
  };

  const cellAt = (world: WallFramingWorld, x: number, y: number): number => {
    const { width, height } = world;
    const index = x * height + y;
    const content = world.planes.wall[index] ?? ABSENT;
    if (content === ABSENT) return NO_CELL;
    const ref = world.palette[content];
    if (ref?.kind !== "vanilla") return NO_CELL;
    let sides = 0;
    if (y > 0 && counts(world, index - 1)) sides |= WALL_SIDE.north;
    if (x + 1 < width && counts(world, index + height)) sides |= WALL_SIDE.east;
    if (y + 1 < height && counts(world, index + 1)) sides |= WALL_SIDE.south;
    if (x > 0 && counts(world, index - height)) sides |= WALL_SIDE.west;
    return wallCell(ref.id, sides, x, y);
  };

  return {
    wallCell,
    neighbourBlocks,
    cellAt,
    frameRegion: (world, region, out) => {
      for (let i = 0; i < region.width; i++) {
        for (let j = 0; j < region.height; j++) out[i * region.height + j] = cellAt(world, region.left + i, region.top + j);
      }
    },
  };
}
