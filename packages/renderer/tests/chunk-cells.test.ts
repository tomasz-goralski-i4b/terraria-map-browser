import { beforeAll, describe, expect, test } from "vitest";
import { createWorld, type BlockShape, type CanonicalWorld } from "@studio/world-model";
import {
  NO_CELL, blockSourceRect, createBlockFraming, createChunkCellCache, loadFramingDatabase, neighbourhoodCode,
  shapedColumns, terrariaFramingData, type BlockFraming, type FramingDatabase,
} from "../src/index.js";

let database: FramingDatabase;
let framing: BlockFraming;
beforeAll(async () => {
  database = await loadFramingDatabase(terrariaFramingData);
  framing = createBlockFraming(database);
});

const DIRT = 0;
const STONE = 1;
const GRASS = 2;
const IRON = 6;
const COPPER = 7;
const SAND = 53;
const GREEN_MOSS = 179;
/** A large-frame block whose cells repeat over (x mod 3, y mod 4) (docs/assets.md, "Variant"). */
const LARGE_FRAME = 273;

/** Map legend: `T` is a dirt slope cut at its NE corner (shape 2), `H` a dirt half block (shape 1). */
const LEGEND: Readonly<Record<string, readonly [number, BlockShape]>> = {
  d: [DIRT, "full"], s: [STONE, "full"], c: [COPPER, "full"], i: [IRON, "full"], S: [SAND, "full"], g: [GRASS, "full"],
  m: [GREEN_MOSS, "full"], L: [LARGE_FRAME, "full"], T: [DIRT, "slopeTopRight"], H: [DIRT, "half"],
};

function worldOf(width: number, height: number): CanonicalWorld {
  return createWorld(width, height);
}

/** Writes `rows` (N to S) into `world` with their first character at (left, top); `.` stays air. */
function stamp(world: CanonicalWorld, left: number, top: number, rows: readonly string[]): void {
  rows.forEach((line, y) => {
    Array.from(line).forEach((char, x) => {
      const entry = LEGEND[char];
      if (entry === undefined) return;
      const [id, shape] = entry;
      world.setTile(left + x, top + y, {
        block: { kind: "vanilla", id }, wires: 0, actuator: false, ...(shape === "full" ? {} : { shape }),
      });
    });
  });
}

interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
type Cells = readonly (readonly [number, number])[];

/** The source rectangle of a look's cell v0 / v1 / v2 at the tile's variant (7x + 11y) mod 3 (docs/assets.md). */
function rectOf(x: number, y: number, cells: Cells): Rect {
  const cell = cells[(7 * x + 11 * y) % 3];
  if (cell === undefined) throw new Error("no cell");
  return { x: cell[0] * 18, y: cell[1] * 18, width: 16, height: 16 };
}

/**
 * docs/assets.md, "Worked examples" of "Tile framing": each example's map (an air ring included) and the tiles it lists
 * by their offset in the map, with the look's cells v0 / v1 / v2.
 */
const EXAMPLES: readonly (readonly [string, readonly string[], readonly (readonly [number, number, Cells])[]])[] = [
  ["1", [".....", ".....", "..d..", ".....", "....."], [[2, 2, [[9, 3], [10, 3], [11, 3]]]]],
  ["2", [".....", ".....", "..dd.", ".....", "....."], [[2, 2, [[9, 0], [9, 1], [9, 2]]]]],
  ["3", [".....", ".....", ".ddd.", ".ddd.", "....."], [[2, 2, [[1, 0], [2, 0], [3, 0]]]]],
  ["4", [".....", ".....", "..dd.", "..dd.", "....."], [[2, 2, [[0, 3], [2, 3], [4, 3]]]]],
  ["5", [".....", ".ddd.", ".ddd.", ".ddd.", "....."], [[2, 2, [[1, 1], [2, 1], [3, 1]]]]],
  ["6", [".....", "..d..", ".ddd.", ".ddd.", "....."], [[2, 2, [[6, 1], [7, 1], [8, 1]]]]],
  ["7", [".....", "..d..", ".ddd.", "..d..", "....."], [[2, 2, [[6, 1], [7, 1], [8, 1]]]]],
  ["8a, 8b", ["......", ".ddss.", ".ddss.", ".ddss.", "......"], [
    [2, 2, [[1, 1], [2, 1], [3, 1]]],
    [3, 2, [[9, 7], [9, 8], [9, 9]]],
  ]],
  ["9", [".....", ".sss.", ".ssd.", ".sss.", "....."], [[2, 2, [[8, 7], [8, 8], [8, 9]]]]],
  ["10", [".....", ".ddd.", ".dsd.", ".ddd.", "....."], [[2, 2, [[6, 11], [7, 11], [8, 11]]]]],
  ["11", [".....", "..d..", ".sss.", ".....", "....."], [[2, 2, [[13, 1], [14, 1], [15, 1]]]]],
  ["12", [".....", ".sss.", ".sss.", ".ssd.", "....."], [[2, 2, [[0, 5], [0, 7], [0, 9]]]]],
  ["13", [".....", ".ss..", ".dss.", ".dd..", "....."], [[2, 2, [[2, 6], [2, 8], [2, 10]]]]],
  ["14a, 14b", ["......", "..dd..", "..sdd.", "......"], [
    [2, 2, [[9, 3], [10, 3], [11, 3]]],
    [3, 2, [[0, 4], [2, 4], [4, 4]]],
  ]],
  ["15", [".....", ".ddd.", ".dcd.", ".ddd.", "....."], [[2, 2, [[6, 11], [7, 11], [8, 11]]]]],
  ["16a, 16b", ["......", ".ccii.", "......"], [
    [2, 1, [[12, 0], [12, 1], [12, 2]]],
    [3, 1, [[9, 0], [9, 1], [9, 2]]],
  ]],
  ["17", [".....", ".sss.", ".scs.", ".sss.", "....."], [[2, 2, [[9, 3], [10, 3], [11, 3]]]]],
  ["18", [".....", ".....", ".dT..", ".dd..", "....."], [[2, 2, [[1, 3], [3, 3], [5, 3]]]]],
  ["19", [".....", ".....", ".dHd.", ".....", "....."], [[2, 2, [[6, 4], [7, 4], [8, 4]]]]],
];

describe("chunk cell cache", () => {
  test("worked examples 1–19 map each listed tile to its documented source rectangle, across chunk borders", () => {
    // Chunks of 4 tiles: every example spans several chunks, and every listed tile has neighbours in another chunk
    // (the first listed tile of each example sits in the first column and row of a chunk).
    const chunkSize = 4;
    const world = worldOf(EXAMPLES.length * 8, 12);
    const placed = EXAMPLES.map(([name, rows, tiles], index) => {
      const [firstX, firstY] = tiles[0] ?? [0, 0];
      const left = index * 8 + 4 - firstX;
      const top = 4 - firstY;
      stamp(world, left, top, rows);
      return { name, left, top, tiles };
    });
    const cache = createChunkCellCache(world, framing, chunkSize);
    let borderTiles = 0;
    for (const { name, left, top, tiles } of placed) {
      for (const [dx, dy, cells] of tiles) {
        const x = left + dx;
        const y = top + dy;
        if (x % chunkSize === 0 || x % chunkSize === chunkSize - 1 || y % chunkSize === 0) borderTiles++;
        expect(blockSourceRect(cache.cellAt(x, y)), `example ${name} at (${String(x)}, ${String(y)})`)
          .toEqual(rectOf(x, y, cells));
      }
    }
    expect(borderTiles).toBe(22);
  });

  test("a chunk's cells equal framing the whole world at once: grass on dirt, moss on stone, a large-frame slab", () => {
    const chunkSize = 8;
    const world = worldOf(40, 24);
    stamp(world, 2, 4, [
      "....gggg..ggg......",
      "..ggddddggdddg.....",
      ".gdddddddddddd.....",
      ".dddddddddddddd....",
    ]);
    stamp(world, 23, 3, [
      "....mmm.......",
      "..mmssssmm....",
      ".mssssssssm...",
      ".ssssssssss...",
    ]);
    stamp(world, 3, 12, ["LLLLLLLLL", "LLLLLLLLL", "LLLLLLLLL", "LLLLLLLLL", "LLLLLLLLL", "LLLLLLLLL", "LLLLLLLLL"]);
    const whole = new Uint16Array(world.width * world.height);
    framing.frameRegion(world, { left: 0, top: 0, width: world.width, height: world.height }, whole);
    const cache = createChunkCellCache(world, framing, chunkSize);
    let framed = 0;
    for (let x = 0; x < world.width; x++) {
      for (let y = 0; y < world.height; y++) {
        const expected = whole[x * world.height + y] ?? NO_CELL;
        expect(cache.cellAt(x, y), `(${String(x)}, ${String(y)})`).toBe(expected);
        if (expected !== NO_CELL) framed++;
      }
    }
    expect(framed).toBe(46 + 31 + 63);
  });

  test("grass and moss tiles take the framing database's cell for their neighbourhood and variant", () => {
    const world = worldOf(40, 16);
    stamp(world, 2, 4, ["..gggggggg..", ".gddddddddg.", "dddddddddddd"]);
    stamp(world, 20, 4, ["..mmmmmmmm..", ".mssssssssm.", "ssssssssssss"]);
    const cache = createChunkCellCache(world, framing, 4);
    const typeAt = (x: number, y: number): number => {
      const block = world.planes.block[x * world.height + y] ?? 0xffff;
      const ref = block === 0xffff ? undefined : world.palette[block];
      return ref?.kind === "vanilla" ? ref.id : -1;
    };
    const around = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;
    let checked = 0;
    for (const [centre, other] of [[GRASS, DIRT], [GREEN_MOSS, STONE]] as const) {
      for (let x = 0; x < world.width; x++) {
        for (let y = 0; y < world.height; y++) {
          if (typeAt(x, y) !== centre) continue;
          const digits = around.map(([dx, dy]) => {
            const type = typeAt(x + dx, y + dy);
            return type === -1 ? 0 : type === centre ? 1 : 2;
          });
          const v0 = database.blockCell(centre, other, neighbourhoodCode(digits));
          if (v0 === null) throw new Error("unstable");
          const cell = database.blockVariant(centre, v0, (7 * x + 11 * y) % 3) ?? v0;
          expect(blockSourceRect(cache.cellAt(x, y)), `${String(centre)} at (${String(x)}, ${String(y)})`)
            .toEqual({ x: cell[0] * 18, y: cell[1] * 18, width: 16, height: 16 });
          checked++;
        }
      }
    }
    expect(checked).toBe(20);
  });

  test("a large-frame slab takes its plain-interior cells by position (x mod 3, y mod 4)", () => {
    const world = worldOf(16, 16);
    stamp(world, 2, 2, Array.from({ length: 10 }, () => "LLLLLLLLLL"));
    const cache = createChunkCellCache(world, framing, 4);
    // docs/assets.md, "Variant": the 3 × 4 kind's plain interior, by (x mod 3, y mod 4).
    const interior: readonly (readonly (readonly [number, number])[])[] = [
      [[2, 1], [3, 6], [2, 1]],
      [[1, 1], [3, 1], [1, 1]],
      [[2, 1], [2, 1], [3, 6]],
      [[1, 1], [1, 1], [3, 1]],
    ];
    for (let x = 3; x <= 10; x++) {
      for (let y = 3; y <= 10; y++) {
        const cell = interior[y % 4]?.[x % 3] ?? [0, 0];
        expect(blockSourceRect(cache.cellAt(x, y)), `(${String(x)}, ${String(y)})`)
          .toEqual({ x: cell[0] * 18, y: cell[1] * 18, width: 16, height: 16 });
      }
    }
  });

  test("a sand block with air below it has no cell (unstable); a supported one has its cell", () => {
    const world = worldOf(12, 12);
    stamp(world, 2, 2, ["S...S", "....s"]);
    const cache = createChunkCellCache(world, framing, 4);
    expect(cache.cellAt(2, 2)).toBe(NO_CELL);
    expect(blockSourceRect(cache.cellAt(2, 2))).toBeNull();
    expect(cache.cellAt(6, 2)).not.toBe(NO_CELL);
  });

  test("cells are framed once per chunk: reading a cached chunk again frames nothing", () => {
    const world = worldOf(20, 20);
    stamp(world, 0, 10, Array.from({ length: 10 }, () => "dddddddddddddddddddd"));
    const cache = createChunkCellCache(world, framing, 8);
    expect(cache.framedTiles).toBe(0);
    const first = cache.cells({ x: 1, y: 1 });
    expect(first.length).toBe(64);
    expect(cache.framedTiles).toBe(64);
    expect(cache.cells({ x: 1, y: 1 })).toBe(first);
    cache.cellAt(9, 9);
    expect(cache.framedTiles).toBe(64);
    // A chunk clipped by the world's edge holds only its tiles.
    expect(cache.cells({ x: 2, y: 2 }).length).toBe(16);
    expect(cache.framedTiles).toBe(80);
    expect(cache.has({ x: 0, y: 0 })).toBe(false);
    cache.drop({ x: 1, y: 1 });
    expect(cache.has({ x: 1, y: 1 })).toBe(false);
    cache.cells({ x: 1, y: 1 });
    expect(cache.framedTiles).toBe(144);
  });

  /**
   * Invalidation recomputes the cached cells of the (2d + 3)² area around a changed tile, d the deepest depth of the
   * types within 6 tiles of it, and nothing else: cells outside it keep a sentinel written into the cache.
   */
  function invalidateMany(
    fill: string, edits: readonly (readonly [number, number])[], size = 40, chunkSize = 8,
  ): { recomputed: number; framed: number; regions: number; area: number } {
    const world = worldOf(size, size);
    stamp(world, 0, 0, Array.from({ length: size }, () => fill.repeat(size)));
    // Counts the tiles every frameRegion call frames, to show that no area beyond the invalidated ones is framed.
    let area = 0;
    const counted: BlockFraming = {
      ...framing,
      frameRegion: (target, region, out) => {
        area += region.width * region.height;
        framing.frameRegion(target, region, out);
      },
    };
    const cache = createChunkCellCache(world, counted, chunkSize);
    const per = size / chunkSize;
    const chunks: { x: number; y: number }[] = [];
    for (let cx = 0; cx < per; cx++) for (let cy = 0; cy < per; cy++) chunks.push({ x: cx, y: cy });
    const fresh = chunks.map((chunk) => Uint16Array.from(cache.cells(chunk)));
    const SENTINEL = 0xfffe;
    for (const chunk of chunks) cache.cells(chunk).fill(SENTINEL);
    const before = cache.framedTiles;
    for (const [x, y] of edits) world.setTile(x, y, { block: { kind: "vanilla", id: IRON }, wires: 0, actuator: false });
    area = 0;
    const regions = cache.invalidate(edits.map(([x, y]) => ({ x, y })));
    const framed = cache.framedTiles - before;
    let recomputed = 0;
    const whole = new Uint16Array(size * size);
    framing.frameRegion(world, { left: 0, top: 0, width: size, height: size }, whole);
    chunks.forEach((chunk, index) => {
      const cells = cache.cells(chunk);
      for (let i = 0; i < chunkSize * chunkSize; i++) {
        const tx = chunk.x * chunkSize + Math.floor(i / chunkSize);
        const ty = chunk.y * chunkSize + (i % chunkSize);
        if (cells[i] === SENTINEL) continue;
        recomputed++;
        expect(cells[i], `(${String(tx)}, ${String(ty)})`).toBe(whole[tx * size + ty]);
      }
      expect(fresh[index]?.length).toBe(chunkSize * chunkSize);
    });
    return { recomputed, framed, regions: regions.reduce((sum, region) => sum + region.width * region.height, 0), area };
  }

  function invalidateOne(fill: string, x: number, y: number): { recomputed: number; framed: number } {
    const { recomputed, framed, regions } = invalidateMany(fill, [[x, y]]);
    expect(regions).toBe(recomputed);
    return { recomputed, framed };
  }

  test("invalidating one tile in a stone area recomputes exactly the 3 × 3 cells around it", () => {
    expect(invalidateOne("s", 20, 20)).toEqual({ recomputed: 9, framed: 9 });
  });

  test("invalidating one tile where dirt is recomputes exactly the 13 × 13 cells around it (dirt has depth 5)", () => {
    expect(framing.depth(DIRT)).toBe(5);
    expect(invalidateOne("d", 20, 20)).toEqual({ recomputed: 169, framed: 169 });
  });

  test("invalidation across a chunk corner and at the world's edge stays inside the world and the cached chunks", () => {
    expect(invalidateOne("s", 15, 16)).toEqual({ recomputed: 9, framed: 9 });
    expect(invalidateOne("d", 0, 39)).toEqual({ recomputed: 49, framed: 49 });
  });

  test("a batch of overlapping edits across a chunk border writes each cached tile of the union once", () => {
    // Three stone edits whose 3 × 3 areas overlap on the corner of four 8-tile chunks: their union is 4 × 4 less
    // the corner (14, 17) that none covers.
    expect(invalidateMany("s", [[15, 15], [16, 16], [16, 15]])).toEqual({ recomputed: 15, framed: 15, regions: 27, area: 27 });
  });

  test("sparse edits in one chunk frame only their own areas, not the box between them", () => {
    expect(invalidateMany("s", [[16, 16], [112, 112]], 128, 128)).toEqual({ recomputed: 18, framed: 18, regions: 18, area: 18 });
  });

  test("invalidation leaves chunks that were never framed alone: they frame lazily later", () => {
    const world = worldOf(32, 32);
    stamp(world, 0, 0, Array.from({ length: 32 }, () => "d".repeat(32)));
    const cache = createChunkCellCache(world, framing, 8);
    cache.cells({ x: 0, y: 0 });
    const before = cache.framedTiles;
    // The 13 × 13 area around (8, 8) covers parts of four chunks; only chunk (0, 0) is cached: 6 × 6 of its cells.
    const regions = cache.invalidate([{ x: 8, y: 8 }]);
    expect(cache.framedTiles - before).toBe(36);
    expect(regions).toEqual([{ left: 2, top: 2, width: 13, height: 13 }]);
    expect(cache.has({ x: 1, y: 1 })).toBe(false);
  });
});

describe("source rectangles", () => {
  test("a packed cell is the 16 × 16 rectangle at 18 pixels per cell; NO_CELL has none", () => {
    expect(blockSourceRect(9 * 64 + 3)).toEqual({ x: 162, y: 54, width: 16, height: 16 });
    expect(blockSourceRect(NO_CELL)).toBeNull();
  });

  // docs/assets.md, "Slopes and half blocks": eight 2-pixel columns i = 0…7 of the cell per shape.
  test("a half block (shape 1) draws cell rows 0–7 in tile rows 8–15, in every column", () => {
    expect(shapedColumns(1)).toEqual(Array.from({ length: 8 }, (_, i) => ({
      sourceX: 2 * i, sourceY: 0, destX: 2 * i, destY: 8, width: 2, height: 8,
    })));
  });

  test("a slope cut at its NE corner (shape 2) draws cell rows 0 … 15 − 2i of column i, moved down by 2i", () => {
    expect(shapedColumns(2)).toEqual(Array.from({ length: 8 }, (_, i) => ({
      sourceX: 2 * i, sourceY: 0, destX: 2 * i, destY: 2 * i, width: 2, height: 16 - 2 * i,
    })));
  });

  test("slopes 3–5 and the full block follow the shape table", () => {
    /** Column i of every shape: (sourceY, destY, height). */
    const table = (column: (i: number) => readonly [number, number, number]): object[] =>
      Array.from({ length: 8 }, (_, i) => {
        const [sourceY, destY, height] = column(i);
        return { sourceX: 2 * i, sourceY, destX: 2 * i, destY, width: 2, height };
      });
    expect(shapedColumns(0)).toEqual(table(() => [0, 0, 16]));
    expect(shapedColumns(3)).toEqual(table((i) => [0, 14 - 2 * i, 2 * i + 2]));
    expect(shapedColumns(4)).toEqual(table((i) => [2 * i, 0, 16 - 2 * i]));
    expect(shapedColumns(5)).toEqual(table((i) => [0, 0, 2 * i + 2]));
  });
});
