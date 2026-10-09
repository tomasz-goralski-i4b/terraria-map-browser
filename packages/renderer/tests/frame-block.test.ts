import { inflateRawSync } from "node:zlib";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { createWorld, viewWorld, type CanonicalWorld, type ContentRef, type WorldPlanes } from "@studio/world-model";
import { loadFramingDatabase, type FramingDatabase } from "../src/framing/framing-database.js";
import { terrariaFramingData as data } from "../src/framing/terraria-framing.generated.js";
import { NO_CELL, createBlockFraming, type BlockFraming, type SheetCell } from "../src/framing/frame-block.js";
import { allocationCount } from "./allocation-count.js";

let database: FramingDatabase;
let framing: BlockFraming;
beforeAll(async () => {
  database = await loadFramingDatabase(data);
  framing = createBlockFraming(database);
});

const DIRT = 0;
const STONE = 1;
const IRON = 6;
const COPPER = 7;

// The database's reference position (the observer frames the centre at (10, 10), variant 0) and two positions of the
// same position class (x mod 6, y mod 4) whose variant (7x + 11y) mod 3 is 1 and 2.
const REFERENCE = [10, 10] as const;
const VARIANT_1 = [10, 18] as const;
const VARIANT_2 = [10, 14] as const;

/** Neighbour offsets in NEIGHBOUR_ORDER (NW N NE W E SW S SE). */
const AROUND = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;

function digitsOf(code: number): number[] {
  const digits: number[] = [];
  for (let k = 0, rest = code; k < 8; k++, rest = Math.floor(rest / 3)) digits.push(rest % 3);
  return digits;
}

const inflate = (base64: string): string => inflateRawSync(Buffer.from(base64, "base64")).toString("utf8");
const tables = data.tables.map(inflate);
const relationRows = inflate(data.relations).split("\n");
const typeIndex = new Map(data.blockTypes.map((type, index) => [type, index]));

/** The database's raw relation char of `centre` toward `other` (`-` itself, `x` air, `o` itself, `A`… a table). */
function relationChar(centre: number, other: number): string {
  return relationRows[typeIndex.get(centre) ?? -1]?.charAt(typeIndex.get(other) ?? -1) ?? "";
}

const isTableChar = (char: string): boolean => char !== "" && !"-ox".includes(char);

function block(type: number): NonNullable<(typeof data.blocks)[string]> {
  const entry = data.blocks[String(type)];
  if (entry === undefined) throw new Error(`no block ${String(type)}`);
  return entry;
}

/** The database's cell of `table` at `code`, or null when the neighbourhood is unstable. */
function tableCell(table: number, code: number): readonly [number, number] | null {
  const cell = data.cells[(tables[table]?.charCodeAt(code) ?? 0) - 48];
  if (cell === undefined || (cell[0] === 63 && cell[1] === 63)) return null;
  return [cell[0] ?? 0, cell[1] ?? 0];
}

/** A falling block (sand and the like): alone, with nothing around it, it has no cell. */
const isFalling = (type: number): boolean => database.blockCell(type, null, 0) === null;

/** A packed region cell (column · 64 + row) as a tuple; null for NO_CELL. */
const unpack = (cell: number): readonly [number, number] | null => (cell === NO_CELL ? null : [cell >> 6, cell & 63]);

const asTuple = (cell: SheetCell | null): readonly [number, number] | null => (cell === null ? null : [cell.column, cell.row]);

/** frameBlock for a centre whose neighbours are `digits` (0 air, 1 the centre's type, 2 `other`), all full. */
function frameDigits(centre: number, other: number, digits: readonly number[], x: number, y: number): SheetCell | null {
  return framing.frameBlock({
    type: centre, shape: 0, x, y,
    neighbours: digits.map((digit) => (digit === 0 ? -1 : digit === 1 ? centre : other)),
  });
}

/** Where the observer world puts the centre: the reference position's class (x mod 6, y mod 4) and variant 0. */
const OBSERVER_CENTRE = [4, 10] as const;

/** A 9 × 15 world whose palette index is the vanilla block id; tests write its block plane directly. */
function observerWorld(): { world: CanonicalWorld; clear: () => void; put: (x: number, y: number, type: number) => void } {
  const width = 9;
  const height = 15;
  const palette: ContentRef[] = Array.from({ length: 1024 }, (_, id) => ({ kind: "vanilla", id }));
  const planes: WorldPlanes = createWorld(width, height).planes;
  const world = viewWorld(width, height, planes, palette);
  return {
    world,
    clear: () => planes.block.fill(0xffff),
    put: (x, y, type) => { planes.block[x * height + y] = type; },
  };
}

describe("frameBlock against the framing database", () => {
  test("every type alone: all 256 neighbourhoods of air and itself, at the reference position", () => {
    let checked = 0;
    for (const type of data.blockTypes) {
      for (let code = 0; code < 6561; code++) {
        const digits = digitsOf(code);
        if (digits.includes(2)) continue;
        const expected = database.blockCell(type, null, code);
        const actual = asTuple(frameDigits(type, -1, digits, ...REFERENCE));
        if (expected === null) {
          // Unstable: only a falling centre with nothing below it has no cell of its own.
          if (isFalling(type) && digits[6] === 0) expect(actual, `${String(type)} ${String(code)}`).toBeNull();
          continue;
        }
        expect(actual, `type ${String(type)} code ${String(code)}`).toEqual(expected);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(333 * 200);
  });

  test("every type with every other type: all neighbourhoods that hold the other type", () => {
    // Pairs that frame alike share a key built from the database alone: how the centre treats the other type and,
    // when both see each other by a table (partner and relative), how the other type frames itself. One pair per key
    // is checked over all 6 561 neighbourhoods. Neighbourhoods without the other type are the type's own (above):
    // for grass, gemspark and the large-frame blocks the database's pair tables record other cells there than its
    // table of the type alone (the game's result there is not a function of the 3 × 3).
    const { world, clear, put } = observerWorld();
    const cells = new Uint16Array(1);
    const keys = new Set<string>();
    let pairs = 0;
    let checked = 0;
    for (const centre of data.blockTypes) {
      for (const other of data.blockTypes) {
        if (other === centre) continue;
        pairs++;
        const there = relationChar(centre, other);
        const back = relationChar(other, centre);
        const both = isTableChar(there) && isTableChar(back);
        const key = !isTableChar(there)
          ? `${String(centre)} ${there === "x" ? "x" : "o"}`
          : [centre, there, back, block(other).alone, isFalling(other), relationChar(other, STONE),
            block(other).byPosition !== undefined].join(" ");
        if (keys.has(key)) continue;
        keys.add(key);
        const floor = isFalling(centre) || isFalling(other);
        for (let code = 0; code < 6561; code++) {
          const digits = digitsOf(code);
          if (!digits.includes(2)) continue;
          const expected = database.blockCell(centre, other, code);
          if (expected === null) continue;
          let actual: readonly [number, number] | null;
          if (!both) {
            actual = asTuple(frameDigits(centre, other, digits, ...REFERENCE));
          } else {
            // The edge check needs the other type's own cells: frame the observer's world, a 3 × 3 in air with a
            // stone floor below the bottom row when a falling type takes part.
            const [cx, cy] = OBSERVER_CENTRE;
            clear();
            put(cx, cy, centre);
            digits.forEach((digit, k) => {
              const [dx, dy] = AROUND[k] ?? [0, 0];
              if (digit !== 0) put(cx + dx, cy + dy, digit === 1 ? centre : other);
            });
            if (floor) for (let dx = -1; dx <= 1; dx++) if (digits[6 + dx] !== 0) put(cx + dx, cy + 2, STONE);
            framing.frameRegion(world, { left: cx, top: cy, width: 1, height: 1 }, cells);
            actual = unpack(cells[0] ?? NO_CELL);
          }
          if (actual?.[0] !== expected[0] || actual[1] !== expected[1]) {
            expect(actual, `centre ${String(centre)} other ${String(other)} code ${String(code)}`).toEqual(expected);
          }
          checked++;
        }
      }
    }
    expect(pairs).toBe(333 * 332);
    expect(checked).toBeGreaterThan(1_000_000);
  }, 300_000);
});

describe("variants", () => {
  test("v1 and v2 of every variant-0 cell a type takes, alone and beside every other type, are the database's", () => {
    let checked = 0;
    let uncovered = 0;
    for (const type of data.blockTypes) {
      if (block(type).variantIgnoredByPosition === true) continue;
      // One other type per table the centre reads (alone: null); relatives with their rims kept and with none.
      const others = new Map<string, number | null>([["alone", null]]);
      for (const other of data.blockTypes) {
        const char = relationChar(type, other);
        if (other !== type && isTableChar(char) && !others.has(char)) others.set(char, other);
      }
      const seen = new Set<string>();
      for (const other of others.values()) {
        for (const rims of other === null ? [0] : [0, 15]) {
          for (let code = 0; code < 6561; code++) {
            const digits = digitsOf(code);
            if (digits.includes(2) !== (other !== null)) continue;
            const neighbours = digits.map((digit) => (digit === 0 ? -1 : digit === 1 ? type : other ?? -1));
            const at = (x: number, y: number): SheetCell | null =>
              framing.frameBlock({ type, shape: 0, x, y, neighbours, rimsTowardCentre: rims });
            const v0 = at(...REFERENCE);
            if (v0 === null || seen.has(`${String(v0.column)},${String(v0.row)}`)) continue;
            seen.add(`${String(v0.column)},${String(v0.row)}`);
            for (const [variant, position] of [[1, VARIANT_1], [2, VARIANT_2]] as const) {
              const expected = database.blockVariant(type, [v0.column, v0.row], variant) ?? [v0.column, v0.row];
              expect(asTuple(at(position[0], position[1])), `${String(type)} v${String(variant)}`).toEqual(expected);
              checked++;
            }
          }
        }
      }
      // Every variant-0 cell of the type's variant map is one frameBlock gives (the map also lists UNSTABLE_CELL).
      const map = inflate(data.variantMaps[block(type).variants] ?? "");
      for (let at = 0; at + 2 < map.length; at += 3) {
        const cell = data.cells[map.charCodeAt(at) - 48];
        if (cell === undefined || (cell[0] === 63 && cell[1] === 63)) continue;
        if (!seen.has(`${String(cell[0])},${String(cell[1])}`)) uncovered++;
      }
    }
    expect(checked).toBeGreaterThan(333 * 40);
    expect(uncovered).toBe(0);
  }, 120_000);

  test("the variant is (7x + 11y) mod 3 and never random", () => {
    const random = vi.spyOn(Math, "random");
    const interior = [1, 1, 1, 1, 1, 1, 1, 1];
    expect(asTuple(frameDigits(DIRT, -1, interior, 0, 0))).toEqual([1, 1]);
    expect(asTuple(frameDigits(DIRT, -1, interior, 1, 0))).toEqual([2, 1]);
    expect(asTuple(frameDigits(DIRT, -1, interior, 2, 0))).toEqual([3, 1]);
    expect(asTuple(frameDigits(DIRT, -1, interior, 0, 1))).toEqual([3, 1]);
    expect(asTuple(frameDigits(DIRT, -1, interior, 3, 0))).toEqual(asTuple(frameDigits(DIRT, -1, interior, 3, 0)));
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
});

describe("types framed by position", () => {
  test("large-frame and grass-like types take the database's cells at all 24 positions", () => {
    const positional = data.blockTypes.filter((type) => block(type).byPosition !== undefined);
    expect(positional.length).toBeGreaterThanOrEqual(24);
    for (const type of positional) {
      const byPosition = block(type).byPosition ?? [];
      for (let b = 0; b < 4; b++) {
        for (let a = 0; a < 6; a++) {
          const x = 12 + a;
          let y = 12 + b;
          // Same position class, variant 0: the database's tables by position were framed with variant 0.
          while ((7 * x + 11 * y) % 3 !== 0) y += 4;
          const table = byPosition[b * 6 + a] ?? -1;
          for (let code = 0; code < 6561; code++) {
            const digits = digitsOf(code);
            if (digits.includes(2)) continue;
            const expected = tableCell(table, code);
            if (expected === null) continue;
            expect(asTuple(frameDigits(type, -1, digits, x, y)), `${String(type)} at ${String(a)},${String(b)}`)
              .toEqual(expected);
          }
        }
      }
    }
  });
});

describe("slopes and half blocks", () => {
  // Faces cut by each shape (0 full, 1 half, 2–5 slopes), as sides N E S W.
  const CUT: readonly (readonly number[])[] = [[], [0], [0, 1], [0, 3], [2, 1], [2, 3]];
  const SIDE_SLOTS = [1, 4, 6, 3] as const;

  test("the face rule: a side connects only where both faces are whole (dirt centre, every shape)", () => {
    let checked = 0;
    for (let centreShape = 0; centreShape < 6; centreShape++) {
      for (let combination = 0; combination < 7 ** 4; combination++) {
        // Each side: 0 air, 1–6 dirt in shape 0–5; corners full dirt.
        const neighbours = [DIRT, DIRT, DIRT, DIRT, DIRT, DIRT, DIRT, DIRT];
        const shapes = [0, 0, 0, 0, 0, 0, 0, 0];
        const digits = [1, 1, 1, 1, 1, 1, 1, 1];
        for (let side = 0; side < 4; side++) {
          const option = Math.floor(combination / 7 ** side) % 7;
          const slot = SIDE_SLOTS[side] ?? 0;
          const facing = (side + 2) % 4;
          neighbours[slot] = option === 0 ? -1 : DIRT;
          shapes[slot] = option === 0 ? 0 : option - 1;
          const whole = option !== 0 && CUT[centreShape]?.includes(side) === false
            && CUT[option - 1]?.includes(facing) === false;
          digits[slot] = whole ? 1 : 0;
        }
        const expected = database.blockCell(DIRT, null, digits.reduce((code, digit, k) => code + digit * 3 ** k, 0));
        const actual = framing.frameBlock({
          type: DIRT, shape: centreShape, x: REFERENCE[0], y: REFERENCE[1], neighbours, neighbourShapes: shapes,
        });
        expect(asTuple(actual), `shape ${String(centreShape)} sides ${String(combination)}`).toEqual(expected);
        checked++;
      }
    }
    expect(checked).toBe(14_406);
  });

  test("the corner rule: a corner counts by presence, whatever its shape (stone with dirt corners)", () => {
    const CORNER_SLOTS = [0, 2, 7, 5] as const;
    for (let combination = 0; combination < 13 ** 4; combination++) {
      // Each corner: 0 air, 1–6 stone in shape 0–5, 7–12 dirt in shape 0–5; sides full stone.
      const neighbours = [STONE, STONE, STONE, STONE, STONE, STONE, STONE, STONE];
      const shapes = [0, 0, 0, 0, 0, 0, 0, 0];
      const digits = [1, 1, 1, 1, 1, 1, 1, 1];
      for (let corner = 0; corner < 4; corner++) {
        const option = Math.floor(combination / 13 ** corner) % 13;
        const slot = CORNER_SLOTS[corner] ?? 0;
        neighbours[slot] = option === 0 ? -1 : option <= 6 ? STONE : DIRT;
        shapes[slot] = option === 0 ? 0 : (option - 1) % 6;
        digits[slot] = option === 0 ? 0 : option <= 6 ? 1 : 2;
      }
      const expected = database.blockCell(STONE, DIRT, digits.reduce((code, digit, k) => code + digit * 3 ** k, 0));
      const actual = framing.frameBlock({
        type: STONE, shape: 0, x: REFERENCE[0], y: REFERENCE[1], neighbours, neighbourShapes: shapes,
      });
      if (actual?.column !== expected?.[0] || actual?.row !== expected?.[1]) {
        expect(asTuple(actual), `corners ${String(combination)}`).toEqual(expected);
      }
    }
  });
});

describe("the two-pass helper over a tile region", () => {
  const LEGEND: Readonly<Record<string, number>> = { d: DIRT, s: STONE, c: COPPER, i: IRON, S: 53 };

  /** A world with `rows` (N to S) at (2, 2) in air; `#` is `centre`. */
  function worldOf(rows: readonly string[], centre = -1, centreShape = 0): CanonicalWorld {
    const world = createWorld(12, 12);
    rows.forEach((line, y) => {
      Array.from(line, (char) => char).forEach((char, x) => {
        const type = char === "#" ? centre : LEGEND[char];
        if (type === undefined || type < 0) return;
        world.setTile(2 + x, 2 + y, {
          block: { kind: "vanilla", id: type }, wires: 0, actuator: false,
          ...(char === "#" && centreShape === 1 ? { shape: "half" as const } : {}),
          ...(char === "#" && centreShape === 2 ? { shape: "slopeTopRight" as const } : {}),
        });
      });
    });
    return world;
  }

  /** The cell the helper gives the tile at (2 + x, 2 + y), framing only that one tile's region. */
  function cellAt(world: CanonicalWorld, x: number, y: number): readonly [number, number] | null {
    const cells = new Uint16Array(1);
    framing.frameRegion(world, { left: 2 + x, top: 2 + y, width: 1, height: 1 }, cells);
    return unpack(cells[0] ?? NO_CELL);
  }

  /** Of a look's cells v0 / v1 / v2, the one of the tile at (2 + x, 2 + y): variant (7x + 11y) mod 3. */
  function ofVariant(x: number, y: number, cells: readonly (readonly [number, number])[]): readonly [number, number] | undefined {
    return cells[(7 * (2 + x) + 11 * (2 + y)) % 3];
  }

  // docs/assets.md, "Worked examples": the centre sits at (4, 4), a position of variant 0 (7 · 4 + 11 · 4 = 72).
  test.each([
    ["1", DIRT, ["...", ".#.", "..."], [9, 3]],
    ["2", DIRT, ["...", ".#d", "..."], [9, 0]],
    ["3", DIRT, ["...", "d#d", "ddd"], [1, 0]],
    ["4", DIRT, ["...", ".#d", ".dd"], [0, 3]],
    ["5", DIRT, ["ddd", "d#d", "ddd"], [1, 1]],
    ["6", DIRT, [".d.", "d#d", "ddd"], [6, 1]],
    ["7", DIRT, [".d.", "d#d", ".d."], [6, 1]],
    ["9", STONE, ["sss", "s#d", "sss"], [8, 7]],
    ["10", STONE, ["ddd", "d#d", "ddd"], [6, 11]],
    ["11", STONE, [".d.", "s#s", "..."], [13, 1]],
    ["12", STONE, ["sss", "s#s", "ssd"], [0, 5]],
    ["13", STONE, ["ss.", "d#s", "dd."], [2, 6]],
    ["15", COPPER, ["ddd", "d#d", "ddd"], [6, 11]],
    ["17", COPPER, ["sss", "s#s", "sss"], [9, 3]],
  ] as const)("worked example %s", (_name, centre, rows, cell) => {
    const world = worldOf(["....."].concat(rows.map((row) => `.${row}.`), ["....."]), centre);
    expect(cellAt(world, 2, 2)).toEqual(cell);
  });

  test("worked examples 18 and 19: a shaped dirt centre", () => {
    expect(cellAt(worldOf([".....", ".....", ".d#..", ".dd..", "....."], DIRT, 2), 2, 2)).toEqual([1, 3]);
    expect(cellAt(worldOf([".....", ".....", ".d#d.", ".....", "....."], DIRT, 1), 2, 2)).toEqual([6, 4]);
  });

  test("worked examples 8a and 8b: both sides of a dirt/stone boundary whose stone keeps its rim", () => {
    const world = worldOf(["......", ".ddss.", ".ddss.", ".ddss.", "......"]);
    expect(cellAt(world, 2, 2)).toEqual(ofVariant(2, 2, [[1, 1], [2, 1], [3, 1]]));
    expect(cellAt(world, 3, 2)).toEqual(ofVariant(3, 2, [[9, 7], [9, 8], [9, 9]]));
  });

  test("worked examples 14a and 14b: stone without a rim cell, and the dirt beside it closes its edge", () => {
    const world = worldOf(["......", "..dd..", "..sdd.", "......"]);
    expect(cellAt(world, 2, 2)).toEqual(ofVariant(2, 2, [[9, 3], [10, 3], [11, 3]]));
    expect(cellAt(world, 3, 2)).toEqual(ofVariant(3, 2, [[0, 4], [2, 4], [4, 4]]));
  });

  test("worked examples 16a and 16b: copper beside iron is a seam on both sides", () => {
    const world = worldOf(["......", ".ccii.", "......"]);
    expect(cellAt(world, 2, 1)).toEqual(ofVariant(2, 1, [[12, 0], [12, 1], [12, 2]]));
    expect(cellAt(world, 3, 1)).toEqual(ofVariant(3, 1, [[9, 0], [9, 1], [9, 2]]));
  });

  test("a region's cells equal framing each tile on its own, and absent tiles stay −1", () => {
    const world = worldOf(["......", "..dd..", "..sdd.", ".ddss.", "......"]);
    const cells = new Uint16Array(6 * 5);
    framing.frameRegion(world, { left: 2, top: 2, width: 6, height: 5 }, cells);
    for (let x = 0; x < 6; x++) {
      for (let y = 0; y < 5; y++) {
        const alone = cellAt(world, x, y);
        expect(unpack(cells[x * 5 + y] ?? NO_CELL)).toEqual(alone);
      }
    }
  });

  test("three types: a centre that reads a table takes the table-read neighbour as the other type", () => {
    const MUD = 59;
    const CHLOROPHYTE = 211;
    expect(framing.kind(MUD, DIRT)).toBe("table");
    expect(framing.kind(MUD, CHLOROPHYTE)).toBe("relative");
    // Mud all around, dirt at E, chlorophyte at NW (before dirt in NEIGHBOUR_ORDER) or at SE (after it). The
    // relative connects (digit 1); the dirt is the pair's other type (digit 2).
    for (const relativeSlot of [0, 7]) {
      const neighbours = [MUD, MUD, MUD, MUD, DIRT, MUD, MUD, MUD];
      neighbours[relativeSlot] = CHLOROPHYTE;
      const code = [1, 1, 1, 1, 2, 1, 1, 1].reduce((sum, digit, k) => sum + digit * 3 ** k, 0);
      const actual = framing.frameBlock({ type: MUD, shape: 0, x: REFERENCE[0], y: REFERENCE[1], neighbours });
      expect(asTuple(actual), `chlorophyte at slot ${String(relativeSlot)}`).toEqual(database.blockCell(MUD, DIRT, code));
    }
  });

  test("a relative with no cell of its own (unsupported sand) keeps no rim toward the centre", () => {
    const SAND = 53;
    expect(framing.kind(DIRT, SAND)).toBe("relative");
    const world = worldOf([".....", ".dS..", "....."]);
    expect(cellAt(world, 2, 1)).toBeNull();
    const alone = framing.frameBlock({ type: DIRT, shape: 0, x: 3, y: 3, neighbours: [-1, -1, -1, -1, -1, -1, -1, -1] });
    expect(cellAt(world, 1, 1)).toEqual(asTuple(alone));
  });

  test("a falling block stands on any block below it, a modded one included", () => {
    const SAND = 53;
    const world = createWorld(12, 12);
    world.setTile(4, 4, { block: { kind: "vanilla", id: SAND }, wires: 0, actuator: false });
    world.setTile(4, 5, { block: { kind: "mod", mod: "ExampleMod", internalName: "ExampleBlock" }, wires: 0, actuator: false });
    expect(cellAt(world, 2, 2)).not.toBeNull();
  });

  test("relatives chain at most five steps deep and never in a cycle", () => {
    let deepest = 0;
    for (const centre of data.blockTypes) {
      const depth = framing.depth(centre);
      deepest = Math.max(deepest, depth);
      for (const other of data.blockTypes) {
        // A type frames after its relatives: a relative is always shallower, so the relation has no cycle.
        if (other !== centre && framing.kind(centre, other) === "relative") expect(framing.depth(other)).toBeLessThan(depth);
      }
    }
    expect(deepest).toBe(5);
    expect(framing.depth(STONE)).toBe(0);
    expect(framing.depth(21)).toBe(-1);
  });

  test("a five-step relative chain: a change six tiles away reaches the first tile, through a one-tile window too", () => {
    // Dirt, sand, hardened sand, sandstone, desert fossil, 407: one column each, two rows, on a stone floor.
    const chain = [DIRT, 53, 397, 396, 404, 407];
    for (let k = 0; k + 1 < chain.length; k++) expect(framing.kind(chain[k] ?? -1, chain[k + 1] ?? -1)).toBe("relative");
    const strip = (extended: boolean): CanonicalWorld => {
      const world = createWorld(18, 12);
      const put = (x: number, y: number, id: number): void => {
        world.setTile(x, y, { block: { kind: "vanilla", id }, wires: 0, actuator: false });
      };
      chain.forEach((type, k) => { put(2 + k, 4, type); put(2 + k, 5, type); });
      for (let x = 1; x <= 9; x++) put(x, 6, STONE);
      if (extended) put(8, 4, 407);
      return world;
    };
    const window = new Uint16Array(1);
    const first = (world: CanonicalWorld): number => {
      framing.frameRegion(world, { left: 2, top: 4, width: 1, height: 1 }, window);
      return window[0] ?? NO_CELL;
    };
    for (const world of [strip(false), strip(true)]) {
      const whole = new Uint16Array(18 * 12);
      framing.frameRegion(world, { left: 0, top: 0, width: 18, height: 12 }, whole);
      for (let x = 2; x <= 8; x++) {
        for (const y of [4, 5]) {
          framing.frameRegion(world, { left: x, top: y, width: 1, height: 1 }, window);
          expect(window[0], `${String(x)},${String(y)}`).toBe(whole[x * 12 + y]);
        }
      }
    }
    // The tile added at (8, 4) changes the dirt at (2, 4) through the whole chain.
    expect(first(strip(true))).not.toBe(first(strip(false)));
  });

  test("reusing the scratch of a larger shaped region for a smaller unshaped one changes nothing", () => {
    const shaped = createWorld(40, 40);
    for (let x = 5; x < 35; x++) {
      for (let y = 20; y < 35; y++) {
        shaped.setTile(x, y, {
          block: { kind: "vanilla", id: (x + y) % 3 === 0 ? STONE : DIRT }, wires: 0, actuator: false,
          ...((x * 7 + y) % 5 === 0 ? { shape: "slopeTopLeft" as const } : {}),
        });
      }
    }
    const plain = worldOf(["......", "..dd..", "..sdd.", ".ddss.", "......"]);
    const region = { left: 2, top: 2, width: 6, height: 5 };
    const fresh = new Uint16Array(30);
    createBlockFraming(database).frameRegion(plain, region, fresh);
    framing.frameRegion(shaped, { left: 0, top: 0, width: 40, height: 40 }, new Uint16Array(1600));
    const reused = new Uint16Array(30);
    framing.frameRegion(plain, region, reused);
    expect(reused).toEqual(fresh);
  });

  test("a centre that reads a table still applies the edge check to its relatives", () => {
    const MUD = 59;
    const CHLOROPHYTE = 211;
    // Mud, dirt at E (the table's other type), chlorophyte at N: it connects only where its cell keeps its rim.
    const neighbours = [MUD, CHLOROPHYTE, MUD, MUD, DIRT, MUD, MUD, MUD];
    for (const [rims, north] of [[1, 1], [0, 0]] as const) {
      const code = [1, north, 1, 1, 2, 1, 1, 1].reduce((sum, digit, k) => sum + digit * 3 ** k, 0);
      const actual = framing.frameBlock({
        type: MUD, shape: 0, x: REFERENCE[0], y: REFERENCE[1], neighbours, rimsTowardCentre: rims,
      });
      expect(asTuple(actual), `rims ${String(rims)}`).toEqual(database.blockCell(MUD, DIRT, code));
    }
  });

  test("frame-important, modded and unknown blocks get no cell; neighbours outside the world are absent", () => {
    const world = createWorld(3, 3);
    world.setTile(0, 0, { block: { kind: "vanilla", id: DIRT }, wires: 0, actuator: false });
    world.setTile(1, 0, { block: { kind: "vanilla", id: 21 }, wires: 0, actuator: false });
    world.setTile(2, 0, { block: { kind: "mod", mod: "ExampleMod", internalName: "ExampleBlock" }, wires: 0, actuator: false });
    const cells = new Uint16Array(9);
    framing.frameRegion(world, { left: 0, top: 0, width: 3, height: 3 }, cells);
    expect(unpack(cells[0] ?? NO_CELL)).toEqual([9, 3]);
    expect(cells[3]).toBe(NO_CELL);
    expect(cells[6]).toBe(NO_CELL);
  });

  test("is deterministic and allocates per call, not per tile", async () => {
    const random = vi.spyOn(Math, "random");
    const size = 256;
    const world = createWorld(size, size);
    world.setTile(0, 0, { block: { kind: "vanilla", id: DIRT }, wires: 0, actuator: false });
    world.setTile(0, 1, { block: { kind: "vanilla", id: STONE }, wires: 0, actuator: false });
    world.setTile(0, 2, { block: { kind: "vanilla", id: COPPER }, wires: 0, actuator: false });
    for (let index = 0; index < size * size; index++) {
      const noise = (index * 2654435761) >>> 0;
      world.planes.block[index] = noise % 7 === 0 ? 0xffff : noise % 5 === 0 ? 2 : noise % 2;
    }
    const region = { left: 0, top: 0, width: size, height: size };
    const first = new Uint16Array(size * size);
    const second = new Uint16Array(size * size);
    framing.frameRegion(world, region, first);
    const objects = await allocationCount(() => { framing.frameRegion(world, region, second); }, "frameRegion");
    expect(second).toEqual(first);
    expect(first.filter((cell) => cell !== NO_CELL).length).toBeGreaterThan(size * size / 2);
    expect(objects).toBeLessThanOrEqual(64);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  }, 60_000);
});
