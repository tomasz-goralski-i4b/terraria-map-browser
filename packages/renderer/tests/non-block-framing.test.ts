import { beforeAll, describe, expect, test } from "vitest";
import { createWorld, type CanonicalWorld } from "@studio/world-model";
import {
  NO_CELL, UNSTABLE_CELL, createBlockFraming, createChunkCellCache, createNonBlockFraming, loadFramingDatabase,
  terrariaFramingData, type BlockFraming, type FramingDatabase, type NonBlockFraming, type TypeAt,
} from "../src/index.js";

let database: FramingDatabase;
let nonBlocks: NonBlockFraming;
let framing: BlockFraming;
beforeAll(async () => {
  database = await loadFramingDatabase(terrariaFramingData);
  nonBlocks = createNonBlockFraming(database);
  framing = createBlockFraming(database);
});

const DIRT = 0;
const GRASS = 2;
const VINE = 52;
const JUNGLE_GRASS = 60;
const JUNGLE_VINE = 62;
const SAND = 53;
const CACTUS = 80;
const STONE = 1;

const pack = (column: number, row: number): number => column * 64 + row;
/** The packed cell of a database cell index. */
const packed = (index: number): number => {
  const [column = 0, row = 0] = database.cells[index] ?? [];
  return pack(column, row);
};

/** A tile of `type` at (x, 1) with `above`, `below`, `west` and `east` around it (−1: none). */
function around(type: number, x: number, above: number, below: number, west = -1, east = -1): TypeAt {
  return (tx, ty) => {
    if (tx === x) return ty === 0 ? above : ty === 1 ? type : ty === 2 ? below : -1;
    return ty !== 1 ? -1 : tx === x - 1 ? west : tx === x + 1 ? east : -1;
  };
}

/** The cells of the hanging tile at three positions in a row, which take the three variants. */
function cellsAt(type: number, above: number, below: number, west = -1, east = -1): Set<number> {
  return new Set([3, 4, 5].map((x) => nonBlocks.cell(around(type, x, above, below, west, east), type, x, 1)));
}

describe("vines (hanging types)", () => {
  test("every hanging type takes the database's cells for every tile above, below and beside the game was observed with", () => {
    expect([...database.hanging.keys()].sort((a, b) => a - b)).toEqual([52, 62, 115, 205, 382, 528, 636, 638]);
    let checked = 0;
    for (const [type, data] of database.hanging) {
      for (const group of data.groups) {
        const joins = [group.below, group.west, group.east];
        const expected = (combo: number): Set<number> => {
          const cells = group.cells[combo] ?? [];
          return new Set(cells.length === 0 ? [NO_CELL] : cells.map(packed));
        };
        for (const above of group.above) {
          // Every combination with the first joining tile of each side, and every joining tile alone.
          for (let combo = 0; combo < 8; combo++) {
            const at = joins.map((list, side) => ((combo >> side) & 1) === 1 ? list[0] : -1);
            if (at.some((id) => id === undefined)) continue;
            expect(cellsAt(type, above, at[0] ?? -1, at[1] ?? -1, at[2] ?? -1)).toEqual(expected(combo));
            checked++;
          }
          joins.forEach((list, side) => {
            for (const id of list) {
              const at = [-1, -1, -1];
              at[side] = id;
              expect(cellsAt(type, above, at[0] ?? -1, at[1] ?? -1, at[2] ?? -1)).toEqual(expected(1 << side));
              checked++;
            }
          });
        }
      }
      // Nothing above, or a tile that does not hold it: the game removes it, so it has no cell.
      const holds = new Set(data.groups.flatMap((group) => group.above));
      for (const above of [-1, DIRT, SAND].filter((id) => !holds.has(id))) {
        expect(cellsAt(type, above, -1)).toEqual(new Set([NO_CELL]));
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  test("a grass vine takes the documented cells", () => {
    const columns = (first: number, row: number): Set<number> => new Set([first, first + 1, first + 2].map((c) => pack(c, row)));
    const rows = (columnIndex: number): Set<number> => new Set([0, 1, 2].map((row) => pack(columnIndex, row)));
    expect(cellsAt(VINE, GRASS, -1)).toEqual(columns(9, 3));
    expect(cellsAt(VINE, GRASS, VINE)).toEqual(columns(6, 0));
    expect(cellsAt(VINE, VINE, -1)).toEqual(columns(6, 3));
    expect(cellsAt(VINE, VINE, VINE)).toEqual(rows(5));
    expect(cellsAt(VINE, GRASS, -1, -1, VINE)).toEqual(rows(9));
    expect(cellsAt(VINE, GRASS, -1, VINE, -1)).toEqual(rows(12));
    expect(cellsAt(VINE, VINE, VINE, VINE, VINE)).toEqual(columns(6, 1));
    // Another vine type beside it does not join it.
    expect(cellsAt(VINE, GRASS, -1, JUNGLE_VINE, JUNGLE_VINE)).toEqual(columns(9, 3));
    // Jungle grass holds a grass vine too (the game turns it into a jungle vine, with the same cells).
    expect(cellsAt(VINE, JUNGLE_GRASS, -1)).toEqual(columns(9, 3));
  });
});

describe("cactus (standing types)", () => {
  test("every window configuration takes the database's cell on every tile", () => {
    const data = database.standing.get(CACTUS);
    if (data === undefined) throw new Error("no cactus in the database");
    expect(data.roots).toEqual([53, 112, 116, 234]);
    const { width, height, windowCells } = data;
    const tiles = width * height;
    expect(windowCells).toHaveLength(2 ** (tiles + width));
    const unstable = database.cells.findIndex((cell) => cell[0] === UNSTABLE_CELL[0] && cell[1] === UNSTABLE_CELL[1]);
    let checked = 0;
    windowCells.forEach((line, config) => {
      const typeAt: TypeAt = (x, y) => {
        if (x < 0 || x >= width || y < 0) return -1;
        if (y < height) return ((config >> (y * width + x)) & 1) === 1 ? CACTUS : -1;
        return y === height && ((config >> (tiles + x)) & 1) === 1 ? (data.roots[0] ?? -1) : -1;
      };
      let at = 0;
      for (let i = 0; i < tiles; i++) {
        if (((config >> i) & 1) === 0) continue;
        const index = line.charCodeAt(at++) - 48;
        const expected = index === unstable ? NO_CELL : packed(index);
        const got = nonBlocks.cell(typeAt, CACTUS, i % width, Math.floor(i / width));
        if (got !== expected) throw new Error(`window ${String(config)}, tile ${String(i)}: ${String(got)}, the game ${String(expected)}`);
        checked++;
      }
    });
    expect(checked).toBe(tiles * 2 ** (tiles + width - 1));
  });

  test("a cactus with arms: trunk, arms and branches take the documented cells", () => {
    // Columns 0–2; the trunk in column 1 on sand, a west branch rising from its second tile, an east arm on its third.
    const rows = [".c.", "cc.", ".cc", ".c.", ".S."];
    const typeAt: TypeAt = (x, y) => {
      const char = rows[y]?.[x];
      return char === "c" ? CACTUS : char === "S" ? SAND : -1;
    };
    const cell = (x: number, y: number): number => nonBlocks.cell(typeAt, CACTUS, x, y);
    expect(cell(1, 0)).toBe(pack(0, 0));
    expect(cell(1, 1)).toBe(pack(4, 2));
    expect(cell(1, 2)).toBe(pack(1, 2));
    expect(cell(1, 3)).toBe(pack(0, 2));
    expect(cell(0, 1)).toBe(pack(6, 2));
    expect(cell(2, 2)).toBe(pack(6, 1));
  });
});

describe("invalidation of vines and cactus", () => {
  function setBlock(world: CanonicalWorld, x: number, y: number, id: number | null): void {
    world.setTile(x, y, id === null ? { wires: 0, actuator: false } : { block: { kind: "vanilla", id }, wires: 0, actuator: false });
  }

  /** Every chunk's cells after `edit` and invalidating `changed` equal those of a cache framed afresh. */
  function expectInvalidated(world: CanonicalWorld, edit: () => void, changed: readonly (readonly [number, number])[]): number {
    const cache = createChunkCellCache(world, framing, 8);
    const chunks: { x: number; y: number }[] = [];
    for (let x = 0; x * 8 < world.width; x++) for (let y = 0; y * 8 < world.height; y++) chunks.push({ x, y });
    const before = chunks.map((chunk) => Uint16Array.from(cache.cells(chunk)));
    edit();
    cache.invalidate(changed.map(([x, y]) => ({ x, y })));
    const fresh = createChunkCellCache(world, framing, 8);
    let differ = 0;
    chunks.forEach((chunk, index) => {
      expect(Array.from(cache.cells(chunk))).toEqual(Array.from(fresh.cells(chunk)));
      const old = before[index] ?? new Uint16Array(0);
      differ += Array.from(fresh.cells(chunk)).filter((cell, at) => cell !== old[at]).length;
    });
    return differ;
  }

  test("taking the sand from under a tall cactus reframes the whole plant, across chunks", () => {
    const world = createWorld(16, 40);
    for (let y = 8; y < 30; y++) setBlock(world, 6, y, CACTUS);
    for (let y = 12; y < 16; y++) setBlock(world, 5, y, CACTUS);
    setBlock(world, 6, 30, SAND);
    setBlock(world, 6, 31, STONE);
    const cache = createChunkCellCache(world, framing, 8);
    expect(cache.cellAt(6, 8)).toBe(pack(0, 0));
    expect(cache.cellAt(5, 12)).toBe(pack(3, 0));
    // 22 trunk tiles and 4 branch tiles lose their cells: far beyond the blocks' reach of 6 tiles.
    expect(expectInvalidated(world, () => { setBlock(world, 6, 30, null); }, [[6, 30]])).toBe(26);
  });

  test("taking a tile from a vine reframes the vine above it", () => {
    const world = createWorld(16, 16);
    setBlock(world, 4, 3, GRASS);
    setBlock(world, 4, 2, DIRT);
    for (let y = 4; y < 9; y++) setBlock(world, 4, y, VINE);
    expect(expectInvalidated(world, () => { setBlock(world, 4, 8, null); }, [[4, 8]])).toBeGreaterThanOrEqual(1);
  });

  test("a cactus arm two columns away reframes the trunk it no longer reaches", () => {
    const world = createWorld(16, 16);
    for (let y = 4; y < 8; y++) setBlock(world, 6, y, CACTUS);
    setBlock(world, 6, 8, SAND);
    setBlock(world, 5, 5, CACTUS);
    // A tile beyond the west arm stops the trunk from counting it.
    expect(expectInvalidated(world, () => { setBlock(world, 4, 5, CACTUS); }, [[4, 5]])).toBeGreaterThanOrEqual(1);
  });
});
