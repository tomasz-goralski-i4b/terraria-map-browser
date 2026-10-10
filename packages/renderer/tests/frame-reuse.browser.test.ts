// Scheduled frames reuse the previous frame when only the camera moved, by whole screen pixels at the same zoom: they
// copy it shifted and draw only the strips the pan revealed. The result equals the frame drawn in full.
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMapRenderer } from "../src/index.js";
import type { Camera, MapRenderer, RenderableWorld } from "../src/index.js";

const renderers: MapRenderer[] = [];
afterEach(() => {
  for (const renderer of renderers.splice(0)) renderer.dispose();
  vi.restoreAllMocks();
});

const ABSENT = 0xffff;

/** Six block kinds and two walls scattered by a hash, so a pixel off by one tile shows. */
function patchwork(width: number, height: number): RenderableWorld {
  const count = width * height;
  const block = new Uint16Array(count);
  const wall = new Uint16Array(count);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const hash = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
      block[x * height + y] = hash % 7 === 0 ? ABSENT : hash % 6;
      wall[x * height + y] = 6 + (hash >>> 4) % 2;
    }
  }
  return {
    width, height, surfaceY: Math.floor(height / 3),
    palette: [0, 1, 2, 3, 6, 7, 1, 2].map((id, index) => ({ kind: "vanilla", id: index < 6 ? id : id + 10 })) as never,
    planes: {
      block, wall, liquid: new Uint8Array(count), liquidAmount: new Uint8Array(count),
      paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
    },
  };
}

/** Runs the queued animation frame callbacks on demand (requestAnimationFrame mocked). */
function animationFrames(): () => void {
  let nextId = 1;
  const pending = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextId++;
    pending.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { pending.delete(id); });
  return () => {
    const callbacks = [...pending.values()];
    pending.clear();
    for (const callback of callbacks) callback(0);
  };
}

function setup(world: RenderableWorld) {
  const canvas = document.createElement("canvas");
  canvas.width = 203;
  canvas.height = 117;
  const renderer = createMapRenderer(canvas, { prefetchChunks: 0 });
  renderers.push(renderer);
  renderer.setWorld(world);
  const gl = canvas.getContext("webgl2");
  if (gl === null) throw new Error("WebGL2 unavailable");
  const pixels = (): Uint8Array => {
    const bytes = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    return bytes;
  };
  return { renderer, pixels };
}

/** The frame of a fresh renderer drawn in full at `camera` by a scheduled frame. */
function fullFrame(world: RenderableWorld, camera: Camera, step: () => void): Uint8Array {
  const { renderer, pixels } = setup(world);
  renderer.setCamera(camera);
  step();
  expect(renderer.stats().reusedFrames).toBe(0);
  return pixels();
}

describe("frame reuse", () => {
  test.each([
    ["right and down", 15.3, 10.6],
    ["left and up", -12.9, -8.2],
    ["right only", 3.7, 0],
  ])("a pan %s reuses the last frame and equals the frame drawn in full", (_label, dx, dy) => {
    const step = animationFrames();
    const world = patchwork(300, 200);
    const { renderer, pixels } = setup(world);
    const start = { x: 40.2, y: 30.9, zoom: 3 };
    renderer.setCamera(start);
    step();
    const moved = { x: start.x + dx, y: start.y + dy, zoom: 3 };
    renderer.setCamera(moved);
    step();
    expect(renderer.stats().reusedFrames).toBe(1);
    const reused = pixels();
    expect(reused).toEqual(fullFrame(world, moved, step));
  });

  test("anything else than the camera, another zoom or a synchronous render draws the frame in full", () => {
    const step = animationFrames();
    const world = patchwork(300, 200);
    const { renderer } = setup(world);
    renderer.setCamera({ x: 40, y: 30, zoom: 3 });
    step();
    renderer.setLayers({ background: true, walls: false, blocks: true, liquids: true });
    renderer.setCamera({ x: 45, y: 30, zoom: 3 });
    step();
    renderer.setCamera({ x: 45, y: 30, zoom: 4 });
    step();
    renderer.setCamera({ x: 50, y: 30, zoom: 4 });
    renderer.render();
    expect(renderer.stats().reusedFrames).toBe(0);
    // The synchronous render drew the canvas itself: the next scheduled frame is drawn in full, the one after reuses it.
    renderer.setCamera({ x: 55, y: 30, zoom: 4 });
    step();
    expect(renderer.stats().reusedFrames).toBe(0);
    renderer.setCamera({ x: 60, y: 30, zoom: 4 });
    step();
    expect(renderer.stats().reusedFrames).toBe(1);
  });
});
