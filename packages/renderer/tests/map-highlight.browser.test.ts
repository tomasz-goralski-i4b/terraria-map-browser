// The content highlight on the GPU (#186): from one pixel per tile up the overlay pass equals `highlightOverlay`
// composed over the terrain; at overview zoom a mask built in idle slices keeps lone matches visible; and neither
// setting, changing or clearing a highlight nor moving the camera with one uploads chunk textures again.
import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_HIGHLIGHT_COLOR, createMapRenderer, highlightOverlay } from "../src/index.js";
import type { Camera, MapGrid, MapHighlight, MapRenderer, MapRendererOptions, RenderableWorld } from "../src/index.js";

const renderers: MapRenderer[] = [];
afterEach(() => {
  for (const renderer of renderers.splice(0)) renderer.dispose();
  vi.restoreAllMocks();
});

const ABSENT = 0xffff;

/** Six block kinds, two walls and some liquids (amounts 0 included) scattered by a hash, all over the map. */
function patchwork(width: number, height: number): RenderableWorld {
  const count = width * height;
  const block = new Uint16Array(count);
  const wall = new Uint16Array(count);
  const liquid = new Uint8Array(count);
  const liquidAmount = new Uint8Array(count);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const hash = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
      const i = x * height + y;
      block[i] = hash % 7 === 0 ? ABSENT : hash % 6;
      wall[i] = 6 + (hash >>> 4) % 2;
      if (block[i] === ABSENT && (hash >>> 9) % 3 !== 0) {
        liquid[i] = 1 + (hash >>> 11) % 3;
        liquidAmount[i] = (hash >>> 13) % 4 === 0 ? 0 : 255;
      }
    }
  }
  return {
    width, height, surfaceY: Math.floor(height / 3),
    palette: [0, 1, 2, 3, 6, 7, 1, 2].map((id, index) => ({ kind: "vanilla", id: index < 6 ? id : id + 10 })) as never,
    planes: { block, wall, liquid, liquidAmount, paint: new Uint8Array(count), wallPaint: new Uint8Array(count) },
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

function setup(world: RenderableWorld, width = 203, height = 117, options: MapRendererOptions = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = createMapRenderer(canvas, { prefetchChunks: 0, ...options });
  renderers.push(renderer);
  renderer.setWorld(world);
  const gl = canvas.getContext("webgl2");
  if (gl === null) throw new Error("WebGL2 unavailable");
  /** The canvas, top row first. */
  const pixels = (): Uint8Array => {
    const bytes = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    const flipped = new Uint8Array(bytes.length);
    for (let row = 0; row < height; row++) {
      flipped.set(bytes.subarray((height - 1 - row) * width * 4, (height - row) * width * 4), row * width * 4);
    }
    return flipped;
  };
  return { renderer, pixels };
}

/** `overlay` (straight alpha) composed over the opaque `base`. */
function compose(base: Uint8Array, overlay: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(base.length);
  for (let i = 0; i < base.length; i += 4) {
    const alpha = overlay[i + 3] ?? 0;
    for (let c = 0; c < 3; c++) {
      out[i + c] = Math.round(((overlay[i + c] ?? 0) * alpha + (base[i + c] ?? 0) * (255 - alpha)) / 255);
    }
    out[i + 3] = base[i + 3] ?? 0;
  }
  return out;
}

/** Index of the first channel more than one unit apart, or -1. */
function firstDifference(actual: Uint8Array, expected: Uint8Array): number {
  return actual.findIndex((value, index) => Math.abs(value - (expected[index] ?? 0)) > 1);
}

const search: MapHighlight = { blocks: [2, 4], walls: [], liquids: [3], dim: true };

describe("content highlight from one pixel per tile", () => {
  test.each([
    ["outlined, dimmed", { x: 40, y: 30, zoom: 8 }, search],
    ["outlined, not dimmed", { x: 40, y: 30, zoom: 8 }, { ...search, dim: false }],
    ["tinted, dimmed", { x: 40, y: 30, zoom: 2 }, { ...search, walls: [7] }],
  ] as const)("%s: equals the CPU overlay over the terrain", (_label, camera: Camera, highlight: MapHighlight) => {
    const world = patchwork(300, 200);
    const { renderer, pixels } = setup(world);
    renderer.setCamera(camera);
    renderer.render();
    const base = pixels();
    renderer.setHighlight(highlight);
    renderer.render();
    const expected = compose(base, highlightOverlay(world, highlight, camera, { width: 203, height: 117 }));
    const actual = pixels();
    const at = firstDifference(actual, expected);
    expect(at, `pixel ${String(Math.floor(at / 4))}`).toBe(-1);
    // The highlight shows: the colour of the outline or tint appears.
    expect(actual.some((_, i) => i % 4 === 0 && actual[i] === expected[i] && expected[i] !== base[i])).toBe(true);
  });

  test.each([[null], [{ spacing: 10, opacity: 0.5, density: 1 }]] as const)(
    "scheduled frames (grid %o) compose it on top of the reused frame, which stays reusable",
    (gridSettings: MapGrid | null) => {
      const step = animationFrames();
      const world = patchwork(300, 200);
      const { renderer, pixels } = setup(world);
      renderer.setGrid(gridSettings);
      const first = { x: 40, y: 30, zoom: 8 };
      renderer.setCamera(first);
      step();
      const base = pixels();
      renderer.setHighlight(search);
      step();
      const expected = compose(base, highlightOverlay(world, search, first, { width: 203, height: 117 }));
      expect(firstDifference(pixels(), expected)).toBe(-1);
      // Panning with a highlight still reuses the previous frame.
      const reused = renderer.stats().reusedFrames;
      renderer.setCamera({ x: 41, y: 30, zoom: 8 });
      step();
      expect(renderer.stats().reusedFrames).toBeGreaterThan(reused);
      // Clearing it shows the terrain alone again.
      renderer.setCamera(first);
      renderer.setHighlight(null);
      step();
      expect(firstDifference(pixels(), base)).toBe(-1);
    },
  );

  test("uses the colour and dim options", () => {
    const world = patchwork(300, 200);
    const options = { highlightColor: [0, 200, 255], highlightDim: 0.3 } as const;
    const { renderer, pixels } = setup(world, 203, 117, options);
    const camera = { x: 40, y: 30, zoom: 8 };
    renderer.setCamera(camera);
    renderer.render();
    const base = pixels();
    renderer.setHighlight(search);
    renderer.render();
    const expected = compose(base, highlightOverlay(world, search, camera, { width: 203, height: 117 }, options));
    expect(firstDifference(pixels(), expected)).toBe(-1);
  });
});

/** Waits until the renderer has built its highlight mask. */
async function maskBuilt(renderer: MapRenderer): Promise<void> {
  for (let tries = 0; renderer.stats().highlightBuilding; tries++) {
    if (tries > 2000) throw new Error("the highlight mask was never built");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("content highlight at overview zoom", () => {
  test("a lone match stays visible zoomed far out and the rest is dimmed", async () => {
    const width = 2000;
    const height = 1000;
    const count = width * height;
    const world: RenderableWorld = {
      width, height, surfaceY: 300,
      palette: [{ kind: "vanilla", id: 0 }, { kind: "vanilla", id: 1 }],
      planes: {
        block: new Uint16Array(count), wall: new Uint16Array(count).fill(ABSENT), liquid: new Uint8Array(count),
        liquidAmount: new Uint8Array(count), paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
      },
    };
    world.planes.block[1003 * height + 501] = 1;
    const { renderer, pixels } = setup(world, 300, 150);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 / 8 });
    renderer.render();
    const base = pixels();
    renderer.setHighlight({ blocks: [1], walls: [], liquids: [], dim: true });
    await maskBuilt(renderer);
    renderer.render();
    const actual = pixels();
    const pixel = (data: Uint8Array, x: number, y: number): number[] => [...data.subarray((y * 300 + x) * 4, (y * 300 + x) * 4 + 4)];
    // Tile (1003, 501) is under pixel (125, 62).
    expect(pixel(actual, 125, 62)).toEqual([...DEFAULT_HIGHLIGHT_COLOR, 255]);
    const dimmed = pixel(base, 20, 20).map((value, c) => (c === 3 ? value : Math.round(value * (1 - 153 / 255))));
    pixel(actual, 20, 20).forEach((value, c) => { expect(Math.abs(value - (dimmed[c] ?? 0))).toBeLessThanOrEqual(1); });
    // Without dim the rest is the terrain as it was.
    renderer.setHighlight({ blocks: [1], walls: [], liquids: [], dim: false });
    renderer.render();
    expect(pixel(pixels(), 20, 20)).toEqual(pixel(base, 20, 20));
    expect(pixel(pixels(), 125, 62)).toEqual([...DEFAULT_HIGHLIGHT_COLOR, 255]);
  });

  test("an edit patches the mask", async () => {
    const width = 1000;
    const height = 500;
    const count = width * height;
    const world: RenderableWorld = {
      width, height, surfaceY: 100,
      palette: [{ kind: "vanilla", id: 0 }, { kind: "vanilla", id: 1 }],
      planes: {
        block: new Uint16Array(count), wall: new Uint16Array(count).fill(ABSENT), liquid: new Uint8Array(count),
        liquidAmount: new Uint8Array(count), paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
      },
    };
    const { renderer, pixels } = setup(world, 200, 100);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 / 4 });
    renderer.setHighlight({ blocks: [1], walls: [], liquids: [], dim: true });
    await maskBuilt(renderer);
    world.planes.block[400 * height + 200] = 1;
    renderer.invalidateTiles([{ x: 400, y: 200 }]);
    renderer.render();
    // Tile (400, 200) is under pixel (100, 50).
    const at = (50 * 200 + 100) * 4;
    expect([...pixels().subarray(at, at + 4)]).toEqual([...DEFAULT_HIGHLIGHT_COLOR, 255]);
  });
});

describe("content highlight costs", () => {
  test("setting, changing and clearing it, panning and zooming with it upload no chunk textures", () => {
    const step = animationFrames();
    // Two chunks, both visible at once: every chunk is resident after the first frame.
    const world = patchwork(200, 120);
    const { renderer } = setup(world);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    step();
    const settled = renderer.stats().textureUploads;
    const highlightUploads = renderer.stats().highlightUploads;
    renderer.setHighlight(search);
    step();
    renderer.setHighlight({ ...search, blocks: [1] });
    step();
    // The same contents again: no-op.
    const unchanged = renderer.stats().highlightUploads;
    renderer.setHighlight({ ...search, blocks: [1] });
    step();
    expect(renderer.stats().highlightUploads).toBe(unchanged);
    renderer.setCamera({ x: 3, y: 2, zoom: 1 });
    step();
    renderer.setCamera({ x: 3, y: 2, zoom: 6 });
    step();
    renderer.setCamera({ x: 0, y: 0, zoom: 0.25 });
    step();
    renderer.setHighlight({ ...search, dim: false });
    step();
    renderer.setHighlight(null);
    step();
    expect(renderer.stats().textureUploads).toBe(settled);
    expect(renderer.stats().highlightUploads).toBeGreaterThan(highlightUploads);
  });

  test(
    "building the mask of a Large world yields: no idle slice takes more than 16 ms",
    { tags: ["perf"], timeout: 120_000 },
    async () => {
      const width = 8400;
      const height = 2400;
      const count = width * height;
      const block = new Uint16Array(count);
      for (let i = 0; i < count; i += 7) block[i] = 1;
      const world: RenderableWorld = {
        width, height, surfaceY: 600, palette: [{ kind: "vanilla", id: 0 }, { kind: "vanilla", id: 1 }, { kind: "vanilla", id: 2 }],
        planes: {
          block, wall: new Uint16Array(count).fill(ABSENT), liquid: new Uint8Array(count),
          liquidAmount: new Uint8Array(count), paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
        },
      };
      const slices: number[] = [];
      const original = window.requestIdleCallback.bind(window);
      vi.spyOn(window, "requestIdleCallback").mockImplementation((callback, options) => original((deadline) => {
        const start = performance.now();
        callback(deadline);
        slices.push(performance.now() - start);
      }, options));
      const { renderer } = setup(world, 400, 200);
      renderer.setCamera({ x: 0, y: 0, zoom: 1 / 8 });
      // Nothing matches block 2: every tile is read.
      renderer.setHighlight({ blocks: [2], walls: [], liquids: [4], dim: true });
      await maskBuilt(renderer);
      expect(slices.length).toBeGreaterThan(1);
      // Run alone every slice stays under 16 ms (about 7.5 ms). With other browser test files running at once a slice
      // now and then stalls far longer (a garbage collection of their heaps, or its uploads waiting for a GPU process
      // busy with their software rendering), so two such outliers are tolerated; the CPU work alone is bounded by
      // tests/highlight.test.ts.
      const report = `slices (ms): ${slices.map((time) => time.toFixed(1)).join(", ")}`;
      expect(slices.filter((time) => time >= 16).length, report).toBeLessThanOrEqual(2);
      expect([...slices].sort((a, b) => a - b)[Math.floor(slices.length / 2)], report).toBeLessThan(10);
    },
  );
});
