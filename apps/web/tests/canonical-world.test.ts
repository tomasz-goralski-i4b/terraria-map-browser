import { expect, test } from "vitest";
import type { WorldTilesResult } from "@studio/world-codec";
import { toCanonicalWorld } from "../src/world/canonical-world.js";
import { toRenderableWorld } from "../src/world/renderable-world.js";

function loadedWorld(): WorldTilesResult {
  const planes = {
    block: new Uint16Array([0, 0xffff, 1, 0xffff, 0, 0]),
    wall: new Uint16Array([0xffff, 0xffff, 0xffff, 1, 1, 1]),
    frameX: new Int16Array(6).fill(-1),
    frameY: new Int16Array(6).fill(-1),
    paint: new Uint8Array(6),
    wallPaint: new Uint8Array(6),
    liquid: new Uint8Array(6),
    liquidAmount: new Uint8Array(6),
    shape: new Uint8Array(6),
    flags: new Uint16Array(6),
  };
  const palette = [{ kind: "vanilla", id: 1 }, { kind: "vanilla", id: 2 }];
  return {
    metadata: { width: 2, height: 3, surfaceLevel: 1, rockLevel: 2 },
    details: { generation: { treeX: [1, 1, 1], treeTopVariations: [] } },
    planes,
    palette,
  } as unknown as WorldTilesResult;
}

test("toCanonicalWorld_loadedWorld_readsTilesFromTheLoadedPlanes", () => {
  const world = toCanonicalWorld(loadedWorld());
  expect([world.width, world.height]).toEqual([2, 3]);
  expect(world.tileAt(0, 0).block).toEqual({ kind: "vanilla", id: 1 });
  expect(world.tileAt(1, 0).wall).toEqual({ kind: "vanilla", id: 2 });
});

test("toCanonicalWorld_sameLoadedWorld_sharesPlaneBuffersWithTheRenderableWorld", () => {
  const loaded = loadedWorld();
  const canonical = toCanonicalWorld(loaded);
  const renderable = toRenderableWorld(loaded);

  expect(canonical.planes.block).toBe(loaded.planes.block);
  expect(canonical.planes.block.buffer).toBe(renderable.planes.block.buffer);

  canonical.setTile(1, 1, { block: { kind: "vanilla", id: 2 }, wires: 0, actuator: false });
  expect(renderable.planes.block[1 * 3 + 1]).toBe(1);
});
