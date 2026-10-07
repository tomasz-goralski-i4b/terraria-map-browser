import { expect, test } from "vitest";
import { createWorld } from "@studio/world-model";
import { parseMapPalette } from "../src/map-palette.js";
import { placeholderColor, renderChunk } from "../src/chunk/render.js";
import { syntheticMapPalette } from "./map-palette.fixture.js";

test("imports indexed variants without changing their IDs", () => {
  const palette = parseMapPalette(JSON.stringify(syntheticMapPalette));
  expect(palette.tiles[1]?.[0]).toEqual([108, 112, 120]);
  expect(palette.walls[0]).toEqual([]);
  expect(palette.gameVersion).toBe("1.4.5.8");
});

test.each([
  { ...syntheticMapPalette, schemaVersion: 2 },
  { ...syntheticMapPalette, gameVersion: "" },
  { ...syntheticMapPalette, tiles: [[[256, 88, 62]]] },
  { ...syntheticMapPalette, tiles: [[[118, -1, 62]]] },
  { ...syntheticMapPalette, tiles: [[[118, 88.5, 62]]] },
  { ...syntheticMapPalette, walls: [null] },
  { ...syntheticMapPalette, liquids: [[32, 104, 210]] },
])("rejects malformed palette %j", (palette) => {
  expect(() => parseMapPalette(JSON.stringify(palette))).toThrow();
});

test("imported block, wall and liquid colours reach CPU pixels; unmapped IDs retain placeholders", () => {
  const world = createWorld(4, 1);
  world.setTile(0, 0, { block: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  world.setTile(1, 0, { wall: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  world.setTile(2, 0, { liquid: { kind: "water", amount: 255 }, wires: 0, actuator: false });
  world.setTile(3, 0, { block: { kind: "vanilla", id: 25 }, wires: 0, actuator: false });
  const pixels = renderChunk(world, 0, 0, {
    surfaceY: 1, layers: { blocks: true, walls: true, liquids: true, background: true },
    mapPalette: syntheticMapPalette,
  }).pixels;
  expect(Array.from(pixels)).toEqual([
    108, 112, 120, 255, 82, 86, 92, 255, 32, 104, 210, 255,
    ...placeholderColor({ kind: "vanilla", id: 25 }, "block"),
  ]);
  // An earlier render with imported colours must not contaminate the placeholder cache.
  expect(Array.from(renderChunk(world, 0, 0, {
    surfaceY: 1, layers: { blocks: true, walls: true, liquids: true, background: true },
  }).pixels.slice(0, 4))).toEqual(placeholderColor({ kind: "vanilla", id: 1 }, "block"));
});
