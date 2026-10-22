// Underground backgrounds (docs/assets.md, "Cave backgrounds"): the sheets of each style, the style the game shows
// around a block of tiles, and the bands the sheets are drawn in, over synthetic worlds worked out by hand.
import { describe, expect, test } from "vitest";
import {
  CAVE_BACKGROUND_IDS, CAVE_BLOCK_HEIGHT, CAVE_BLOCK_WIDTH, caveBackgroundBands, caveBackgroundSheets, caveBackgroundStyles,
} from "../src/index.js";
import type { CaveBackgroundSettings, CaveWorld } from "../src/index.js";

const ABSENT = 0xffff;
const SETTINGS: CaveBackgroundSettings = {
  caveBackX: [400, 600, 800], caveBackStyles: [0, 1, 2, 3], iceBackStyle: 0, jungleBackStyle: 0, hellBackStyle: 0, worldId: 0,
};

describe("caveBackgroundSheets", () => {
  test.each([
    ["a stone style", 3, {}, [66, 67, 68, 69, 128, 125, 185]],
    ["the underworld style picking the magma sheets", 3, { hellBackStyle: 2 }, [66, 67, 68, 69, 130, 127, 187]],
    ["snow with its own style", 1, { iceBackStyle: 2 }, [164, 165, 166, 167, 128, 125, 185]],
    ["the second jungle style", 11, { jungleBackStyle: 1, hellBackStyle: 1 }, [146, 154, 155, 156, 158, 126, 186]],
    ["the mushroom style", 2, {}, [62, 63, 64, 65, 143, 125, 185]],
    ["corruption, its rock sheet by world id", 12, { worldId: 7 }, [66, 67, 68, 196, 128, 125, 185]],
    ["crimson under snow, its rock sheet by world id", 16, { worldId: 3 }, [40, 33, 34, 202, 128, 125, 185]],
    ["a beach (dirt sheets only)", 18, {}, [290, 291, 0, 0, 0, 125, 185]],
    ["no style", 0, {}, [0, 0, 0, 0, 0, 0, 0]],
  ] as const)("%s", (_label, style, settings, expected) => {
    expect(caveBackgroundSheets(style, { ...SETTINGS, ...settings })).toEqual(expected);
  });

  test("CAVE_BACKGROUND_IDS_HoldsEverySheetOfEveryStyle", () => {
    for (let style = 1; style <= 21; style++) {
      for (const settings of [SETTINGS, { ...SETTINGS, iceBackStyle: 3, jungleBackStyle: 1, hellBackStyle: 2, worldId: 11 }]) {
        for (const id of caveBackgroundSheets(style, settings)) if (id !== 0) expect(CAVE_BACKGROUND_IDS.has(id), String(id)).toBe(true);
      }
    }
    expect(CAVE_BACKGROUND_IDS.has(0)).toBe(false);
  });
});

describe("caveBackgroundBands", () => {
  test("caveBackgroundBands_Levels_SplitTheUndergroundIntoTheGamesBands", () => {
    // Surface 300, rock 400, 1200 rows: the dirt band ends on a whole 96-pixel repeat past the rock level (plus 32),
    // the rock band 592 pixels below the magma level (row 865), the magma band on a whole repeat past row 1000.
    expect(caveBackgroundBands(300, 400, 1200)).toEqual({
      bands: [4800, 4816, 6448, 6464, 14432, 14448, 16080, 16096], magmaTop: 14448,
    });
  });
});

/** A 1200 × 1200 world, surface 300, rock 400, empty but for the rectangles of `fills` ([tile id, left, top, right, bottom]). */
function world(fills: readonly (readonly [number, number, number, number, number])[], caves: CaveBackgroundSettings | null = SETTINGS): CaveWorld {
  const width = 1200;
  const height = 1200;
  const block = new Uint16Array(width * height).fill(ABSENT);
  const palette = fills.map(([id]) => ({ kind: "vanilla" as const, id }));
  fills.forEach(([, left, top, right, bottom], index) => {
    for (let x = left; x < right; x++) for (let y = top; y < bottom; y++) block[x * height + y] = index;
  });
  return { width, height, surfaceY: 300, rockY: 400, planes: { block }, palette, ...(caves === null ? {} : { caves }) };
}

/** The style of the block holding tile (x, y). */
function styleAt(target: CaveWorld, x: number, y: number): number | undefined {
  const styles = caveBackgroundStyles(target);
  if (styles === null) return undefined;
  return styles.styles[Math.floor(y / CAVE_BLOCK_HEIGHT) * styles.width + Math.floor(x / CAVE_BLOCK_WIDTH)];
}

describe("caveBackgroundStyles", () => {
  test("caveBackgroundStyles_Blocks_CoverTheWorld", () => {
    const styles = caveBackgroundStyles(world([]));
    expect(styles?.width).toBe(150);
    expect(styles?.height).toBe(200);
    expect(styles?.styles.length).toBe(150 * 200);
  });

  test.each([
    ["left of the first zone edge", 100, 3],
    ["in the second zone", 500, 4],
    ["in the third zone", 700, 5],
    ["past the last edge", 900, 6],
  ] as const)("caveBackgroundStyles_Air_%s_TakesItsZonesStylePlus3", (_label, x, expected) => {
    expect(styleAt(world([]), x, 700)).toBe(expected);
  });

  test.each([
    ["snow", [[147, 450, 600, 650, 800]], 1],
    ["more jungle than snow", [[147, 450, 600, 500, 800], [60, 500, 600, 650, 800]], 11],
    ["corruption in the caverns", [[23, 450, 600, 650, 800]], 12],
    ["crimson in the caverns", [[199, 450, 600, 650, 800]], 13],
    ["hallow in the caverns", [[109, 450, 600, 650, 800]], 14],
    ["corrupt ice in the caverns", [[163, 450, 600, 650, 800]], 15],
    ["as much hallow as corruption (they cancel)", [[23, 450, 600, 500, 800], [109, 500, 600, 550, 800]], 4],
    ["glowing mushrooms over snow", [[147, 450, 600, 650, 800], [70, 495, 695, 505, 705]], 2],
    ["a few snow blocks (under the threshold)", [[147, 495, 695, 505, 705]], 4],
  ] as const)("caveBackgroundStyles_%s_PicksTheBiomesStyle", (_label, fills, expected) => {
    expect(styleAt(world(fills), 500, 700)).toBe(expected);
  });

  test("caveBackgroundStyles_CorruptionAboveTheCaverns_KeepsTheZoneStyle", () => {
    expect(styleAt(world([[23, 450, 380, 650, 520]]), 500, 450)).toBe(4);
  });

  test("caveBackgroundStyles_SnowNearTheUnderworld_KeepsTheZoneStyle", () => {
    expect(styleAt(world([[147, 450, 800, 650, 1000]]), 500, 900)).toBe(4);
  });

  test.each([
    ["a beach", [], 18],
    ["a corrupt beach", [[23, 0, 300, 200, 400]], 19],
    ["a hallowed beach", [[109, 0, 300, 200, 400]], 20],
    ["a crimson beach", [[199, 0, 300, 200, 400]], 21],
  ] as const)("caveBackgroundStyles_%s_ByTheOcean", (_label, fills, expected) => {
    expect(styleAt(world(fills), 100, 350)).toBe(expected);
    expect(styleAt(world(fills), 1100, 350)).toBe(fills.length === 0 ? expected : 18);
  });

  test("caveBackgroundStyles_WithoutHeaderStylesOrRockLevel_IsNull", () => {
    expect(caveBackgroundStyles(world([], null))).toBeNull();
    const { rockY: _rock, ...noRock } = world([]);
    expect(caveBackgroundStyles(noRock)).toBeNull();
  });
});
