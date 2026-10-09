import { afterEach, describe, expect, test, vi } from "vitest";
import { WIRE_ALPHA, WIRE_COLORS, WIRE_LAYER, contentColor, createMapRenderer, fitWorld, visibleChunks } from "../src/index.js";
import type { Camera, MapRenderer, MapRendererOptions, RenderableWorld } from "../src/index.js";

const renderers: MapRenderer[] = [];
afterEach(() => {
  for (const renderer of renderers.splice(0)) renderer.dispose();
  vi.restoreAllMocks();
});

const palette = [{ kind: "vanilla", id: 0 }, { kind: "vanilla", id: 1 }, { kind: "vanilla", id: 2 }] as const;
const [, blockA, blockB] = palette.map((ref) => contentColor(ref, "block"));

/** A world whose block at (x, y) is `pick(x, y)` (a palette index), with no walls, liquids or paint. */
function blocks(width: number, height: number, pick: (x: number, y: number) => number): RenderableWorld {
  const count = width * height;
  const block = new Uint16Array(count);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) block[x * height + y] = pick(x, y);
  }
  return {
    width, height, surfaceY: 0, palette,
    planes: {
      block, wall: new Uint16Array(count).fill(0xffff), liquid: new Uint8Array(count),
      liquidAmount: new Uint8Array(count), paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
    },
  };
}

function setup(width: number, height: number, options?: MapRendererOptions) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = createMapRenderer(canvas, options);
  renderers.push(renderer);
  const gl = canvas.getContext("webgl2");
  if (gl === null) throw new Error("WebGL2 unavailable");
  /** RGBA of the canvas pixel (x, y), top-down. */
  const pixel = (x: number, y: number): number[] => {
    const out = new Uint8Array(4);
    gl.readPixels(x, height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return [...out];
  };
  /** The whole canvas, bottom-up (readPixels order). */
  const all = (): Uint8Array => {
    const out = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  };
  return { renderer, gl, pixel, all };
}

function closeTo(actual: readonly number[], expected: readonly number[], tolerance: number): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, channel) => {
    expect(Math.abs(value - (expected[channel] ?? 0)), `channel ${String(channel)} of ${String(actual)} vs ${String(expected)}`)
      .toBeLessThanOrEqual(tolerance);
  });
}

const mean = (first: readonly number[], second: readonly number[]): number[] =>
  first.map((value, channel) => (value + (second[channel] ?? 0)) / 2);

/** Run only callbacks queued for this frame; continuations belong to the next frame. */
function animationFrames() {
  let nextId = 1;
  const pending = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextId++;
    pending.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { pending.delete(id); });
  return {
    pending,
    step: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(0);
    },
  };
}

describe("instanced chunk pass", () => {
  test("all visible resident chunks are drawn with one draw call per chunk page", () => {
    // 384 × 256 at one pixel per tile: six chunks on screen.
    const { renderer } = setup(384, 256);
    renderer.setWorld(blocks(384, 256, (x) => 1 + (x % 2)));
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    expect(renderer.stats().visibleChunks).toHaveLength(6);
    expect(renderer.stats().drawCalls).toBe(1);
  });

  test("a chunk upload issues one texture data call per present plane", () => {
    const { renderer, gl } = setup(384, 256);
    renderer.setWorld(blocks(384, 256, () => 1));
    // Palette and background upload first, with no chunk on screen.
    renderer.setCamera({ x: 1000, y: 1000, zoom: 1 });
    renderer.render();
    const calls = [vi.spyOn(gl, "texSubImage2D"), vi.spyOn(gl, "texSubImage3D")];
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    expect(renderer.stats().residentChunks).toBe(6);
    // Six planes: block, wall, liquid, liquid amount, paint, wall paint (no flags or frames).
    expect(calls.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBe(6 * 6);
  });

  test("evictions are counted in stats", () => {
    const { renderer } = setup(256, 128, { maxCachedChunks: 2 });
    renderer.setWorld(blocks(1280, 128, () => 1));
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    expect(renderer.stats().evictedChunks).toBe(0);
    renderer.setCamera({ x: 512, y: 0, zoom: 1 });
    renderer.render();
    expect(renderer.stats().evictedChunks).toBe(2);
    expect(renderer.stats().residentChunks).toBe(2);
  });
});

describe("overview below half a pixel per tile", () => {
  // 2048 × 1024: 16 × 8 chunks; left half block A, right half block B.
  const halves = blocks(2048, 1024, (x) => (x < 1024 ? 1 : 2));
  const checker = blocks(2048, 1024, (x, y) => 1 + ((x + y) % 2));
  const fitted: Camera = { x: 0, y: 0, zoom: 0.25 };

  test("draws the whole visible world with one draw call and reports every visible chunk", () => {
    const { renderer, pixel } = setup(512, 256);
    renderer.setWorld(halves);
    renderer.setCamera(fitted);
    renderer.render();
    expect(renderer.stats().drawCalls).toBe(1);
    expect(renderer.stats().visibleChunks).toEqual(visibleChunks(fitted, { width: 512, height: 256 }, halves));
    expect(pixel(64, 128)).toEqual(blockA);
    expect(pixel(448, 128)).toEqual(blockB);
  });

  test("averages the tiles under a pixel instead of picking one (no aliasing on a checkerboard)", () => {
    const { renderer, pixel } = setup(512, 256);
    renderer.setWorld(checker);
    renderer.setCamera(fitted);
    renderer.render();
    const expected = mean(blockA ?? [], blockB ?? []);
    for (const [x, y] of [[10, 10], [100, 37], [255, 128], [400, 200]] as const) closeTo(pixel(x, y), expected, 2);
    // A sub-tile camera move keeps the colour: nothing shimmers while panning.
    renderer.setCamera({ ...fitted, x: 0.5, y: 0.25 });
    renderer.render();
    closeTo(pixel(100, 37), expected, 2);
  });

  test("the chunk pass averages the tiles under a pixel below one pixel per tile and draws exact tiles from one", () => {
    const { renderer, pixel } = setup(512, 256);
    renderer.setWorld(checker);
    renderer.setCamera({ x: 0, y: 0, zoom: 0.5 });
    renderer.render();
    closeTo(pixel(100, 37), mean(blockA ?? [], blockB ?? []), 1);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    expect([blockA, blockB]).toContainEqual(pixel(100, 37));
  });

  test("layer toggles rebuild the overview from resident chunks without uploads", () => {
    const { renderer, pixel } = setup(512, 256);
    renderer.setWorld(halves);
    renderer.setCamera(fitted);
    renderer.render();
    const uploads = renderer.stats().textureUploads;
    renderer.setLayers({ background: false, walls: true, blocks: false, liquids: true });
    renderer.render();
    expect(pixel(64, 128)).toEqual([0, 0, 0, 0]);
    renderer.setLayers({ background: true, walls: true, blocks: true, liquids: true });
    renderer.render();
    expect(pixel(64, 128)).toEqual(blockA);
    expect(renderer.stats().textureUploads).toBe(uploads);
  });

  test("the overview draws the wire overlay and drops it when wires are hidden, from resident chunks", () => {
    // Every tile of the left half carries a red wire; the right half none.
    const flags = new Uint16Array(halves.width * halves.height);
    flags.fill(WIRE_LAYER.red, 0, (halves.width / 2) * halves.height);
    const wired: RenderableWorld = { ...halves, planes: { ...halves.planes, flags } };
    const { renderer, pixel } = setup(512, 256);
    renderer.setWorld(wired);
    renderer.setLayers({ background: true, walls: true, blocks: true, liquids: true, wires: WIRE_LAYER.all });
    renderer.setCamera(fitted);
    renderer.render();
    const uploads = renderer.stats().textureUploads;
    const red = WIRE_COLORS.find(([bit]) => bit === WIRE_LAYER.red)?.[1] ?? [0, 0, 0];
    // A uniform region's overview texel is the tile colour itself: block A with the red overlay blended in.
    const blended = [0, 1, 2].map((c) => Math.floor((2 * ((red[c] ?? 0) * WIRE_ALPHA + (blockA?.[c] ?? 0) * (255 - WIRE_ALPHA)) + 255) / 510));
    closeTo(pixel(64, 128), [...blended, 255], 1);
    expect(pixel(448, 128)).toEqual(blockB);
    renderer.setLayers({ background: true, walls: true, blocks: true, liquids: true, wires: WIRE_LAYER.blue });
    renderer.render();
    expect(pixel(64, 128)).toEqual(blockA);
    expect(renderer.stats().textureUploads).toBe(uploads);
  });

  test("the pixels of a view do not depend on which chunks were visited before (mipmaps sample built neighbours)", () => {
    const uniform = blocks(512, 128, () => 1);
    const view: Camera = { x: 128, y: 0, zoom: 0.3 };
    const fresh = setup(32, 32);
    fresh.renderer.setWorld(uniform);
    fresh.renderer.setCamera(view);
    fresh.renderer.render();
    const visited = setup(32, 32);
    visited.renderer.setWorld(uniform);
    visited.renderer.setCamera({ x: 0, y: 0, zoom: 0.3 });
    visited.renderer.render();
    visited.renderer.setCamera(view);
    visited.renderer.render();
    for (const [x, y] of [[0, 0], [0, 16], [31, 31]] as const) {
      expect(fresh.pixel(x, y)).toEqual(blockA);
      expect(fresh.pixel(x, y)).toEqual(visited.pixel(x, y));
    }
  });

  test("appending to an empty palette rebuilds the overview", () => {
    const growing: RenderableWorld = { ...blocks(256, 128, () => 0), palette: [] };
    const { renderer, pixel } = setup(64, 32);
    renderer.setWorld(growing);
    renderer.setCamera({ x: 0, y: 0, zoom: 0.25 });
    renderer.render();
    (growing.palette as unknown[]).push(...palette);
    renderer.setWorld(growing);
    renderer.render();
    expect(pixel(10, 10)).toEqual(contentColor(palette[0], "block"));
  });

  test("zoomed-out views do not grow the chunk cache, and reused cache slots build each chunk from its own data", () => {
    // Every chunk is uniform, coloured by (x + 2y) % 3 so that horizontal and vertical neighbours differ.
    const colorIndex = (chunkX: number, chunkY: number): number => (chunkX + 2 * chunkY) % 3;
    const large = blocks(8400, 2400, (x, y) => colorIndex(Math.floor(x / 128), Math.floor(y / 128)));
    const viewport = { width: 1050, height: 300 };
    const camera = fitWorld(viewport, large);
    expect(camera).toEqual({ x: 0, y: 0, zoom: 0.125 });
    const visible = visibleChunks(camera, viewport, large);
    // A small cache forces many build batches, each reusing the slots of the previous one.
    const { renderer, all } = setup(viewport.width, viewport.height, { maxCachedChunks: 64 });
    renderer.setWorld(large);
    renderer.setCamera(camera);
    renderer.render();
    expect(renderer.stats().visibleChunks).toEqual(visible);
    expect(renderer.stats().textureUploads).toBe(visible.length + 2);
    expect(renderer.stats().residentChunks).toBeLessThanOrEqual(64);
    expect(renderer.stats().evictedChunks).toBeGreaterThan(visible.length - 128);
    expect(renderer.stats().drawCalls).toBe(1);
    const pixels = all();
    for (const chunk of visible) {
      // The chunk's centre: 16 pixels per chunk at 1/8 pixel per tile; readPixels rows are bottom-up.
      const x = chunk.x * 16 + 8;
      const y = viewport.height - 1 - (chunk.y * 16 + 8);
      const expected = contentColor(palette[colorIndex(chunk.x, chunk.y)] ?? palette[0], "block");
      expect([...pixels.subarray((y * viewport.width + x) * 4, (y * viewport.width + x) * 4 + 4)], `chunk ${String(chunk.x)},${String(chunk.y)}`)
        .toEqual(expected);
    }
  }, 60_000);

  test("chunks still loading after zooming in show the overview instead of a hole, then the exact chunks", () => {
    // The zoomed-in area is a checkerboard: the overview (a mean) differs from every exact pixel.
    const mixed = blocks(2048, 1024, (x, y) => (x < 1024 ? 1 + ((x + y) % 2) : 2));
    const frames = animationFrames();
    const { renderer, pixel, all } = setup(512, 256, { maxCachedChunks: 4, maxChunkUploadsPerFrame: 1 });
    renderer.setWorld(mixed);
    renderer.setCamera(fitted);
    renderer.render();
    expect(renderer.stats().residentChunks).toBeLessThanOrEqual(4);
    const zoomedIn: Camera = { x: 0, y: 0, zoom: 1 };
    const inView = visibleChunks(zoomedIn, { width: 512, height: 256 }, mixed);
    renderer.setCamera(zoomedIn);
    frames.step();
    const drawn = renderer.stats().visibleChunks;
    const loading = inView.find((chunk) => !drawn.some((other) => other.x === chunk.x && other.y === chunk.y));
    if (loading === undefined) throw new Error("expected a chunk still loading");
    closeTo(pixel(loading.x * 128 + 64, loading.y * 128 + 64), mean(blockA ?? [], blockB ?? []), 2);
    for (let frame = 0; frame < inView.length && frames.pending.size > 0; frame++) frames.step();
    expect(frames.pending.size).toBe(0);
    expect(renderer.stats().visibleChunks).toEqual(inView);
    // A complete frame is exact: no overview left over any chunk.
    const reference = setup(512, 256);
    reference.renderer.setWorld(mixed);
    reference.renderer.setCamera(zoomedIn);
    reference.renderer.render();
    // Counted rather than compared with toEqual: a diff of two 512 × 256 canvases takes minutes to print.
    const actual = all();
    const expected = reference.all();
    let differing = 0;
    for (let index = 0; index < actual.length; index += 4) {
      if (actual.subarray(index, index + 4).some((value, channel) => value !== expected[index + channel])) differing++;
    }
    expect(differing).toBe(0);
  });

  test("a layer change sweeps out from the centre of the view: no blank, no chunk ahead of the front, within budget", { tags: ["perf"] }, () => {
    // 128 uniform chunks in two colours, all visible, in a cache of 16: the rebuild re-uploads evicted chunks.
    const colorIndex = (chunkX: number, chunkY: number): number => 1 + ((chunkX + chunkY) % 2);
    const world = blocks(2048, 1024, (x, y) => colorIndex(Math.floor(x / 128), Math.floor(y / 128)));
    const budget = 4;
    const cache = 16;
    const frames = animationFrames();
    const { renderer, pixel, all } = setup(512, 256, { maxCachedChunks: cache, maxChunkUploadsPerFrame: budget });
    renderer.setWorld(world);
    renderer.setCamera(fitted);
    renderer.render();
    const visible = visibleChunks(fitted, { width: 512, height: 256 }, world);
    const centres = visible.map((chunk) => [chunk.x * 32 + 16, chunk.y * 32 + 16] as const);
    // Distance of each chunk's centre from the centre of the view, in tiles.
    const distance = visible.map((chunk) => Math.hypot(chunk.x * 128 + 64 - 1024, chunk.y * 128 + 64 - 512));
    const before = centres.map(([x, y]) => pixel(x, y));
    // Blocks off: the background (underground, surfaceY 0) shows everywhere.
    const hidden = { background: true, walls: true, blocks: false, liquids: true };
    const reference = setup(512, 256);
    reference.renderer.setWorld(world);
    reference.renderer.setLayers(hidden);
    reference.renderer.setCamera(fitted);
    reference.renderer.render();
    const after = centres.map(([x, y]) => reference.pixel(x, y));

    renderer.setLayers(hidden);
    let uploads = renderer.stats().textureUploads;
    const near = (actual: readonly number[], expected: readonly number[] | undefined): boolean =>
      expected !== undefined && actual.every((value, channel) => Math.abs(value - (expected[channel] ?? 0)) <= 2);
    let rebuildFrames = 0;
    let partialFrames = 0;
    for (; frames.pending.size > 0 && rebuildFrames < 200; rebuildFrames++) {
      frames.step();
      const stats = renderer.stats();
      expect(stats.textureUploads - uploads).toBeLessThanOrEqual(budget);
      expect(stats.residentChunks).toBeLessThanOrEqual(cache);
      uploads = stats.textureUploads;
      const updated = centres.map(([x, y], index) => {
        const actual = pixel(x, y);
        // Never blank: every chunk shows its old or its new colour.
        expect(near(actual, before[index]) || near(actual, after[index]), `frame ${String(rebuildFrames)}, chunk ${String(index)}: ${String(actual)}`)
          .toBe(true);
        return near(actual, after[index]);
      });
      // The new view grows as one front from the centre: no chunk (cached or not) is updated ahead of a nearer one.
      const front = Math.max(...distance.filter((_, index) => updated[index]));
      const behind = distance.findIndex((d, index) => d < front - 1 && updated[index] !== true);
      expect(behind, `frame ${String(rebuildFrames)}: chunk ${String(behind)} is behind the front`).toBe(-1);
      if (updated.includes(true) && updated.includes(false)) partialFrames++;
    }
    // The sweep re-uploaded evicted chunks over several frames, visibly in progress, and finished.
    expect(rebuildFrames).toBeGreaterThan(1);
    expect(partialFrames).toBeGreaterThan(0);
    expect(frames.pending.size).toBe(0);
    const actual = all();
    const expected = reference.all();
    let differing = 0;
    for (let index = 0; index < actual.length; index++) if (actual[index] !== expected[index]) differing++;
    expect(differing).toBe(0);
  }, 60_000);

  test("tileAt is independent of the overview", () => {
    const { renderer } = setup(512, 256);
    renderer.setWorld(halves);
    renderer.setCamera(fitted);
    renderer.render();
    expect(renderer.tileAt(64, 128)).toEqual({ x: 256, y: 512 });
    expect(renderer.tileAt(511, 255)).toEqual({ x: 2044, y: 1020 });
  });
});

describe("crossing the overview threshold", () => {
  const checker = blocks(1024, 512, (x, y) => 1 + ((x + y) % 2));
  /** Deterministic noise: every tile one of the two blocks, by a hash of its position. */
  const noisy = blocks(1024, 512, (x, y) => 1 + ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 7) % 2);
  const below = 0.499;
  const samples = [[3, 3], [60, 30], [120, 60]] as const;

  /** The value of an integer uniform of the program the last frame used. */
  const uniform = (gl: WebGL2RenderingContext, name: string): unknown => {
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
    const location = gl.getUniformLocation(program, name);
    return location === null ? undefined : gl.getUniform(program, location);
  };

  test("a checkerboard pixel changes by at most 2 per channel between the overview and the chunk pass", () => {
    const { renderer, pixel } = setup(128, 64);
    renderer.setWorld(checker);
    renderer.setCamera({ x: 0, y: 0, zoom: below });
    renderer.render();
    const overview = samples.map(([x, y]) => pixel(x, y));
    renderer.setCamera({ x: 0, y: 0, zoom: 0.5 });
    renderer.render();
    samples.forEach(([x, y], index) => { closeTo(pixel(x, y), overview[index] ?? [], 2); });
  });

  test("a noisy world changes by a mean absolute difference of at most 2 between the overview and the chunk pass", () => {
    const { renderer, all } = setup(128, 64);
    renderer.setWorld(noisy);
    renderer.setCamera({ x: 0, y: 0, zoom: below });
    renderer.render();
    const overview = all();
    renderer.setCamera({ x: 0, y: 0, zoom: 0.5 });
    renderer.render();
    const chunkPass = all();
    let total = 0;
    for (let index = 0; index < overview.length; index++) total += Math.abs((overview[index] ?? 0) - (chunkPass[index] ?? 0));
    expect(total / overview.length).toBeLessThanOrEqual(2);
  });

  test("a sub-tile pan at 0.6 pixels per tile over a checkerboard does not shimmer", () => {
    const { renderer, all } = setup(128, 64);
    renderer.setWorld(checker);
    renderer.setCamera({ x: 10, y: 10, zoom: 0.6 });
    renderer.render();
    let previous = all();
    for (const step of [0.1, 0.25, 0.4, 0.5, 0.75, 1]) {
      renderer.setCamera({ x: 10 + step, y: 10 + step / 2, zoom: 0.6 });
      renderer.render();
      const current = all();
      let worst = 0;
      for (let index = 0; index < current.length; index++) {
        worst = Math.max(worst, Math.abs((current[index] ?? 0) - (previous[index] ?? 0)));
      }
      expect(worst, `pan to +${String(step)}`).toBeLessThanOrEqual(2);
      previous = current;
    }
  });

  test("the filtered band keeps one draw call per page and filters only below one pixel per tile", () => {
    const { renderer, gl } = setup(128, 64);
    renderer.setWorld(checker);
    for (const zoom of [0.5, 0.6, 0.99, 1, 2]) {
      renderer.setCamera({ x: 0, y: 0, zoom });
      renderer.render();
      expect(renderer.stats().drawCalls, `zoom ${String(zoom)}`).toBe(1);
      // The chunk pass reads one tile per pixel at one pixel per tile and above, the box filter only below.
      expect(uniform(gl, "uFilter"), `zoom ${String(zoom)}`).toBe(zoom < 1 ? 1 : 0);
    }
  });
});
