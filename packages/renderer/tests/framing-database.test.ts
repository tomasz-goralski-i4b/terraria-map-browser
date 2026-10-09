import { beforeAll, describe, expect, test } from "vitest";
import { loadFramingDatabase, neighbourhoodCode, type FramingDatabase } from "../src/framing/framing-database.js";
import { terrariaFramingData } from "../src/framing/terraria-framing.generated.js";

let database: FramingDatabase;
beforeAll(async () => {
  database = await loadFramingDatabase(terrariaFramingData);
});

/** The code of a 3 × 3 pattern (rows N to S, centre `#`): `.` air, `own` the centre's type, anything else the other. */
function code(rows: readonly string[], own: string): number {
  const at = (row: number, column: number): string => rows[row]?.charAt(column) ?? "";
  const letters = [at(0, 0), at(0, 1), at(0, 2), at(1, 0), at(1, 2), at(2, 0), at(2, 1), at(2, 2)];
  return neighbourhoodCode(letters.map((letter) => (letter === "." ? 0 : letter === own ? 1 : 2)));
}

const DIRT = 0;
const STONE = 1;
const IRON = 6;
const COPPER = 7;
const GRASS = 2;

describe("the generated framing database", () => {
  test("covers every self-framed block type and every wall, from one game version", () => {
    expect(database.gameVersion).toMatch(/^v?1\.4\.5/);
    expect(database.blockTypes).toHaveLength(333);
    expect(database.blockTypes).toContain(DIRT);
    expect(Object.keys(terrariaFramingData.walls).length).toBeGreaterThan(300);
    expect(terrariaFramingData.wallNeighbourBlocks).toEqual([54, 328, 459, 748]);
  });

  test.each([
    ["1 isolated dirt", DIRT, null, ["...", ".#.", "..."], "d", [9, 3]],
    ["5 dirt interior", DIRT, null, ["ddd", "d#d", "ddd"], "d", [1, 1]],
    ["7 four empty corners: NW+NE notches", DIRT, null, [".d.", "d#d", ".d."], "d", [6, 1]],
    ["8b stone, dirt to the W: rim W", STONE, DIRT, ["dss", "d#s", "dss"], "s", [9, 7]],
    ["9 stone, dirt to the E: rim E", STONE, DIRT, ["sss", "s#d", "sss"], "s", [8, 7]],
    ["10 stone in dirt", STONE, DIRT, ["ddd", "d#d", "ddd"], "s", [6, 11]],
    ["14a stone, dirt N and E: outline fallback", STONE, DIRT, [".dd", ".#d", "..."], "s", [9, 3]],
    ["15 copper in dirt: full rim", COPPER, DIRT, ["ddd", "d#d", "ddd"], "c", [6, 11]],
    ["16a copper beside iron: seam", COPPER, IRON, ["...", "c#i", "..."], "c", [12, 0]],
    ["17 copper in stone: outlined", COPPER, STONE, ["sss", "s#s", "sss"], "c", [9, 3]],
    ["G2 grass, dirt to the W", GRASS, DIRT, ["...", "d#g", "ddd"], "g", [0, 11]],
    ["G9 grass, dirt N and S, air W", GRASS, DIRT, [".d.", ".#g", ".d."], "g", [0, 15]],
  ] as const)("worked example %s", (_name, centre, other, rows, own, cell) => {
    expect(database.blockCell(centre, other, code(rows, own))).toEqual(cell);
  });

  test("relations: dirt-partner blocks draw rims, ores treat other ores and stone like air", () => {
    expect(database.relation(STONE, DIRT)).toBe("table");
    expect(database.relation(COPPER, DIRT)).toBe("table");
    expect(database.relation(COPPER, IRON)).toBe("air");
    expect(database.relation(COPPER, STONE)).toBe("air");
    expect(database.relation(DIRT, DIRT)).toBe("self");
    expect(database.relation(DIRT, 4)).toBeNull();
  });

  test("falling blocks: sand in a block frames, sand with nothing below it falls (no cell)", () => {
    const SAND = 53;
    expect(database.blockTypes).toContain(SAND);
    expect(database.blockCell(SAND, null, code(["sss", "s#s", "sss"], "s"))).toEqual([1, 1]);
    expect(database.blockCell(SAND, null, code(["...", ".#.", "..."], "s"))).toBeNull();
    expect(database.blockCell(SAND, null, code(["...", ".#.", ".s."], "s"))).toEqual([6, 0]);
  });

  test("variants: the plain interior's three cells", () => {
    expect(database.blockVariant(DIRT, [1, 1], 1)).toEqual([2, 1]);
    expect(database.blockVariant(DIRT, [1, 1], 2)).toEqual([3, 1]);
  });

  test("large-frame types carry their tables by position and ignore the variant", () => {
    for (const id of [273, 409]) {
      const block = terrariaFramingData.blocks[String(id)];
      expect(block?.byPosition).toHaveLength(24);
      expect(block?.variantIgnoredByPosition).toBe(true);
    }
  });

  test("walls: a lone wall and a wall in a wall field take different cells", () => {
    const lone = database.wallCell(1, 0);
    const inside = database.wallCell(1, neighbourhoodCode([1, 1, 1, 1, 1, 1, 1, 1]));
    expect(lone).not.toBeNull();
    expect(inside).not.toEqual(lone);
  });
});
