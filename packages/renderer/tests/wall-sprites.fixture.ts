// The CPU expectation of sprite mode's wall layer at 16 pixels per tile (one sprite pixel per canvas pixel), shared by
// the browser tests that read sprite-mode pixels back (docs/assets.md, "Walls" and "Atlas").
import { expect } from "vitest";
import type { CanonicalWorld } from "@studio/world-model";
import { MISSING_SPRITE_COLORS, NO_CELL, spriteSampling, type SpriteSheetEntry } from "../src/index.js";

// docs/assets.md, "Walls": a 32 × 32 cell with a 4-pixel gutter (stride 36), drawn centred on the 16 × 16 tile, so it
// reaches 8 pixels past the tile on every side. Written out here rather than imported, so the tests pin them.
const STRIDE = 36;
const OVERHANG = 8;

export type Rgba = readonly [number, number, number, number];

/** The shader's straight-alpha `over` in integers (shaders.ts). */
export function over(top: Rgba, below: Rgba): Rgba {
  if (top[3] === 0) return below;
  if (below[3] === 0 || top[3] === 255) return top;
  const a = top[3];
  if (below[3] === 255) {
    const mix = (k: number): number => Math.floor((2 * ((top[k] ?? 0) * a + (below[k] ?? 0) * (255 - a)) + 255) / 510);
    return [mix(0), mix(1), mix(2), 255];
  }
  const weight = below[3] * (255 - a);
  const alpha = a + Math.floor((weight + 127) / 255);
  const mix = (k: number): number =>
    Math.floor(((top[k] ?? 0) * a * 255 + (below[k] ?? 0) * weight + Math.floor((alpha * 255) / 2)) / (alpha * 255));
  return [mix(0), mix(1), mix(2), alpha];
}

/** Premultiplied RGBA in 0–1, as the shader composites walls. */
export type Premultiplied = readonly [number, number, number, number];

export function premultiply(color: Rgba): Premultiplied {
  const alpha = color[3] / 255;
  return [(color[0] / 255) * alpha, (color[1] / 255) * alpha, (color[2] / 255) * alpha, alpha];
}

/** `top` over `below`, premultiplied. */
export function onTop(top: Premultiplied, below: Premultiplied): Premultiplied {
  const keep = 1 - top[3];
  return [top[0] + below[0] * keep, top[1] + below[1] * keep, top[2] + below[2] * keep, top[3] + below[3] * keep];
}

/** Straight-alpha RGBA in 0–255, rounded. */
export function straight(color: Premultiplied): Rgba {
  const alpha = color[3];
  if (alpha <= 0) return [0, 0, 0, 0];
  return [Math.round((color[0] / alpha) * 255), Math.round((color[1] / alpha) * 255), Math.round((color[2] / alpha) * 255), Math.round(alpha * 255)];
}

/**
 * Pixels of `actual` that differ from `expected` by more than `tolerance` in any channel, described for a failure
 * message; walls composite in floats (wallSample in shaders.ts), within one unit of this reference.
 */
export function mismatches(actual: Uint8Array, expected: Uint8Array, width: number, tolerance = 1): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(actual.length, expected.length); i += 4) {
    const a = pixelAt(actual, i);
    const e = pixelAt(expected, i);
    if (a.some((value, k) => Math.abs(value - (e[k] ?? 0)) > tolerance)) {
      out.push(`(${String((i / 4) % width)}, ${String(Math.floor(i / 4 / width))}): ${a.join()} ≠ ${e.join()}`);
    }
  }
  return out;
}

/**
 * The straight-alpha mean of `colors` as the chunk pass takes it, in integers: colour weighted by alpha, both rounded
 * to nearest. A texel of the half-resolution atlas is this mean of its 2 × 2 sprite pixels.
 */
export function meanOf(colors: readonly Rgba[]): Rgba {
  let alpha = 0;
  const sum = [0, 0, 0];
  for (const color of colors) {
    for (let k = 0; k < 3; k++) sum[k] = (sum[k] ?? 0) + (color[k] ?? 0) * color[3];
    alpha += color[3];
  }
  if (alpha === 0) return [0, 0, 0, 0];
  const mean = (value: number): number => Math.floor((2 * value + alpha) / (2 * alpha));
  return [mean(sum[0] ?? 0), mean(sum[1] ?? 0), mean(sum[2] ?? 0), Math.floor((2 * alpha + colors.length) / (2 * colors.length))];
}

/** The half-resolution atlas texel holding sheet pixel (x, y) of a sheet at an even atlas position: the mean of its 2 × 2. */
export function halfTexel(pixel: (x: number, y: number) => Rgba, x: number, y: number): Rgba {
  const left = x - (x & 1);
  const top = y - (y & 1);
  return meanOf([pixel(left, top), pixel(left + 1, top), pixel(left, top + 1), pixel(left + 1, top + 1)]);
}

/**
 * The sprite pixels a screen pixel samples at `zoom` pixels per tile (spriteSampling), its centre at sprite position
 * (cx, cy) of its tile (0–16 per axis): samples × samples positions spread over the footprint, kept inside the tile,
 * each passed to `read` with the sampling level. At level 1 a position stands for the 2 × 2 block of sprite pixels it
 * lies in, passed as the block's even top-left.
 */
export function samplePositions(zoom: number, cx: number, cy: number, read: (sx: number, sy: number, level: number) => void): void {
  const { samples, step, level } = spriteSampling(zoom);
  const at = (centre: number, k: number): number => {
    const sub = Math.min(15, Math.max(0, Math.floor(centre + ((k + 0.5) / samples - 0.5) * step)));
    return level === 1 ? sub - (sub & 1) : sub;
  };
  for (let y = 0; y < samples; y++) for (let x = 0; x < samples; x++) read(at(cx, x), at(cy, y), level);
}

/** Expects `actual` within one unit of `expected` in every channel (mismatches). */
export function expectClose(actual: Uint8Array, expected: Uint8Array, width: number): void {
  const found = mismatches(actual, expected, width);
  expect(found.slice(0, 5), `${String(found.length)} pixels differ`).toEqual([]);
  expect(actual.length).toBe(expected.length);
}

export function pixelAt(pixels: Uint8Array, index: number): Rgba {
  return [pixels[index] ?? 0, pixels[index + 1] ?? 0, pixels[index + 2] ?? 0, pixels[index + 3] ?? 0];
}

/** The missing-texture checkerboard at sprite pixel (sx, sy) of a tile. */
export function missingPixel(sx: number, sy: number): Rgba {
  const color = MISSING_SPRITE_COLORS[(Math.floor(sx / 8) + Math.floor(sy / 8)) & 1] ?? [0, 0, 0];
  return [color[0], color[1], color[2], 255];
}

export interface WallLayerInput {
  readonly world: CanonicalWorld;
  /** The framed wall cell of a tile inside the world. */
  readonly cellAt: (x: number, y: number) => number;
  readonly sheets: readonly SpriteSheetEntry[];
  /** The atlas pixel of `sheets[sheet]` at sheet pixel (x, y). */
  readonly sheetPixel: (sheet: number, x: number, y: number) => Rgba;
  /** renderChunk's colours with only the background and walls: a wall tile's map colour, else its background. */
  readonly mapWalls: Uint8Array;
  /** renderChunk's colours with only the background. */
  readonly background: Uint8Array;
}

/**
 * The wall sprites at sprite pixel (sx, sy) of tile (tx, ty), premultiplied: the 32 × 32 cells of the tile's wall and
 * of the neighbours whose 8-pixel overhang reaches the pixel, drawn row by row from the top and left to right within a
 * row, each over the ones before. A wall without a cell (not vanilla) shows its map colour on its own tile; a wall
 * without a sheet the missing-texture checkerboard there.
 */
export function wallSprites(input: WallLayerInput, tx: number, ty: number, sx: number, sy: number, level = 0): Premultiplied {
  const { world, sheets } = input;
  const { width, height } = world;
  const dx = sx < 8 ? -1 : 1;
  const dy = sy < 8 ? -1 : 1;
  let color: Premultiplied = [0, 0, 0, 0];
  for (const oy of [Math.min(0, dy), Math.max(0, dy)]) {
    for (const ox of [Math.min(0, dx), Math.max(0, dx)]) {
      const x = tx + ox;
      const y = ty + oy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const own = ox === 0 && oy === 0;
      const wall = input.world.planes.wall[x * height + y] ?? 0xffff;
      if (wall === 0xffff) continue;
      const cell = input.cellAt(x, y);
      if (cell === NO_CELL) {
        if (own) color = onTop(premultiply(pixelAt(input.mapWalls, (y * width + x) * 4)), color);
        continue;
      }
      const ref = world.palette[wall];
      const sheet = sheets.findIndex((entry) => entry.kind === "wall" && ref?.kind === "vanilla" && entry.id === ref.id);
      const entry = sheets[sheet];
      if (entry === undefined) {
        if (own) color = onTop(premultiply(missingPixel(sx, sy)), color);
        continue;
      }
      const px = (cell >> 6) * STRIDE + sx + OVERHANG - 16 * ox;
      const py = (cell & 63) * STRIDE + sy + OVERHANG - 16 * oy;
      if (px >= entry.width || py >= entry.height) continue;
      const pixel = level === 1
        ? halfTexel((x, y) => input.sheetPixel(sheet, x, y), px, py)
        : input.sheetPixel(sheet, px, py);
      color = onTop(premultiply(pixel), color);
    }
  }
  return color;
}

/** The wall layer at 16 pixels per tile and above: the wall sprites at (sx, sy) of tile (tx, ty) over the background. */
export function wallLayerPixel(input: WallLayerInput, tx: number, ty: number, sx: number, sy: number): Rgba {
  return over(straight(wallSprites(input, tx, ty, sx, sy)), pixelAt(input.background, (ty * input.world.width + tx) * 4));
}

/**
 * The wall layer of screen pixel (px, py) at `zoom` pixels per tile with the camera at the world's origin, as the chunk
 * pass samples it (samplePositions): the straight-alpha mean of the wall sprites at the samples (of the half-resolution
 * atlas at level 1), over the background, mixed with the walls' map colour by the sprite weight.
 */
export function wallScreenPixel(input: WallLayerInput, zoom: number, px: number, py: number): Rgba {
  const { weight } = spriteSampling(zoom);
  const wx = (px + 0.5) / zoom;
  const wy = (py + 0.5) / zoom;
  const tx = Math.floor(wx);
  const ty = Math.floor(wy);
  let sum: Premultiplied = [0, 0, 0, 0];
  let n = 0;
  samplePositions(zoom, (wx - tx) * 16, (wy - ty) * 16, (sx, sy, level) => {
    const sampled = wallSprites(input, tx, ty, sx, sy, level);
    sum = [sum[0] + sampled[0], sum[1] + sampled[1], sum[2] + sampled[2], sum[3] + sampled[3]];
    n++;
  });
  const mean = straight([sum[0] / n, sum[1] / n, sum[2] / n, sum[3] / n]);
  const layer = over(mean, pixelAt(input.background, (ty * input.world.width + tx) * 4));
  if (weight >= 256) return layer;
  const map = pixelAt(input.mapWalls, (ty * input.world.width + tx) * 4);
  const mix = (k: number): number => Math.floor(((map[k] ?? 0) * (256 - weight) + (layer[k] ?? 0) * weight + 128) / 256);
  return [mix(0), mix(1), mix(2), mix(3)];
}
