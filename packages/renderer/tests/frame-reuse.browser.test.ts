// Scheduled frames reuse the previous frame when only the camera moved, by whole screen pixels at the same zoom: they
// copy it shifted and draw only the strips the pan revealed. The result equals the frame drawn in full.
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMapRenderer } from "../src/index.js";
import type { Camera, MapRenderer, RenderableWorld, SpriteAtlasSource } from "../src/index.js";

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

  test("a reused frame uploads its chunk instances once for both revealed strips and the highlight", () => {
    const step = animationFrames();
    const { renderer } = setup(patchwork(300, 200));
    renderer.setHighlight({ blocks: [1], walls: [], liquids: [], dim: true });
    renderer.setCamera({ x: 40.2, y: 30.9, zoom: 3 });
    step();
    const gl = WebGL2RenderingContext.prototype;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with the real receiver below
    const bufferData = gl.bufferData;
    let uploads = 0;
    vi.spyOn(gl, "bufferData").mockImplementation(function (this: WebGL2RenderingContext, ...args: unknown[]) {
      uploads++;
      (bufferData as (...rest: unknown[]) => void).apply(this, args);
    });
    // Diagonal: two strips, each drawn by the chunk pass, then the highlight over the chunks drawn.
    renderer.setCamera({ x: 55.5, y: 41.5, zoom: 3 });
    step();
    expect(renderer.stats().reusedFrames).toBe(1);
    expect(uploads).toBe(1);
  });

  test("in sprite mode a pan reuses the frame with the depth layering intact: plants behind blocks and under water", () => {
    const step = animationFrames();
    // Stone (map colour) with plants (3, 16 × 20, reaching 4 pixels into the stone below) on it, half of them under water.
    const width = 60, height = 40, count = width * height;
    const block = new Uint16Array(count).fill(ABSENT);
    const frameX = new Int16Array(count).fill(-1);
    const frameY = new Int16Array(count).fill(-1);
    const liquid = new Uint8Array(count), liquidAmount = new Uint8Array(count);
    for (let x = 0; x < width; x++) {
      for (let y = 20; y < height; y++) block[x * height + y] = 0;
      if (x % 3 !== 0) {
        block[x * height + 19] = 1;
        frameX[x * height + 19] = 0;
        frameY[x * height + 19] = 0;
      }
      if (x % 4 < 2) for (let y = 17; y < 20; y++) { liquid[x * height + y] = 1; liquidAmount[x * height + y] = 255; }
    }
    const world: RenderableWorld = {
      width, height, surfaceY: 10,
      palette: [{ kind: "vanilla", id: 1 }, { kind: "vanilla", id: 3 }],
      planes: { block, wall: new Uint16Array(count).fill(ABSENT), frameX, frameY, liquid, liquidAmount, paint: new Uint8Array(count), wallPaint: new Uint8Array(count) },
    };
    const PAGE = 64;
    const page = new Uint8Array(PAGE * PAGE * 4);
    const plant = { kind: "tile", id: 3, page: 0, x: 2, y: 2, width: 16, height: 20, frameWidth: 16, frameHeight: 20 } as const;
    const water = { kind: "liquid", id: 0, page: 0, x: 2, y: 26, width: 34, height: 16, frameWidth: 16, frameHeight: 16 } as const;
    for (let y = 0; y < 20; y++) for (let x = 0; x < 16; x++) page.set([200, x * 9, y * 11, (x + y) % 4 === 0 ? 0 : 255], ((plant.y + y) * PAGE + plant.x + x) * 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 34; x++) page.set([10, 60 + y * 5, 200, 255], ((water.y + y) * PAGE + water.x + x) * 4);
    const atlas: SpriteAtlasSource = { pages: [page], index: { pageSize: PAGE, entries: [plant, water] } };
    const sprites = (renderer: MapRenderer): void => {
      renderer.setAtlas(atlas);
      renderer.setSpriteMode(true);
      renderer.setLayers({ background: true, walls: true, blocks: true, liquids: true });
    };
    const { renderer, pixels } = setup(world);
    sprites(renderer);
    const start = { x: 10.3, y: 14.2, zoom: 16 };
    renderer.setCamera(start);
    step();
    const moved = { x: start.x + 1.75, y: start.y + 0.5, zoom: 16 };
    renderer.setCamera(moved);
    step();
    expect(renderer.stats().reusedFrames).toBe(1);
    const reused = pixels();
    const full = setup(world);
    sprites(full.renderer);
    full.renderer.setCamera(moved);
    step();
    expect(full.renderer.stats().reusedFrames).toBe(0);
    expect(reused).toEqual(full.pixels());
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
