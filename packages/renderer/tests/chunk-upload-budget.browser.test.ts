import { afterEach, describe, expect, test, vi } from "vitest";
import { createMapRenderer, fitWorld, visibleChunks } from "../src/index.js";
import type { MapRenderer, MapRendererOptions, RenderableWorld } from "../src/index.js";

const renderers: MapRenderer[] = [];
afterEach(() => {
  for (const renderer of renderers.splice(0)) renderer.dispose();
  vi.restoreAllMocks();
});

/** Synthetic dirt above stone, with no walls or liquids; column-major CWM planes. */
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

function setup(width: number, height: number, options?: MapRendererOptions) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = createMapRenderer(canvas, options);
  renderers.push(renderer);
  const gl = canvas.getContext("webgl2");
  if (gl === null) throw new Error("WebGL2 unavailable");
  const pixels = (): Uint8Array => {
    const bytes = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    return bytes;
  };
  return { canvas, renderer, gl, pixels };
}

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
      expect(pending.size).toBe(1);
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(0);
    },
  };
}

describe("scheduled chunk upload budget", () => {
  const large = terrain(8400, 2400);
  const viewport = { width: 1050, height: 300 };
  const camera = fitWorld(viewport, large);
  const visible = visibleChunks(camera, viewport, large);

  test.each([32, 127])("each fitted Large-world frame uploads at most %i chunks", (budget) => {
    const frames = animationFrames();
    const { renderer } = setup(viewport.width, viewport.height, { maxChunkUploadsPerFrame: budget });
    renderer.setWorld(large);
    // Upload palette/background without any visible chunk: textureUploads retains its existing meaning.
    renderer.setCamera({ x: large.width + 128, y: large.height + 128, zoom: 1 });
    renderer.render();
    expect(renderer.stats().residentChunks).toBe(0);
    renderer.setCamera(camera);
    let previousUploads = renderer.stats().textureUploads;
    for (let frame = 0; frame < visible.length && frames.pending.size > 0; frame++) {
      frames.step();
      const stats = renderer.stats();
      expect(stats.textureUploads - previousUploads).toBeLessThanOrEqual(budget);
      expect(stats.textureUploads - previousUploads).toBeGreaterThan(0);
      // The fitted world is drawn through the overview: one draw call however many chunks it shows.
      expect(stats.drawCalls).toBe(1);
      previousUploads = stats.textureUploads;
    }
    expect(renderer.stats().visibleChunks).toEqual(visible);
    expect(frames.pending.size).toBe(0);
  }, 60_000);

  test("the default budget draws a Large world over several frames", () => {
    const frames = animationFrames();
    const { renderer } = setup(viewport.width, viewport.height);
    renderer.setWorld(large);
    renderer.setCamera(camera);
    frames.step();
    expect(renderer.stats().residentChunks).toBeGreaterThan(0);
    expect(renderer.stats().residentChunks).toBeLessThan(visible.length);
    expect(renderer.stats().drawCalls).toBe(1);
    expect(frames.pending.size).toBe(1);
  });

  /** A clock that advances `step` milliseconds every time it is read. */
  function clock(step: number): void {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += step));
  }

  /** Uploads of the first scheduled frame of the fitted Large world. */
  function firstFrameUploads(options?: MapRendererOptions): number {
    const frames = animationFrames();
    const { renderer } = setup(viewport.width, viewport.height, options);
    renderer.setWorld(large);
    // Palette and background first, with no chunk on screen.
    renderer.setCamera({ x: large.width + 128, y: large.height + 128, zoom: 1 });
    renderer.render();
    const before = renderer.stats().textureUploads;
    renderer.setCamera(camera);
    frames.step();
    return renderer.stats().textureUploads - before;
  }

  test("a fast machine uploads more than 32 chunks per frame, up to the count cap", () => {
    clock(0);
    expect(firstFrameUploads()).toBeGreaterThan(32);
    expect(firstFrameUploads({ maxChunkUploadsPerFrame: 40 })).toBe(40);
  });

  test("a slow machine stops uploading once the frame's time budget is spent, but always uploads one chunk", () => {
    // Every clock read costs 5 ms: the default 8 ms budget allows the first upload and the one that crosses it.
    clock(5);
    const uploads = firstFrameUploads();
    expect(uploads).toBeGreaterThanOrEqual(1);
    expect(uploads).toBeLessThanOrEqual(3);
    clock(1000);
    expect(firstFrameUploads({ maxUploadMillisecondsPerFrame: 8 })).toBe(1);
    // A larger budget allows more.
    clock(5);
    expect(firstFrameUploads({ maxUploadMillisecondsPerFrame: 50 })).toBeGreaterThan(uploads);
  });

  test("continuations complete the Large world with synchronous pixels and then stop scheduling", () => {
    const frames = animationFrames();
    const { renderer, pixels } = setup(viewport.width, viewport.height, { maxChunkUploadsPerFrame: 127 });
    renderer.setWorld(large);
    renderer.setCamera(camera);
    let count = 0;
    while (frames.pending.size > 0 && count < visible.length) {
      frames.step();
      count++;
    }
    expect(frames.pending.size).toBe(0);
    expect(renderer.stats().visibleChunks).toEqual(visible);
    expect(renderer.stats().drawCalls).toBe(1);
    const incremental = pixels();
    const reference = setup(viewport.width, viewport.height, { maxChunkUploadsPerFrame: 1 });
    reference.renderer.setWorld(large);
    reference.renderer.setCamera(camera);
    reference.renderer.render();
    expect(incremental).toEqual(reference.pixels());
    expect(count).toBeGreaterThan(1);
    // The reference setters queued a frame; disposal removes it without affecting the completed renderer.
    reference.renderer.dispose();
    expect(frames.pending.size).toBe(0);
  }, 60_000);

  test("scheduled frames stop with a complete map when visible chunks exceed cache capacity", () => {
    const frames = animationFrames();
    const world = terrain(384, 256);
    const smallViewport = { width: 384, height: 256 };
    const fittedCamera = fitWorld(smallViewport, world);
    const expectedChunks = visibleChunks(fittedCamera, smallViewport, world);
    const options = { maxCachedChunks: 4, maxChunkUploadsPerFrame: 1 };
    const { renderer, pixels } = setup(smallViewport.width, smallViewport.height, options);
    expect(expectedChunks).toHaveLength(6);
    renderer.setWorld(world);
    renderer.setCamera(fittedCamera);
    let previousUploads = 0;
    for (let frame = 0; frame < expectedChunks.length * 2 && frames.pending.size > 0; frame++) {
      frames.step();
      // The first frame also uploads the palette and background.
      expect(renderer.stats().textureUploads - previousUploads).toBeLessThanOrEqual(frame === 0 ? 3 : 1);
      previousUploads = renderer.stats().textureUploads;
    }
    expect(frames.pending.size).toBe(0);
    expect(renderer.stats().visibleChunks).toEqual(expectedChunks);
    expect(renderer.stats().drawCalls).toBe(1); // One instanced draw call for the chunk page.
    expect(renderer.stats().residentChunks).toBe(expectedChunks.length);
    const scheduledPixels = pixels();
    const reference = setup(smallViewport.width, smallViewport.height, options);
    reference.renderer.setWorld(world);
    reference.renderer.setCamera(fittedCamera);
    reference.renderer.render();
    expect(scheduledPixels).toEqual(reference.pixels());
    reference.renderer.dispose();
    expect(frames.pending.size).toBe(0);
  });

  test("a fitted modded world keeps bounded uploads, a bounded cache and no re-uploads across repeated zoom changes", () => {
    const frames = animationFrames();
    const world = terrain(10000, 3000);
    const moddedViewport = { width: 1250, height: 375 };
    const fittedCamera = fitWorld(moddedViewport, world);
    const expectedChunks = visibleChunks(fittedCamera, moddedViewport, world);
    const budget = 127;
    const { renderer } = setup(moddedViewport.width, moddedViewport.height, { maxChunkUploadsPerFrame: budget });
    expect(expectedChunks.length).toBeGreaterThan(1536);
    renderer.setWorld(world);
    renderer.setCamera(fittedCamera);
    let previousUploads = 0;
    for (let frame = 0; frame < expectedChunks.length && frames.pending.size > 0; frame++) {
      frames.step();
      expect(renderer.stats().textureUploads - previousUploads).toBeLessThanOrEqual(frame === 0 ? budget + 2 : budget);
      previousUploads = renderer.stats().textureUploads;
    }
    expect(frames.pending.size).toBe(0);
    expect(renderer.stats().visibleChunks).toEqual(expectedChunks);
    // The fitted world is drawn from the overview: its chunks were needed only to build it.
    expect(renderer.stats().textureUploads).toBe(expectedChunks.length + 2);
    expect(renderer.stats().residentChunks).toBeLessThanOrEqual(512);
    const zoomedIn = { x: 0, y: 0, zoom: 1 };
    const deleted = vi.spyOn(WebGL2RenderingContext.prototype, "deleteTexture");
    let afterFirstCycle = 0;
    for (let cycle = 0; cycle < 3; cycle++) {
      renderer.setCamera(zoomedIn);
      for (let frame = 0; frame < 10 && frames.pending.size > 0; frame++) frames.step();
      expect(renderer.stats().visibleChunks).toEqual(visibleChunks(zoomedIn, moddedViewport, world));
      const beforeFit = renderer.stats().textureUploads;
      renderer.setCamera(fittedCamera);
      frames.step();
      // The overview persists: zooming back out uploads nothing.
      expect(renderer.stats().textureUploads).toBe(beforeFit);
      expect(renderer.stats().visibleChunks).toEqual(expectedChunks);
      expect(renderer.stats().residentChunks).toBeLessThanOrEqual(512);
      expect(frames.pending.size).toBe(0);
      // Only the first zoom-in uploads; the zoomed-in chunks then stay cached.
      if (cycle === 0) afterFirstCycle = beforeFit;
      else expect(beforeFit).toBe(afterFirstCycle);
    }
    expect(deleted).not.toHaveBeenCalled();
  }, 60_000);

  test.each([false, true])("changing worlds resets the grown cache capacity (clear first: %s)", (clearFirst) => {
    const frames = animationFrames();
    const { renderer } = setup(384, 256, { maxCachedChunks: 2, maxChunkUploadsPerFrame: 1 });
    renderer.setWorld(terrain(384, 256));
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    expect(renderer.stats().residentChunks).toBe(6);
    if (clearFirst) renderer.setWorld(null);
    const nextWorld = terrain(1280, 128);
    renderer.setWorld(nextWorld);
    expect(renderer.stats().residentChunks).toBe(0);
    renderer.render();
    expect(renderer.stats().residentChunks).toBe(3);
    renderer.setCamera({ x: 384, y: 0, zoom: 1 });
    for (let frame = 0; frame < 3 && frames.pending.size > 0; frame++) frames.step();
    expect(renderer.stats().residentChunks).toBe(3);
    expect(frames.pending.size).toBe(0);
  });

  test("panning a full cache preserves overlapping visible chunks while uploads complete", () => {
    const frames = animationFrames();
    const world = terrain(1280, 128);
    const { renderer } = setup(384, 128, { maxCachedChunks: 2, maxChunkUploadsPerFrame: 1 });
    renderer.setWorld(world);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    for (let frame = 0; frame < 3 && frames.pending.size > 0; frame++) frames.step();
    expect(renderer.stats().residentChunks).toBe(3);
    const uploads = renderer.stats().textureUploads;
    const nextCamera = { x: 256, y: 0, zoom: 1 };
    renderer.setCamera(nextCamera);
    for (let frame = 0; frame < 3 && frames.pending.size > 0; frame++) frames.step();
    expect(frames.pending.size).toBe(0);
    expect(renderer.stats().textureUploads - uploads).toBe(2);
    expect(renderer.stats().residentChunks).toBe(3);
    expect(renderer.stats().visibleChunks).toEqual(visibleChunks(nextCamera, { width: 384, height: 128 }, world));
  });

  test("synchronous render ignores the scheduled budget and uploads every visible chunk in one call", () => {
    animationFrames();
    const { renderer } = setup(viewport.width, viewport.height, { maxChunkUploadsPerFrame: 1 });
    renderer.setWorld(large);
    renderer.setCamera(camera);
    renderer.render();
    // Drawn from the overview: every chunk uploaded once, and the cache keeps only its baseline.
    expect(renderer.stats().residentChunks).toBeLessThanOrEqual(512);
    expect(renderer.stats().textureUploads).toBe(visible.length + 2);
    expect(renderer.stats().visibleChunks).toEqual(visible);
    expect(renderer.stats().drawCalls).toBe(1);
  });

  test("returning mid-load keeps earlier terrain when this frame's upload fits in spare cache space", () => {
    const frames = animationFrames();
    const { renderer, pixels } = setup(384, 128, { maxCachedChunks: 4, maxChunkUploadsPerFrame: 1 });
    renderer.setWorld(terrain(1280, 128));
    const initialCamera = { x: 0, y: 0, zoom: 1 };
    renderer.setCamera(initialCamera);
    renderer.render();
    const initialPixels = pixels();
    const uploads = renderer.stats().textureUploads;
    const deleted = vi.spyOn(WebGL2RenderingContext.prototype, "deleteTexture");
    renderer.setCamera({ x: 512, y: 0, zoom: 1 });
    frames.step();
    expect(renderer.stats().textureUploads - uploads).toBe(1);
    expect(deleted).not.toHaveBeenCalled();
    expect(frames.pending.size).toBe(1);
    renderer.setCamera(initialCamera);
    frames.step();
    expect(renderer.stats().textureUploads - uploads).toBe(1);
    expect(renderer.stats().drawCalls).toBe(1);
    expect(pixels()).toEqual(initialPixels);
    expect(frames.pending.size).toBe(0);
  });

  test("reversing a pan mid-load replaces only chunks evicted for actual uploads", () => {
    const frames = animationFrames();
    const { renderer, pixels } = setup(384, 128, { maxCachedChunks: 3, maxChunkUploadsPerFrame: 1 });
    renderer.setWorld(terrain(1280, 128));
    const initialCamera = { x: 0, y: 0, zoom: 1 };
    renderer.setCamera(initialCamera);
    renderer.render();
    const initialPixels = pixels();
    const uploads = renderer.stats().textureUploads;
    const evicted = renderer.stats().evictedChunks;
    renderer.setCamera({ x: 640, y: 0, zoom: 1 });
    frames.step();
    expect(renderer.stats().textureUploads - uploads).toBe(1);
    expect(renderer.stats().evictedChunks - evicted).toBe(1); // Only the one chunk actually replaced.
    expect(frames.pending.size).toBe(1);
    const beforeReturn = renderer.stats().textureUploads;
    renderer.setCamera(initialCamera);
    frames.step();
    expect(renderer.stats().textureUploads - beforeReturn).toBe(1);
    expect(renderer.stats().drawCalls).toBe(1);
    expect(renderer.stats().residentChunks).toBe(3);
    expect(pixels()).toEqual(initialPixels);
    expect(frames.pending.size).toBe(0);
  });

  test("cached chunks stay drawn while pending chunks are clear and stats report actual draws", () => {
    const frames = animationFrames();
    const { renderer, pixels } = setup(384, 128, { maxChunkUploadsPerFrame: 1 });
    renderer.setWorld(terrain(384, 128));
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    frames.step();
    const first = renderer.stats();
    expect(first.visibleChunks).toHaveLength(1);
    expect(first.drawCalls).toBe(1);
    expect(first.residentChunks).toBe(1);
    const firstPixels = pixels();
    const assertPixels = (bytes: Uint8Array, drawn: typeof first.visibleChunks): void => {
      for (let x = 0; x < 384; x++) {
        const alpha = bytes[x * 4 + 3];
        if (drawn.some((chunk) => chunk.x === Math.floor(x / 128))) {
          expect(alpha).toBe(255);
        } else {
          expect([...bytes.subarray(x * 4, x * 4 + 4)]).toEqual([0, 0, 0, 0]);
        }
      }
    };
    assertPixels(firstPixels, first.visibleChunks);
    const uploads = first.textureUploads;
    frames.step();
    const second = renderer.stats();
    expect(second.textureUploads - uploads).toBe(1);
    expect(second.visibleChunks).toHaveLength(2);
    expect(second.visibleChunks).toEqual(expect.arrayContaining([...first.visibleChunks]));
    expect(second.drawCalls).toBe(1);
    const secondPixels = pixels();
    assertPixels(secondPixels, second.visibleChunks);
    for (const chunk of first.visibleChunks) {
      const start = chunk.x * 128 * 4;
      expect(secondPixels.subarray(start, start + 128 * 4)).toEqual(firstPixels.subarray(start, start + 128 * 4));
    }
    frames.step();
    expect(renderer.stats().drawCalls).toBe(1);
    expect(frames.pending.size).toBe(0);
  });

  test("panning with uploads pending uploads only chunks visible to the new camera", () => {
    const frames = animationFrames();
    const { renderer, pixels } = setup(384, 128, { maxChunkUploadsPerFrame: 1 });
    // Blocks vary along x with a period (7) that does not divide the chunk size, so every chunk's data differs.
    const base = terrain(1280, 128);
    const block = new Uint16Array(base.planes.block.length);
    for (let x = 0; x < 1280; x++) {
      for (let y = 0; y < 128; y++) block[x * 128 + y] = ((x % 7) + (y % 3)) % 2;
    }
    const world: RenderableWorld = { ...base, planes: { ...base.planes, block } };
    renderer.setWorld(world);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    frames.step();
    expect(frames.pending.size).toBe(1);
    const uploads = renderer.stats().textureUploads;
    const nextCamera = { x: 896, y: 0, zoom: 1 };
    renderer.setCamera(nextCamera);
    const nextVisible = visibleChunks(nextCamera, { width: 384, height: 128 }, world);
    let count = 0;
    while (frames.pending.size > 0 && count++ < nextVisible.length) frames.step();
    // None of the new chunks was resident: exactly they were uploaded, none of the chunks passed over.
    expect(renderer.stats().textureUploads - uploads).toBe(nextVisible.length);
    expect(renderer.stats().visibleChunks).toEqual(nextVisible);
    expect(renderer.stats().residentChunks).toBe(1 + nextVisible.length);
    expect(frames.pending.size).toBe(0);
    // Each new chunk's slot holds that chunk's own data: the map equals a fresh synchronous render.
    const reference = setup(384, 128);
    reference.renderer.setWorld(world);
    reference.renderer.setCamera(nextCamera);
    reference.renderer.render();
    expect(pixels()).toEqual(reference.pixels());
    reference.renderer.dispose();
  });
});
