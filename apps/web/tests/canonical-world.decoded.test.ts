import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { readWorldTiles } from "@studio/world-codec";
import { createWorld, type Tile, type WorldPlanes } from "@studio/world-model";
import { toCanonicalWorld } from "../src/world/canonical-world.js";

const fixture = new URL("../../../packages/test-fixtures/worlds/SMCO1.wld", import.meta.url);
const COLUMNS = 16;

const PLANE_NAMES = [
  "block", "wall", "frameX", "frameY", "paint", "wallPaint", "liquid", "liquidAmount", "shape", "flags",
] as const;

test("toCanonicalWorld_fixtureDecodedPlanes_matchesWorldBuiltWithSetTileAtEveryCoordinate", () => {
  const loaded = readWorldTiles(new Uint8Array(readFileSync(fixture)));
  const { width, height } = loaded.metadata;
  const view = toCanonicalWorld(loaded);
  const expected = createWorld(width, height);
  const columns = Math.min(COLUMNS, width);

  // The expected world is populated through setTile from tiles resolved against the decoded palette.
  for (let x = 0; x < columns; x++) {
    for (let y = 0; y < height; y++) expected.setTile(x, y, view.tileAt(x, y));
  }

  for (let x = 0; x < columns; x++) {
    for (let y = 0; y < height; y++) {
      const tile: Tile = view.tileAt(x, y);
      expect(tile).toEqual(expected.tileAt(x, y));
      const index = x * height + y;
      for (const name of PLANE_NAMES) {
        expect(loaded.planes[name][index], `${name} at ${String(x)},${String(y)}`).toBe(expected.planes[name][index]);
      }
    }
  }
}, 60_000);

test("toCanonicalWorld_fixtureDecodedPlanes_neverCopiesAnyPlaneOrBuffer", () => {
  const loaded = readWorldTiles(new Uint8Array(readFileSync(fixture)));
  const planes: WorldPlanes = loaded.planes;
  const arrays = PLANE_NAMES.map((name) => planes[name]);
  const buffers = arrays.map((array) => array.buffer);
  const view = toCanonicalWorld(loaded);

  const identical = (): void => {
    PLANE_NAMES.forEach((name, i) => {
      expect(view.planes[name], `${name} array`).toBe(arrays[i]);
      expect(view.planes[name].buffer, `${name} buffer`).toBe(buffers[i]);
    });
  };
  identical();

  view.setTile(0, 0, {
    block: { kind: "vanilla", id: 4 }, wall: { kind: "vanilla", id: 2 }, paint: 3, wallPaint: 5,
    liquid: { kind: "lava", amount: 77 }, shape: "half", wires: 5, actuator: true,
  });
  identical();

  expect(planes.paint[0]).toBe(3);
  expect(planes.wallPaint[0]).toBe(5);
  expect(planes.liquid[0]).not.toBe(0);
  expect(planes.liquidAmount[0]).toBe(77);
  expect(planes.shape[0]).not.toBe(0);
  expect((planes.flags[0] ?? 0) & 15).toBe(5);
});
