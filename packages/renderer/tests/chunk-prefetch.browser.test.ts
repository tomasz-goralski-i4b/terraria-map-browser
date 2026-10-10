// Chunks around the viewport are uploaded ahead while the browser is idle (MapRendererOptions.prefetchChunks), so a pan
// by up to one chunk finds the chunks it reveals resident and uploads nothing.
import { afterEach, describe, expect, test } from "vitest";
import { CHUNK_SIZE, createMapRenderer, visibleChunks } from "../src/index.js";
import type { MapRenderer, MapRendererOptions, RenderableWorld } from "../src/index.js";

const renderers: MapRenderer[] = [];
afterEach(() => {
  for (const renderer of renderers.splice(0)) renderer.dispose();
});

/** Dirt above stone, no walls or liquids; column-major CWM planes. */
function terrain(width: number, height: number): RenderableWorld {
  const count = width * height;
  const block = new Uint16Array(count);
  for (let x = 0; x < width; x++) block.fill(1, x * height + Math.floor(height / 2), (x + 1) * height);
  return {
    width, height, surfaceY: Math.floor(height / 3),
    palette: [{ kind: "vanilla", id: 0 }, { kind: "vanilla", id: 1 }],
    planes: {
      block, wall: new Uint16Array(count).fill(0xffff), liquid: new Uint8Array(count),
      liquidAmount: new Uint8Array(count), paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
    },
  };
}

/** Waits until the resident chunk count stops changing for a few idle periods (at most 5 s). */
async function settle(renderer: MapRenderer): Promise<void> {
  let last = -1;
  let quiet = 0;
  const start = performance.now();
  while (quiet < 5 && performance.now() - start < 5000) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    const resident = renderer.stats().residentChunks;
    quiet = resident === last ? quiet + 1 : 0;
    last = resident;
  }
}

function setup(options?: MapRendererOptions) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const renderer = createMapRenderer(canvas, options);
  renderers.push(renderer);
  const world = terrain(CHUNK_SIZE * 8, CHUNK_SIZE * 6);
  renderer.setWorld(world);
  return { canvas, renderer, world };
}

describe("chunk prefetch", () => {
  test("after an idle period the ring of chunks around the view is resident, so a one-chunk pan uploads nothing", async () => {
    const { canvas, renderer, world } = setup();
    const camera = { x: CHUNK_SIZE * 3, y: CHUNK_SIZE * 2, zoom: 1 };
    renderer.setCamera(camera);
    renderer.render();
    const shown = visibleChunks(camera, canvas, world).length;
    await settle(renderer);
    const ring = visibleChunks(
      { x: camera.x - CHUNK_SIZE, y: camera.y - CHUNK_SIZE, zoom: 1 },
      { width: canvas.width + 2 * CHUNK_SIZE, height: canvas.height + 2 * CHUNK_SIZE },
      world,
    ).length;
    expect(renderer.stats().residentChunks).toBe(ring);
    expect(ring).toBeGreaterThan(shown);
    const uploads = renderer.stats().textureUploads;
    renderer.setCamera({ ...camera, x: camera.x + CHUNK_SIZE, y: camera.y - CHUNK_SIZE });
    renderer.render();
    expect(renderer.stats().textureUploads).toBe(uploads);
  });

  test("prefetchChunks 0 uploads only what the frames draw", async () => {
    const { canvas, renderer, world } = setup({ prefetchChunks: 0 });
    const camera = { x: CHUNK_SIZE * 3, y: CHUNK_SIZE * 2, zoom: 1 };
    renderer.setCamera(camera);
    renderer.render();
    await settle(renderer);
    expect(renderer.stats().residentChunks).toBe(visibleChunks(camera, canvas, world).length);
  });
});
