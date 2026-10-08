import { describe, expect, test } from "vitest";
import { filterTiles } from "../index.js";
import type { ChunkPixels } from "../index.js";

/** A tile image (one pixel per tile) whose tile (x, y) is `pick(x, y)`. */
function image(width: number, height: number, pick: (x: number, y: number) => readonly number[]): ChunkPixels {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels.set(pick(x, y), (y * width + x) * 4);
  }
  return { width, height, pixels };
}

function pixel(pixels: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  return [...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
}

const red = [200, 40, 20, 255] as const;
const blue = [20, 60, 220, 255] as const;

describe("filterTiles: the box filter of the chunk pass below one pixel per tile", () => {
  test("only zoom levels below one pixel per tile are filtered", () => {
    const tiles = image(4, 4, () => red);
    expect(() => filterTiles(tiles, { x: 0, y: 0, zoom: 1 }, { width: 2, height: 2 })).toThrow(RangeError);
    expect(() => filterTiles(tiles, { x: 0, y: 0, zoom: 0 }, { width: 2, height: 2 })).toThrow(RangeError);
  });

  test("a uniform world stays uniform, also where the footprint leaves the world", () => {
    const tiles = image(10, 6, () => red);
    const out = filterTiles(tiles, { x: -0.75, y: 0.5, zoom: 1 / 1.75 }, { width: 8, height: 4 });
    // Pixel 0 covers tiles -0.75…1: its centre is in the world, and only in-world tiles count.
    expect(pixel(out, 8, 0, 0)).toEqual([...red]);
    expect(pixel(out, 8, 5, 2)).toEqual([...red]);
  });

  test("a pixel whose centre is outside the world is transparent", () => {
    const tiles = image(4, 4, () => red);
    const out = filterTiles(tiles, { x: -2, y: 0, zoom: 0.5 }, { width: 4, height: 2 });
    expect(pixel(out, 4, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(out, 4, 1, 0)).toEqual([...red]);
    // Tiles 4 and 5 of pixel 3 are past the right edge.
    expect(pixel(out, 4, 3, 0)).toEqual([0, 0, 0, 0]);
  });

  test("at half a pixel per tile a pixel is the premultiplied mean of its 2 × 2 tiles, like an overview texel", () => {
    const transparent = [0, 0, 0, 0] as const;
    const tiles = image(4, 2, (x, y) => (x === 0 && y === 0 ? transparent : x % 2 === 0 ? red : blue));
    const out = filterTiles(tiles, { x: 0, y: 0, zoom: 0.5 }, { width: 2, height: 1 });
    // Three opaque tiles: two blue, one red; alpha is the mean over all four.
    const mean = [0, 1, 2].map((c) => Math.round(((red[c] ?? 0) + 2 * (blue[c] ?? 0)) / 3));
    expect(pixel(out, 2, 0, 0)).toEqual([...mean, Math.round((3 * 255) / 4)]);
    const right = [0, 1, 2].map((c) => Math.round(((red[c] ?? 0) + (blue[c] ?? 0)) / 2));
    expect(pixel(out, 2, 1, 0)).toEqual([...right, 255]);
  });

  test("tiles are weighted by the area of the pixel footprint they cover", () => {
    // Columns 0–3 differ in red; 1.5 tiles per pixel from x = 0.25: pixel 1 covers 1.75…3.25.
    const levels = [0, 64, 128, 192];
    const tiles = image(4, 2, (x) => [levels[x] ?? 0, 0, 0, 255]);
    const out = filterTiles(tiles, { x: 0.25, y: 0, zoom: 1 / 1.5 }, { width: 2, height: 1 });
    expect(pixel(out, 2, 0, 0)[0]).toBe(Math.round((0.75 * 0 + 0.75 * 64) / 1.5));
    expect(pixel(out, 2, 1, 0)[0]).toBe(Math.round((0.25 * 64 + 1 * 128 + 0.25 * 192) / 1.5));
  });

  test("a checkerboard is drawn as the mean of its colours at half a pixel per tile, wherever the camera is", () => {
    const tiles = image(64, 64, (x, y) => ((x + y) % 2 === 0 ? red : blue));
    const mean = [0, 1, 2].map((c) => Math.round(((red[c] ?? 0) + (blue[c] ?? 0)) / 2));
    for (const offset of [0, 0.25, 0.5, 0.75]) {
      const out = filterTiles(tiles, { x: 3 + offset, y: 5 + offset / 2, zoom: 0.5 }, { width: 16, height: 16 });
      expect(pixel(out, 16, 7, 9)).toEqual([...mean, 255]);
    }
  });
});
