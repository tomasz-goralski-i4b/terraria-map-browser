// Decompression uses the platform's DecompressionStream (browsers, Node 18+), declared by the DOM lib.
/// <reference lib="dom" />

/**
 * The framing database (docs/assets.md, "Tile framing"; ADR 0003): what the game frames for every neighbourhood of
 * every self-framed block type with each other self-framed type, observed at runtime and generated into
 * `terraria-framing.generated.ts`. Neighbourhoods are coded as in `neighbourhoodCode`.
 */
export interface FramingDatabaseData {
  readonly gameVersion: string;
  /** Cell index → (column, row): 18-pixel cells for blocks, 36-pixel cells for walls. */
  readonly cells: readonly (readonly number[])[];
  /** Raw-deflated, base64; inflated, one char per neighbourhood code whose char code − 48 is a cell index. */
  readonly tables: readonly string[];
  /**
   * Variant maps, raw-deflated, base64; inflated, triplets of cell-index chars (char code − 48): the variant-0 cell and
   * its variant-1 and variant-2 cells, for every variant-0 cell a type takes.
   */
  readonly variantMaps: readonly string[];
  /** Self-framed block types, in the order of the relation rows and columns. */
  readonly blockTypes: readonly number[];
  /**
   * Raw-deflated, base64; inflated, one line per block type of `blockTypes` and one char per other type: `-` itself,
   * `x` treated like air, `o` like itself, `A`… by the type's `tables[char − 65]`.
   */
  readonly relations: string;
  readonly blocks: Readonly<Record<string, BlockFramingData>>;
  readonly walls: Readonly<Record<string, WallFramingData>>;
  /** Block types that count as a wall's neighbour where there is no wall. */
  readonly wallNeighbourBlocks: readonly number[];
}

export interface BlockFramingData {
  /** The type with air and itself only (the other digit stays air). */
  readonly alone: number;
  readonly tables: readonly number[];
  /** Index into `variantMaps`. */
  readonly variants: number;
  /**
   * Types whose cells depend on the position: the `alone` table with the centre at x = 12 + a, y = 12 + b (a = 0–5,
   * b = 0–3), index b × 6 + a, so a = x mod 6 and b = y mod 4 (block patterns repeat every 2 or 3 across, 2 or 4 down).
   */
  readonly byPosition?: readonly number[];
  readonly variantIgnoredByPosition?: boolean;
}

export interface WallFramingData {
  /** All 6 561 neighbourhoods (0 no wall, 1 the same wall, 2 another wall) at position (30, 30), variant 0. */
  readonly table: number;
  /**
   * The 81 interior codes (sides all the same wall, corners 0/1/2; index Σ corner digit × 3^k, corners NW NE SW SE) at
   * the 144 positions x = 36 + a, y = 36 + b (a, b = 0–11, so a = x mod 12 and b = y mod 12; position index b × 12 + a),
   * 81 chars per position.
   */
  readonly interiorByPosition: number;
  readonly variantChangesInterior: boolean;
  /** Index into `variantMaps`. */
  readonly variants: number;
}

/** Neighbour order of a neighbourhood code. */
export const NEIGHBOUR_ORDER = ["NW", "N", "NE", "W", "E", "SW", "S", "SE"] as const;

/** The code of a neighbourhood: digit per neighbour in NEIGHBOUR_ORDER, 0 air, 1 the centre's type, 2 the other type. */
export function neighbourhoodCode(digits: readonly number[]): number {
  if (digits.length !== 8 || digits.some((digit) => digit !== 0 && digit !== 1 && digit !== 2)) {
    throw new RangeError("a neighbourhood has 8 digits of 0, 1 or 2");
  }
  return digits.reduce((code, digit, index) => code + digit * 3 ** index, 0);
}

/** `code` with every digit `from` replaced by `to`. */
function replaceDigit(code: number, from: number, to: number): number {
  let result = 0;
  let scale = 1;
  let rest = code;
  for (let k = 0; k < 8; k++) {
    const digit = rest % 3;
    rest = Math.floor(rest / 3);
    result += (digit === from ? to : digit) * scale;
    scale *= 3;
  }
  return result;
}

export type Cell = readonly [column: number, row: number];

/**
 * The cell the database records for a neighbourhood the game does not keep: a falling block (sand, silt, …) with
 * nothing below it falls, so the neighbourhood has no frame of its own. `blockCell` returns null for it.
 */
export const UNSTABLE_CELL: Cell = [63, 63];

/** How a block type treats another: like air, like itself, or by a table of its own. */
export type BlockRelation = "air" | "self" | "table";

export interface FramingDatabase {
  readonly gameVersion: string;
  readonly blockTypes: readonly number[];
  /** How `centre` treats `other`; null when either is not a self-framed block type. */
  readonly relation: (centre: number, other: number) => BlockRelation | null;
  /**
   * The cell the game gives a block of `centre` in neighbourhood `code` with `other` as the 2-digit type (null: no
   * other type), at variant 0 and the reference position; null when `centre` is not a self-framed block type, or when
   * the neighbourhood is unstable (a falling block in it has nothing below it, UNSTABLE_CELL).
   */
  readonly blockCell: (centre: number, other: number | null, code: number) => Cell | null;
  /** The cell of variant `variant` (0–2) of a block whose variant-0 cell is `cell`, or null when not observed. */
  readonly blockVariant: (centre: number, cell: Cell, variant: number) => Cell | null;
  /** The cell of a wall in neighbourhood `code` (0 no wall, 1 the same wall, 2 another wall), variant 0. */
  readonly wallCell: (wall: number, code: number) => Cell | null;

  // Index-based access for the block framer (frame-block.ts), which looks up millions of cells without allocating.
  /** Cell index → cell. */
  readonly cells: readonly Cell[];
  readonly tableCount: number;
  /** The cell index `table` records for neighbourhood `code`; −1 when the neighbourhood is unstable. */
  readonly tableCell: (table: number, code: number) => number;
  /** The table of `centre` with air and itself only, at position (x, y) for position-framed types; null: no block type. */
  readonly aloneTable: (centre: number, x: number, y: number) => number | null;
  /** The table `centre` frames by beside `other` when their relation is "table"; null otherwise. */
  readonly pairTable: (centre: number, other: number) => number | null;
  /** The cell index of variant `variant` of a block whose variant-0 cell index is `cell`; −1 when not observed. */
  readonly variantCell: (centre: number, cell: number, variant: number) => number;
  /** Whether `centre` frames by position and ignores the variant (the large-frame types). */
  readonly ignoresVariant: (centre: number) => boolean;
}

async function inflate(base64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

/** Inflates the generated data once; lookups are then synchronous. */
export async function loadFramingDatabase(data: FramingDatabaseData): Promise<FramingDatabase> {
  const tables = await Promise.all(data.tables.map(inflate));
  // Per variant map: variant-0 cell index → [variant-1, variant-2] cell indices.
  const variantMaps = (await Promise.all(data.variantMaps.map(inflate))).map((text) => {
    const map = new Map<number, readonly [number, number]>();
    for (let at = 0; at + 2 < text.length; at += 3) {
      map.set(text.charCodeAt(at) - 48, [text.charCodeAt(at + 1) - 48, text.charCodeAt(at + 2) - 48]);
    }
    return map;
  });
  const rows = (await inflate(data.relations)).split("\n");
  const typeIndex = new Map(data.blockTypes.map((type, index) => [type, index]));
  const cellKey = new Map(data.cells.map((cell, index) => [`${String(cell[0])},${String(cell[1])}`, index]));
  // By number: the index-based lookups run per tile and must not build a key string.
  const blockOf = new Map(Object.entries(data.blocks).map(([type, block]) => [Number(type), block]));
  const unstableIndex = data.cells.findIndex((cell) => cell[0] === UNSTABLE_CELL[0] && cell[1] === UNSTABLE_CELL[1]);
  const tableCell = (table: number, code: number): number => {
    const index = (tables[table]?.charCodeAt(code) ?? 48 + unstableIndex) - 48;
    return index === unstableIndex ? -1 : index;
  };
  const cellAt = (table: string | undefined, code: number): Cell | null => {
    if (table === undefined) return null;
    const cell = data.cells[table.charCodeAt(code) - 48];
    if (cell === undefined || (cell[0] === UNSTABLE_CELL[0] && cell[1] === UNSTABLE_CELL[1])) return null;
    return [cell[0] ?? 0, cell[1] ?? 0];
  };
  const relationChar = (centre: number, other: number): string | null => {
    const row = typeIndex.get(centre);
    const column = typeIndex.get(other);
    if (row === undefined || column === undefined) return null;
    return rows[row]?.[column] ?? null;
  };
  return {
    gameVersion: data.gameVersion,
    blockTypes: data.blockTypes,
    relation: (centre, other) => {
      const char = relationChar(centre, other);
      if (char === null) return null;
      if (char === "-" || char === "o") return "self";
      return char === "x" ? "air" : "table";
    },
    blockCell: (centre, other, code) => {
      const block = data.blocks[String(centre)];
      if (block === undefined) return null;
      const alone = tables[block.alone];
      const char = other === null ? "x" : relationChar(centre, other);
      if (char === null || char === "x") return cellAt(alone, replaceDigit(code, 2, 0));
      if (char === "-" || char === "o") return cellAt(alone, replaceDigit(code, 2, 1));
      const table = block.tables[char.charCodeAt(0) - 65];
      return table === undefined ? null : cellAt(tables[table], code);
    },
    blockVariant: (centre, cell, variant) => {
      if (variant === 0) return cell;
      const index = cellKey.get(`${String(cell[0])},${String(cell[1])}`);
      const block = data.blocks[String(centre)];
      const entry = index === undefined || block === undefined ? undefined : variantMaps[block.variants]?.get(index);
      const target = entry === undefined ? undefined : data.cells[variant === 1 ? entry[0] : entry[1]];
      return target === undefined ? null : [target[0] ?? 0, target[1] ?? 0];
    },
    wallCell: (wall, code) => {
      const entry = data.walls[String(wall)];
      return entry === undefined ? null : cellAt(tables[entry.table], code);
    },
    cells: data.cells.map((cell): Cell => [cell[0] ?? 0, cell[1] ?? 0]),
    tableCount: tables.length,
    tableCell,
    aloneTable: (centre, x, y) => {
      const block = blockOf.get(centre);
      if (block === undefined) return null;
      if (block.byPosition === undefined) return block.alone;
      return block.byPosition[(((y % 4) + 4) % 4) * 6 + ((x % 6) + 6) % 6] ?? block.alone;
    },
    pairTable: (centre, other) => {
      const char = relationChar(centre, other);
      if (char === null || char === "-" || char === "o" || char === "x") return null;
      return blockOf.get(centre)?.tables[char.charCodeAt(0) - 65] ?? null;
    },
    variantCell: (centre, cell, variant) => {
      const block = blockOf.get(centre);
      const entry = block === undefined ? undefined : variantMaps[block.variants]?.get(cell);
      return entry === undefined ? -1 : variant === 1 ? entry[0] : entry[1];
    },
    ignoresVariant: (centre) => blockOf.get(centre)?.variantIgnoredByPosition === true,
  };
}
