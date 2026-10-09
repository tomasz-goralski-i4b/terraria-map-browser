import { expect, test, vi } from "vitest";
import { createWorld } from "@studio/world-model";
import { renderChunk } from "../src/index.js";
import type { ChunkRenderOptions } from "../src/index.js";
import { allocationCount } from "./allocation-count.js";

function allocateTileViews(): void {
  // Keep these objects observable until this function returns, then let the profiler collect them.
  const tiles = [];
  for (let y = 0; y < 4096; y++) tiles.push({ block: 1, wall: 2, liquidAmount: y % 256 });
  expect(tiles[4095]).toEqual({ block: 1, wall: 2, liquidAmount: 255 });
}

test("allocation counter observes temporary tile objects even after GC", async () => {
  expect(await allocationCount(allocateTileViews, "allocateTileViews")).toBeGreaterThanOrEqual(4096);
});

test("renders every Large-world chunk with allocations bounded per chunk, not per tile", async () => {
  const world = createWorld(8400, 2400);
  world.setTile(0, 0, { block: { kind: "vanilla", id: 1 }, wall: { kind: "vanilla", id: 2 }, wires: 0, actuator: false });
  world.planes.block.fill(0);
  world.planes.wall.fill(1);
  world.planes.liquid.fill(1);
  world.planes.liquidAmount.fill(128);
  const tileAt = vi.spyOn(world, "tileAt").mockImplementation(() => {
    throw new Error("Large-world rendering must not allocate tile views");
  });
  const options: ChunkRenderOptions = {
    surfaceY: 350,
    layers: { background: true, walls: true, blocks: true, liquids: true },
  };
  // Warm up the entry point so module initialization and JIT setup are outside the count.
  renderChunk(world, 0, 0, options);
  let chunkCount = 0;
  let pixelCount = 0;
  let incorrectChunks = 0;
  const objects = await allocationCount(() => {
    for (let cx = 0; cx < Math.ceil(world.width / 128); cx++) {
      for (let cy = 0; cy < Math.ceil(world.height / 128); cy++) {
        const chunk = renderChunk(world, cx, cy, options);
        chunkCount++;
        pixelCount += chunk.width * chunk.height;
        // Scalar checks keep the measurement harness itself free of per-pixel allocations.
        for (let offset = 0; offset < chunk.pixels.length; offset += 4) {
          if (chunk.pixels[offset] !== 98 || chunk.pixels[offset + 1] !== 141
            || chunk.pixels[offset + 2] !== 162 || chunk.pixels[offset + 3] !== 255) {
            incorrectChunks++;
            break;
          }
        }
      }
    }
  }, "renderChunk");
  expect(chunkCount).toBe(66 * 19);
  expect(pixelCount).toBe(8400 * 2400);
  expect(incorrectChunks).toBe(0);
  expect(tileAt).not.toHaveBeenCalled();
  // Includes RGBA arrays, result objects, palette caches and helper allocations. The fixed two-ref
  // palette allows a generous 64 objects/chunk, far below even one object for each of 20M tiles.
  expect(objects).toBeGreaterThanOrEqual(chunkCount);
  expect(objects).toBeLessThanOrEqual(chunkCount * 64);
}, 120_000);
