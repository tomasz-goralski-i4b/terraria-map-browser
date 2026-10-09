import { beforeAll, describe, expect, test } from "vitest";
import { createWorld, type CanonicalWorld } from "@studio/world-model";
import {
  NO_CELL, createChunkWallCellCache, createWallFraming, loadFramingDatabase, terrariaFramingData, type WallFraming,
} from "../src/index.js";

let walls: WallFraming;
beforeAll(async () => {
  walls = createWallFraming(await loadFramingDatabase(terrariaFramingData));
});

/** A world with a deterministic mix of walls 1–3 and gaps, `size` tiles square. */
function mixedWorld(width: number, height: number): CanonicalWorld {
  const world = createWorld(width, height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if ((x * 7 + y * 5) % 6 === 0) continue;
      world.setTile(x, y, { wall: { kind: "vanilla", id: 1 + ((x * 3 + y) % 3) }, wires: 0, actuator: false });
    }
  }
  return world;
}

function frameWhole(world: CanonicalWorld): Uint16Array {
  const out = new Uint16Array(world.width * world.height);
  walls.frameRegion(world, { left: 0, top: 0, width: world.width, height: world.height }, out);
  return out;
}

describe("chunk wall cell cache", () => {
  test("a chunk's cells cover it and its apron, column-major, equal to framing the whole world; NO_CELL past the world", () => {
    const world = mixedWorld(20, 13);
    const whole = frameWhole(world);
    const cache = createChunkWallCellCache(world, walls, 8, 1);
    for (let cx = 0; cx < 3; cx++) {
      for (let cy = 0; cy < 2; cy++) {
        const cells = cache.cells({ x: cx, y: cy });
        expect(cells).toHaveLength(10 * 10);
        for (let i = 0; i < 10; i++) {
          for (let j = 0; j < 10; j++) {
            const x = cx * 8 - 1 + i;
            const y = cy * 8 - 1 + j;
            const inside = x >= 0 && y >= 0 && x < world.width && y < world.height;
            expect(cells[i * 10 + j], `(${String(x)}, ${String(y)})`).toBe(inside ? whole[x * world.height + y] : NO_CELL);
          }
        }
      }
    }
    expect(cache.cellAt(17, 12)).toBe(whole[17 * world.height + 12]);
  });

  test("cells are framed once per chunk: its in-world tiles and apron; reading it again frames nothing", () => {
    const world = mixedWorld(16, 16);
    const cache = createChunkWallCellCache(world, walls, 8, 1);
    expect(cache.framedTiles).toBe(0);
    cache.cells({ x: 0, y: 0 });
    // 9 × 9: the chunk and its apron inside the world (the apron's other half lies past the world's top-left edge).
    expect(cache.framedTiles).toBe(81);
    cache.cells({ x: 0, y: 0 });
    expect(cache.framedTiles).toBe(81);
    expect(cache.has({ x: 0, y: 0 })).toBe(true);
    cache.drop({ x: 0, y: 0 });
    expect(cache.has({ x: 0, y: 0 })).toBe(false);
    cache.cells({ x: 0, y: 0 });
    expect(cache.framedTiles).toBe(162);
  });

  /** Fills every cached cell with a sentinel, edits `edits`, invalidates them and checks what was recomputed. */
  function invalidate(edits: readonly (readonly [number, number])[], cached: readonly (readonly [number, number])[]): {
    recomputed: number; framed: number; regions: readonly { left: number; top: number; width: number; height: number }[];
  } {
    const world = mixedWorld(24, 24);
    const cache = createChunkWallCellCache(world, walls, 8, 1);
    const SENTINEL = 0xfffe;
    for (const [x, y] of cached) cache.cells({ x, y }).fill(SENTINEL);
    const before = cache.framedTiles;
    for (const [x, y] of edits) world.setTile(x, y, { wall: { kind: "vanilla", id: 5 }, wires: 0, actuator: false });
    const regions = cache.invalidate(edits.map(([x, y]) => ({ x, y })));
    const whole = frameWhole(world);
    let recomputed = 0;
    for (const [cx, cy] of cached) {
      const cells = cache.cells({ x: cx, y: cy });
      cells.forEach((cell, i) => {
        if (cell === SENTINEL) return;
        recomputed++;
        const x = cx * 8 - 1 + Math.floor(i / 10);
        const y = cy * 8 - 1 + (i % 10);
        expect(cell, `(${String(x)}, ${String(y)})`).toBe(whole[x * world.height + y]);
      });
    }
    return { recomputed, framed: cache.framedTiles - before, regions };
  }

  test("invalidating one changed tile recomputes exactly its 3 × 3 area", () => {
    expect(invalidate([[12, 12]], [[1, 1]])).toEqual({
      recomputed: 9, framed: 9, regions: [{ left: 11, top: 11, width: 3, height: 3 }],
    });
  });

  test("an area on a chunk border is recomputed in every cached chunk whose apron holds it", () => {
    // (8, 12) lies on the left edge of chunk (1, 1): its 3 × 3 area covers 2 columns of chunk (1, 1) plus 1 of its
    // apron, and 1 column of chunk (0, 1) plus 2 of its apron.
    expect(invalidate([[8, 12]], [[0, 1], [1, 1]])).toEqual({
      recomputed: 18, framed: 18, regions: [{ left: 7, top: 11, width: 3, height: 3 }],
    });
  });

  test("invalidation at the world's edge stays inside the world; chunks never framed are left alone", () => {
    const { recomputed, framed, regions } = invalidate([[0, 0], [23, 12]], [[0, 0]]);
    expect(regions).toEqual([{ left: 0, top: 0, width: 2, height: 2 }, { left: 22, top: 11, width: 2, height: 3 }]);
    expect({ recomputed, framed }).toEqual({ recomputed: 4, framed: 4 });
  });
});
