import { expect, test } from "vitest";
import type { WorldTilesResult } from "@studio/world-codec";
import { toRenderableWorld } from "../src/world/renderable-world.js";

test("a loaded world is drawn by reference with its own surface and rock levels", () => {
  const planes = { block: new Uint16Array(8), paint: new Uint8Array(8) };
  const palette = [{ kind: "vanilla", id: 1 }];
  const loaded = {
    metadata: { width: 2, height: 4, surfaceLevel: 1.5, rockLevel: 2.75 },
    planes,
    palette,
  } as unknown as WorldTilesResult;

  const world = toRenderableWorld(loaded);

  expect(world).toMatchObject({ width: 2, height: 4, surfaceY: 1.5, rockY: 2.75 });
  expect(world.planes).toBe(planes);
  expect(world.palette).toBe(palette);
});
