import { describe, expect, test } from "vitest";
import { createWorld } from "@studio/world-model";
import {
  backgroundColor, contentColor, liquidColors, mapOption, paintedColor, placeholderColor, renderChunk, terrariaMapPalette,
} from "../src/index.js";
import type { ChunkLayers } from "../src/index.js";
import { syntheticMapPalette } from "./map-palette.fixture.js";

const allLayers: ChunkLayers = { background: true, walls: true, blocks: true, liquids: true };

describe("contentColor", () => {
  test("uses the first map option of a vanilla ID", () => {
    expect(contentColor({ kind: "vanilla", id: 0 }, "block", syntheticMapPalette)).toEqual([0x76, 0x58, 0x3e, 255]);
    expect(contentColor({ kind: "vanilla", id: 1 }, "block", syntheticMapPalette)).toEqual([0x6c, 0x70, 0x78, 255]);
    expect(contentColor({ kind: "vanilla", id: 1 }, "wall", syntheticMapPalette)).toEqual([0x52, 0x56, 0x5c, 255]);
  });

  test.each([
    ["an ID without map options", { kind: "vanilla", id: 2 }, "block"],
    ["an ID beyond the table", { kind: "vanilla", id: 25 }, "block"],
    ["a wall without map options", { kind: "vanilla", id: 0 }, "wall"],
    ["unknown content", { kind: "unknown", runtimeId: 700 }, "block"],
  ] as const)("falls back to the placeholder for %s", (_, ref, layer) => {
    expect(contentColor(ref, layer, syntheticMapPalette)).toEqual(placeholderColor(ref, layer));
  });

  test("without a map palette every entry is a placeholder", () => {
    expect(contentColor({ kind: "vanilla", id: 0 }, "block")).toEqual(placeholderColor({ kind: "vanilla", id: 0 }, "block"));
  });
});

test("liquid colours are indexed by the CWM liquid kind; kind 0 is transparent", () => {
  expect(liquidColors(syntheticMapPalette)).toEqual([
    [0, 0, 0, 0], [0x20, 0x68, 0xd2, 255], [0xe4, 0x44, 0x18, 255], [0xde, 0xa4, 0x24, 255], [0x98, 0x54, 0xd8, 255],
  ]);
  expect(liquidColors()).toHaveLength(5);
});

test("map palette colours reach renderChunk pixels; unmapped IDs keep placeholders", () => {
  const world = createWorld(4, 1);
  world.setTile(0, 0, { block: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  world.setTile(1, 0, { wall: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  world.setTile(2, 0, { liquid: { kind: "water", amount: 255 }, wires: 0, actuator: false });
  world.setTile(3, 0, { block: { kind: "vanilla", id: 25 }, wires: 0, actuator: false });
  const pixels = renderChunk(world, 0, 0, { surfaceY: 1, layers: allLayers, mapPalette: syntheticMapPalette }).pixels;
  expect(Array.from(pixels)).toEqual([
    0x6c, 0x70, 0x78, 255, 0x52, 0x56, 0x5c, 255, 0x20, 0x68, 0xd2, 255,
    ...placeholderColor({ kind: "vanilla", id: 25 }, "block"),
  ]);
  // Colours are cached per (CWM palette, map palette): an earlier map-palette render must not leak into this one.
  expect(Array.from(renderChunk(world, 0, 0, { surfaceY: 1, layers: allLayers }).pixels.slice(0, 4)))
    .toEqual(placeholderColor({ kind: "vanilla", id: 1 }, "block"));
});

describe("mapOption", () => {
  const rule = { axis: "frameY", ranges: [[36, 71, 1], [72, 107, 2]] } as const;

  test.each([
    [0, 0], [35, 0], [36, 1], [71, 1], [72, 2], [107, 2], [108, 0], [-1, 0],
  ])("frameY %i selects option %i", (frameY, option) => {
    expect(mapOption(rule, 999, frameY)).toBe(option);
  });

  test("reads only the rule's axis", () => {
    expect(mapOption({ axis: "frameX", ranges: [[18, 35, 1]] }, 18, 999)).toBe(1);
    expect(mapOption({ axis: "frameX", ranges: [[18, 35, 1]] }, 999, 18)).toBe(0);
  });

  test("without a rule the option is 0", () => {
    expect(mapOption(undefined, 18, 36)).toBe(0);
  });
});

describe("contentColor with a frame", () => {
  test.each([
    [0, 0, 0x6c7078], [17, 0, 0x6c7078], [18, 0, 0x60666e], [35, 99, 0x60666e], [36, 0, 0x6c7078],
  ])("tile 1 at frameX %i, frameY %i", (frameX, frameY, color) => {
    expect(contentColor({ kind: "vanilla", id: 1 }, "block", syntheticMapPalette, frameX, frameY))
      .toEqual([color >> 16, (color >> 8) & 0xff, color & 0xff, 255]);
  });

  test.each([[0, 0x112233], [36, 0x445566], [90, 0x778899], [108, 0x112233]])("tile 3 at frameY %i", (frameY, color) => {
    expect(contentColor({ kind: "vanilla", id: 3 }, "block", syntheticMapPalette, 0, frameY))
      .toEqual([color >> 16, (color >> 8) & 0xff, color & 0xff, 255]);
  });

  test("content without a rule keeps option 0 at any frame", () => {
    expect(contentColor({ kind: "vanilla", id: 0 }, "block", syntheticMapPalette, 18, 36)).toEqual([0x76, 0x58, 0x3e, 255]);
  });

  test("a rule selecting an option the content lacks falls back to the placeholder-free option 0", () => {
    const palette = {
      ...syntheticMapPalette, tileOptions: { 0: { axis: "frameX", ranges: [[0, 9, 5]] } },
    } as const;
    expect(contentColor({ kind: "vanilla", id: 0 }, "block", palette, 4, 0)).toEqual([0x76, 0x58, 0x3e, 255]);
  });
});

test("renderChunk picks each block's option by its frame planes", () => {
  const world = createWorld(5, 1);
  const frames: [number, number][] = [[0, 0], [18, 0], [0, 36], [0, 72], [0, 108]];
  frames.forEach(([frameX, frameY], x) => {
    world.setTile(x, 0, {
      block: { kind: "vanilla", id: x === 1 ? 1 : 3 }, frameX, frameY, wires: 0, actuator: false,
    });
  });
  const pixels = renderChunk(world, 0, 0, { surfaceY: 1, layers: allLayers, mapPalette: syntheticMapPalette }).pixels;
  expect(Array.from(pixels)).toEqual([
    0x11, 0x22, 0x33, 255, 0x60, 0x66, 0x6e, 255, 0x44, 0x55, 0x66, 255, 0x77, 0x88, 0x99, 255, 0x11, 0x22, 0x33, 255,
  ]);
});

test("renderChunk gives the same content different options at different frames in one chunk, and paint still applies", () => {
  const world = createWorld(2, 1);
  world.setTile(0, 0, { block: { kind: "vanilla", id: 3 }, frameY: 36, wires: 0, actuator: false });
  world.setTile(1, 0, { block: { kind: "vanilla", id: 3 }, frameY: 72, paint: 1, wires: 0, actuator: false });
  const pixels = renderChunk(world, 0, 0, { surfaceY: 1, layers: allLayers, mapPalette: syntheticMapPalette }).pixels;
  expect(Array.from(pixels)).toEqual([0x44, 0x55, 0x66, 255, 0x99, 0, 0, 255]);
});

describe("backgroundColor", () => {
  // A 1000-row world: surface at 300.6, rock layer at 500.4, underworld from row 800 (height − 200).
  const depth = { surfaceY: 300.6, rockY: 500.4, height: 1000 };
  const sky = (index: number): readonly number[] => [0, index, 255, 255];

  test.each([
    [0, sky(0)], [1, sky(0)], [2, sky(1)], [150, sky(127)], [300, sky(254)],
  ])("row %i above the surface takes sky gradient entry floor(y / surface × 255)", (y, expected) => {
    expect(backgroundColor(y, depth, syntheticMapPalette)).toEqual(expected);
  });

  test.each([
    [301, [0x5a, 0x3c, 0x28, 255]], [500, [0x5a, 0x3c, 0x28, 255]],
    [501, [0x46, 0x46, 0x46, 255]], [799, [0x46, 0x46, 0x46, 255]],
    [800, [0x32, 0x14, 0x14, 255]], [999, [0x32, 0x14, 0x14, 255]],
  ])("row %i below the surface is dirt, rock or underworld by its layer", (y, expected) => {
    expect(backgroundColor(y, depth, syntheticMapPalette)).toEqual(expected);
  });

  test("without a rock level the dirt layer reaches the underworld", () => {
    expect(backgroundColor(799, { surfaceY: 300, height: 1000 }, syntheticMapPalette)).toEqual([0x5a, 0x3c, 0x28, 255]);
  });

  test("without a map palette the placeholder sky and underground colours are used", () => {
    expect(backgroundColor(300, depth)).toEqual([100, 160, 220, 255]);
    expect(backgroundColor(301, depth)).toEqual([40, 30, 20, 255]);
    expect(backgroundColor(900, depth)).toEqual([40, 30, 20, 255]);
  });
});

describe("paintedColor", () => {
  test("a colour paint scales the paint colour by the brightest base channel, truncating", () => {
    expect(paintedColor([128, 128, 128, 255], 1, "block", syntheticMapPalette)).toEqual([128, 0, 0, 255]);
    expect(paintedColor([128, 128, 128, 255], 2, "block", syntheticMapPalette)).toEqual([128, 63, 0, 255]);
    expect(paintedColor([114, 81, 56, 255], 25, "wall", syntheticMapPalette)).toEqual([33, 33, 33, 255]);
  });

  test("shadow paint (29) turns the colour into a near-black grey of the blue channel / 34", () => {
    expect(paintedColor([28, 216, 94, 255], 29, "block", syntheticMapPalette)).toEqual([2, 2, 2, 255]);
    expect(paintedColor([255, 255, 255, 255], 29, "wall", syntheticMapPalette)).toEqual([7, 7, 7, 255]);
  });

  test("negative paint (30) inverts blocks and inverts walls at half brightness", () => {
    expect(paintedColor([106, 210, 255, 255], 30, "block", syntheticMapPalette)).toEqual([149, 45, 0, 255]);
    expect(paintedColor([87, 59, 55, 255], 30, "wall", syntheticMapPalette)).toEqual([84, 98, 100, 255]);
  });

  test("no paint, an unknown paint ID or no map palette leave the colour unchanged", () => {
    expect(paintedColor([1, 2, 3, 255], 0, "block", syntheticMapPalette)).toEqual([1, 2, 3, 255]);
    expect(paintedColor([1, 2, 3, 255], 200, "block", syntheticMapPalette)).toEqual([1, 2, 3, 255]);
    expect(paintedColor([1, 2, 3, 255], 1, "block")).toEqual([1, 2, 3, 255]);
  });
});

test("renderChunk paints blocks and walls and draws the background by depth with a map palette", () => {
  const world = createWorld(2, 3);
  world.setTile(0, 0, { block: { kind: "vanilla", id: 0 }, paint: 1, wires: 0, actuator: false });
  world.setTile(1, 0, { wall: { kind: "vanilla", id: 1 }, wallPaint: 30, wires: 0, actuator: false });
  const pixels = renderChunk(world, 0, 0, {
    surfaceY: 1.5, rockY: 2, layers: allLayers, mapPalette: syntheticMapPalette,
  }).pixels;
  const pixel = (x: number, y: number): number[] => Array.from(pixels.slice((y * 2 + x) * 4, (y * 2 + x) * 4 + 4));
  expect(pixel(0, 0)).toEqual([0x76, 0, 0, 255]);
  expect(pixel(1, 0)).toEqual([(255 - 0x52) >> 1, (255 - 0x56) >> 1, (255 - 0x5c) >> 1, 255]);
  // Row 1 is still above the surface (sky entry floor(1 / 1.5 × 255) = 170). Row 2 is below it, and a 3-row world
  // is underworld from row 0 (height − 200 < 0).
  expect(pixel(0, 1)).toEqual([0, 170, 255, 255]);
  expect(pixel(0, 2)).toEqual([0x32, 0x14, 0x14, 255]);
});

test("without a map palette paint does not change renderChunk pixels", () => {
  const world = createWorld(1, 1);
  world.setTile(0, 0, { block: { kind: "vanilla", id: 0 }, paint: 1, wires: 0, actuator: false });
  expect(Array.from(renderChunk(world, 0, 0, { surfaceY: 1, layers: allLayers }).pixels))
    .toEqual(placeholderColor({ kind: "vanilla", id: 0 }, "block"));
});

describe("the shipped Terraria map palette", () => {
  const { background } = terrariaMapPalette;
  const colors = [
    ...terrariaMapPalette.tiles.flat(), ...terrariaMapPalette.walls.flat(), ...terrariaMapPalette.liquids,
    ...background.sky, background.dirt, background.rock, background.hell, ...terrariaMapPalette.paints,
  ];

  test("names the game version it was exported from", () => {
    expect(terrariaMapPalette.gameVersion).toMatch(/^\d+(\.\d+)+$/);
  });

  test("covers the vanilla tile and wall IDs", () => {
    // The 1.4.5.8 export has 754 tiles and 367 walls; a much shorter table means a broken export.
    expect(terrariaMapPalette.tiles.length).toBeGreaterThanOrEqual(700);
    expect(terrariaMapPalette.walls.length).toBeGreaterThanOrEqual(350);
  });

  test("has a 256-step sky gradient and a colour for every paint ID up to negative paint (30)", () => {
    expect(terrariaMapPalette.background.sky).toHaveLength(256);
    expect(terrariaMapPalette.paints.length).toBeGreaterThan(30);
  });

    test("holds only 24-bit RGB colours", () => {
    expect(colors.every((color) => Number.isInteger(color) && color >= 0 && color <= 0xffffff)).toBe(true);
  });

  test("colours common vanilla content (dirt and stone blocks, stone and dirt walls)", () => {
    for (const [id, layer] of [[0, "block"], [1, "block"], [1, "wall"], [2, "wall"]] as const) {
      expect(contentColor({ kind: "vanilla", id }, layer, terrariaMapPalette))
        .not.toEqual(placeholderColor({ kind: "vanilla", id }, layer));
    }
  });
});
