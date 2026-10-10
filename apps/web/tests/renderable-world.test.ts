import { expect, test } from "vitest";
import type { WorldTilesResult } from "@studio/world-codec";
import { toRenderableWorld } from "../src/world/renderable-world.js";

const generation = { treeX: [1354, 4200, 4200], treeTopVariations: [5, 3, 0, 0, 0, 6, 6, 2, 3, 51, 0, 3, 0] };

test("a loaded world is drawn by reference with its own surface and rock levels", () => {
  const planes = { block: new Uint16Array(8), paint: new Uint8Array(8) };
  const palette = [{ kind: "vanilla", id: 1 }];
  const loaded = {
    metadata: { width: 2, height: 4, surfaceLevel: 1.5, rockLevel: 2.75 },
    details: { generation },
    planes,
    palette,
  } as unknown as WorldTilesResult;

  const world = toRenderableWorld(loaded);

  expect(world).toMatchObject({ width: 2, height: 4, surfaceY: 1.5, rockY: 2.75 });
  expect(world.planes).toBe(planes);
  expect(world.palette).toBe(palette);
});

test("the world's tree-style zones and tree top variations reach the renderer (docs/assets.md, \"Trees\")", () => {
  const loaded = {
    metadata: { width: 2, height: 4, surfaceLevel: 1, rockLevel: 2 },
    details: { generation },
    planes: { block: new Uint16Array(8) },
    palette: [],
  } as unknown as WorldTilesResult;

  expect(toRenderableWorld(loaded).trees).toEqual(generation);
});
