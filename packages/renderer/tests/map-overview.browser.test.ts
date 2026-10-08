import { afterEach, describe, expect, test, vi } from "vitest";
import { contentColor, createMapRenderer, visibleChunks } from "../src/index.js";
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
  return { renderer, gl, pixel };
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

  test("a chunk upload issues at most two texture data calls", () => {
    const { renderer, gl } = setup(384, 256);
    renderer.setWorld(blocks(384, 256, () => 1));
    // Palette and background upload first, with no chunk on screen.
    renderer.setCamera({ x: 1000, y: 1000, zoom: 1 });
    renderer.render();
    const calls = [vi.spyOn(gl, "texSubImage2D"), vi.spyOn(gl, "texSubImage3D")];
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    expect(renderer.stats().residentChunks).toBe(6);
    expect(calls.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBeLessThanOrEqual(6 * 2);
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

  test("at half a pixel per tile and above the chunk pass draws exact tile colours", () => {
    const { renderer, pixel } = setup(512, 256);
    renderer.setWorld(checker);
    renderer.setCamera({ x: 0, y: 0, zoom: 0.5 });
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

  test("tileAt is independent of the overview", () => {
    const { renderer } = setup(512, 256);
    renderer.setWorld(halves);
    renderer.setCamera(fitted);
    renderer.render();
    expect(renderer.tileAt(64, 128)).toEqual({ x: 256, y: 512 });
    expect(renderer.tileAt(511, 255)).toEqual({ x: 2044, y: 1020 });
  });
});
