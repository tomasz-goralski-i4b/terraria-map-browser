import { describe, expect, test } from "vitest";
import { createWorld } from "@studio/world-model";
import { contentColor, liquidColors, placeholderColor, renderChunk, terrariaMapPalette } from "../src/index.js";
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

describe("the shipped Terraria map palette", () => {
  const colors = [...terrariaMapPalette.tiles.flat(), ...terrariaMapPalette.walls.flat(), ...terrariaMapPalette.liquids];

  test("names the game version it was exported from", () => {
    expect(terrariaMapPalette.gameVersion).toMatch(/^\d+(\.\d+)+$/);
  });

  test("covers the vanilla tile and wall IDs", () => {
    // The 1.4.5.8 export has 754 tiles and 367 walls; a much shorter table means a broken export.
    expect(terrariaMapPalette.tiles.length).toBeGreaterThanOrEqual(700);
    expect(terrariaMapPalette.walls.length).toBeGreaterThanOrEqual(350);
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
