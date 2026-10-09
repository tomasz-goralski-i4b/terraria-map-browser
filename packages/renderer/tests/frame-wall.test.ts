import { beforeAll, describe, expect, test } from "vitest";
import { createWorld, type CanonicalWorld, type ContentRef } from "@studio/world-model";
import {
  NO_CELL, WALL_SIDE, createWallFraming, loadFramingDatabase, terrariaFramingData, wallSourceRect,
  type FramingDatabase, type WallFraming,
} from "../src/index.js";

let database: FramingDatabase;
let walls: WallFraming;
beforeAll(async () => {
  database = await loadFramingDatabase(terrariaFramingData);
  walls = createWallFraming(database);
});

const WALL_IDS = Object.keys(terrariaFramingData.walls).map(Number);
/** The reference position of the database's 6 561-neighbourhood tables; its variant (7x + 11y) mod 3 is 0. */
const REFERENCE = 30;
/** Neighbourhood code digits of the sides N, E, S, W (NEIGHBOUR_ORDER NW N NE W E SW S SE). */
const SIDE_SLOTS = [[1, WALL_SIDE.north], [4, WALL_SIDE.east], [6, WALL_SIDE.south], [3, WALL_SIDE.west]] as const;
/** The interior table's corner code of "every corner the same wall" (Σ 1 × 3^k). */
const SAME_CORNERS = 40;

const packed = (cell: readonly [number, number] | null): number => (cell === null ? NO_CELL : cell[0] * 64 + cell[1]);

/** The side bits of a neighbourhood code: a side counts when it has any wall (digit 1 or 2). */
function sidesOf(code: number): number {
  let sides = 0;
  for (const [slot, bit] of SIDE_SLOTS) if (Math.floor(code / 3 ** slot) % 3 !== 0) sides |= bit;
  return sides;
}

/** The database's variant-0 interior cell of `wall` at position (a, b) = (x mod 12, y mod 12). */
function databaseInterior(wall: number, a: number, b: number): number {
  const entry = terrariaFramingData.walls[String(wall)];
  if (entry === undefined) throw new Error(`no wall ${String(wall)}`);
  const cell = database.cells[database.tableCell(entry.interiorByPosition, (b * 12 + a) * 81 + SAME_CORNERS)];
  return packed(cell ?? null);
}

function wallWorld(width: number, height: number): CanonicalWorld {
  return createWorld(width, height);
}

function put(world: CanonicalWorld, x: number, y: number, wall: number | null, block: ContentRef | null = null): void {
  world.setTile(x, y, {
    ...(wall === null ? {} : { wall: { kind: "vanilla" as const, id: wall } }),
    ...(block === null ? {} : { block }),
    wires: 0, actuator: false,
  });
}

/** Frames the whole world and returns the cell of (x, y). */
function framedAt(world: CanonicalWorld, x: number, y: number): number {
  const out = new Uint16Array(world.width * world.height);
  walls.frameRegion(world, { left: 0, top: 0, width: world.width, height: world.height }, out);
  return out[x * world.height + y] ?? -1;
}

describe("wall framing", () => {
  test("every wall type in all 6 561 neighbourhoods takes the database's cell (variant 0, reference position)", () => {
    expect(WALL_IDS).toHaveLength(366);
    let mismatches = 0;
    let first = "";
    for (const wall of WALL_IDS) {
      for (let code = 0; code < 6561; code++) {
        const expected = packed(database.wallCell(wall, code));
        const actual = walls.wallCell(wall, sidesOf(code), REFERENCE, REFERENCE, 0);
        if (actual === expected) continue;
        mismatches++;
        first ||= `wall ${String(wall)} code ${String(code)}: ${String(actual)} instead of ${String(expected)}`;
      }
    }
    // expect() only on a mismatch: 2.4 million calls to it would dominate the run.
    expect(first).toBe("");
    expect(mismatches).toBe(0);
  });

  test("the interior cell equals the database's at all 144 positions (x mod 12, y mod 12), large-frame walls included", () => {
    let first = "";
    for (const wall of WALL_IDS) {
      for (let b = 0; b < 12; b++) {
        for (let a = 0; a < 12; a++) {
          const expected = databaseInterior(wall, a, b);
          // Two periods apart: the position repeats every 12 tiles.
          for (const [x, y] of [[36 + a, 36 + b], [a, 24 + b]] as const) {
            const actual = walls.wallCell(wall, 15, x, y, 0);
            if (actual !== expected) first ||= `wall ${String(wall)} at (${String(x)}, ${String(y)}): ${String(actual)} instead of ${String(expected)}`;
          }
        }
      }
    }
    expect(first).toBe("");
  });

  test("ordinary walls interior by (x mod 3, y mod 3) at variant 0 (docs/assets.md, \"Walls\")", () => {
    const table: readonly (readonly (readonly [number, number])[])[] = [
      [[6, 2], [1, 1], [1, 1]], [[1, 1], [6, 1], [10, 0]], [[1, 1], [11, 0], [1, 1]],
    ];
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) {
        const cell = table[y % 3]?.[x % 3] ?? [0, 0];
        expect(walls.wallCell(1, 15, x, y, 0)).toBe(cell[0] * 64 + cell[1]);
      }
    }
  });

  test("ordinary walls vary by (7x + 11y) mod 3 through the variant map; large-frame walls ignore the variant", () => {
    // The database's variant map of wall 1: the lone cell (9, 3) → (10, 3), (11, 3); the interior (6, 2) → (7, 2), (8, 2).
    expect(walls.wallCell(1, 0, 0, 0)).toBe(9 * 64 + 3);
    expect(walls.wallCell(1, 0, 1, 0)).toBe(10 * 64 + 3);
    expect(walls.wallCell(1, 0, 2, 0)).toBe(11 * 64 + 3);
    expect(walls.wallCell(1, 0, 2, 0, 1)).toBe(10 * 64 + 3);
    // (3, 3): the interior (6, 2) at variant (21 + 33) mod 3 = 0.
    expect(walls.wallCell(1, 15, 3, 3)).toBe(6 * 64 + 2);
    expect(walls.wallCell(1, 15, 3, 3, 2)).toBe(8 * 64 + 2);
    // Large-frame walls (6 × 6: 185; 3 × 12: 146): every variant gives the same cell.
    for (const wall of [146, 185]) {
      for (const sides of [0, 5, 15]) {
        for (const [x, y] of [[0, 0], [1, 0], [2, 0], [7, 5]] as const) {
          const cell = walls.wallCell(wall, sides, x, y, 0);
          expect(walls.wallCell(wall, sides, x, y, 1)).toBe(cell);
          expect(walls.wallCell(wall, sides, x, y, 2)).toBe(cell);
          expect(walls.wallCell(wall, sides, x, y)).toBe(cell);
        }
      }
    }
  });

  test("a large-frame wall's interior repeats by position: 3 × 12 for 146, 6 × 6 for 185", () => {
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        expect(walls.wallCell(146, 15, x, y)).toBe(walls.wallCell(146, 15, x + 3, y + 12));
        expect(walls.wallCell(185, 15, x, y)).toBe(walls.wallCell(185, 15, x + 6, y + 6));
      }
    }
    expect(new Set(Array.from({ length: 36 }, (_, i) => walls.wallCell(146, 15, i % 3, Math.floor(i / 3)))).size).toBeGreaterThan(3);
  });

  test("a side counts with any wall (another type like the same), never a diagonal", () => {
    const world = wallWorld(5, 5);
    put(world, 2, 2, 1);
    const lone = framedAt(world, 2, 2);
    expect(lone).toBe(walls.wallCell(1, 0, 2, 2));
    for (const [x, y] of [[1, 1], [3, 1], [1, 3], [3, 3]] as const) put(world, x, y, 4);
    expect(framedAt(world, 2, 2)).toBe(lone);
    put(world, 3, 2, 1);
    const sameEast = framedAt(world, 2, 2);
    put(world, 3, 2, 77);
    expect(framedAt(world, 2, 2)).toBe(sameEast);
    expect(sameEast).toBe(walls.wallCell(1, WALL_SIDE.east, 2, 2));
    expect(sameEast).not.toBe(lone);
  });

  test("an active block of 54, 328, 459 or 748 counts as a side neighbour; any other block does not", () => {
    expect([...walls.neighbourBlocks].sort((a, b) => a - b)).toEqual([54, 328, 459, 748]);
    const counted: number[] = [];
    for (let block = 0; block < 760; block++) {
      const world = wallWorld(3, 3);
      put(world, 1, 1, 1);
      put(world, 2, 1, null, { kind: "vanilla", id: block });
      const cell = framedAt(world, 1, 1);
      if (cell === walls.wallCell(1, WALL_SIDE.east, 1, 1)) counted.push(block);
      else expect(cell, `block ${String(block)}`).toBe(walls.wallCell(1, 0, 1, 1));
    }
    expect(counted).toEqual([54, 328, 459, 748]);
    // Modded blocks never count.
    const world = wallWorld(3, 3);
    put(world, 1, 1, 1);
    put(world, 2, 1, null, { kind: "mod", mod: "Example", internalName: "Glass" });
    expect(framedAt(world, 1, 1)).toBe(walls.wallCell(1, 0, 1, 1));
  });

  test("a neighbour outside the world counts as absent", () => {
    const world = wallWorld(3, 3);
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) put(world, x, y, 1);
    expect(framedAt(world, 0, 0)).toBe(walls.wallCell(1, WALL_SIDE.east | WALL_SIDE.south, 0, 0));
    expect(framedAt(world, 2, 1)).toBe(walls.wallCell(1, WALL_SIDE.north | WALL_SIDE.south | WALL_SIDE.west, 2, 1));
    expect(framedAt(world, 1, 1)).toBe(walls.wallCell(1, 15, 1, 1));
  });

  test("tiles without a wall, and walls that are not vanilla content, have no cell", () => {
    const world = wallWorld(3, 3);
    world.setTile(1, 1, { wall: { kind: "mod", mod: "Example", internalName: "Wall" }, wires: 0, actuator: false });
    put(world, 2, 1, 1);
    expect(framedAt(world, 0, 0)).toBe(NO_CELL);
    expect(framedAt(world, 1, 1)).toBe(NO_CELL);
    // The modded wall still counts as a neighbour of the vanilla wall beside it.
    expect(framedAt(world, 2, 1)).toBe(walls.wallCell(1, WALL_SIDE.west, 2, 1));
    expect(walls.wallCell(0, 15, 0, 0)).toBe(NO_CELL);
    expect(walls.wallCell(9999, 15, 0, 0)).toBe(NO_CELL);
  });

  test("a region frames like the whole world: it reads the tiles around it", () => {
    const world = wallWorld(12, 10);
    for (let x = 0; x < 12; x++) for (let y = 0; y < 10; y++) if ((x * 7 + y * 5) % 4 !== 0) put(world, x, y, 1 + ((x + y) % 3));
    const whole = new Uint16Array(12 * 10);
    walls.frameRegion(world, { left: 0, top: 0, width: 12, height: 10 }, whole);
    const part = new Uint16Array(5 * 4);
    walls.frameRegion(world, { left: 3, top: 2, width: 5, height: 4 }, part);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) expect(part[i * 4 + j]).toBe(whole[(3 + i) * 10 + 2 + j]);
  });
});

describe("wall source rectangles", () => {
  test("a wall cell is 32 × 32 at 36 pixels per cell (docs/assets.md, worked examples 5 and 6); NO_CELL has none", () => {
    expect(wallSourceRect(9 * 64 + 3)).toEqual({ x: 324, y: 108, width: 32, height: 32 });
    expect(wallSourceRect(1 * 64 + 1)).toEqual({ x: 36, y: 36, width: 32, height: 32 });
    expect(wallSourceRect(NO_CELL)).toBeNull();
  });

  test("worked example 5: a lone stone wall takes cell (9, 3); example 6: four neighbours at x mod 3 = 0, y mod 3 = 1 take (1, 1)", () => {
    expect(walls.wallCell(1, 0, 0, 0, 0)).toBe(9 * 64 + 3);
    expect(walls.wallCell(1, 15, 3, 4, 0)).toBe(1 * 64 + 1);
  });
});
