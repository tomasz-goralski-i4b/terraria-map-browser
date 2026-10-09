// The CPU expectation of sprite mode's wall layer at 16 pixels per tile (one sprite pixel per canvas pixel), shared by
// the browser tests that read sprite-mode pixels back (docs/assets.md, "Walls" and "Atlas").
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
 * The wall sprites at sprite pixel (sx, sy) of tile (tx, ty), straight alpha: the 32 × 32 cells of the tile's wall and
 * of the neighbours whose 8-pixel overhang reaches the pixel, drawn row by row from the top and left to right within a
 * row, each over the ones before. A wall without a cell (not vanilla) shows its map colour on its own tile; a wall
 * without a sheet the missing-texture checkerboard there.
 */
export function wallSprites(input: WallLayerInput, tx: number, ty: number, sx: number, sy: number): Rgba {
  const { world, sheets } = input;
  const { width, height } = world;
  const dx = sx < 8 ? -1 : 1;
  const dy = sy < 8 ? -1 : 1;
  let color: Rgba = [0, 0, 0, 0];
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
        if (own) color = over(pixelAt(input.mapWalls, (y * width + x) * 4), color);
        continue;
      }
      const ref = world.palette[wall];
      const sheet = sheets.findIndex((entry) => entry.kind === "wall" && ref?.kind === "vanilla" && entry.id === ref.id);
      const entry = sheets[sheet];
      if (entry === undefined) {
        if (own) color = over(missingPixel(sx, sy), color);
        continue;
      }
      const px = (cell >> 6) * STRIDE + sx + OVERHANG - 16 * ox;
      const py = (cell & 63) * STRIDE + sy + OVERHANG - 16 * oy;
      if (px >= entry.width || py >= entry.height) continue;
      color = over(input.sheetPixel(sheet, px, py), color);
    }
  }
  return color;
}

/** The wall layer at 16 pixels per tile and above: the wall sprites at (sx, sy) of tile (tx, ty) over the background. */
export function wallLayerPixel(input: WallLayerInput, tx: number, ty: number, sx: number, sy: number): Rgba {
  return over(wallSprites(input, tx, ty, sx, sy), pixelAt(input.background, (ty * input.world.width + tx) * 4));
}

/**
 * The wall layer of screen pixel (px, py) at `zoom` pixels per tile with the camera at the world's origin, as the chunk
 * pass samples it (spriteSampling): the straight-alpha mean of samples × samples wall sprite pixels spread over the
 * pixel's footprint inside its tile, over the background, mixed with the walls' map colour by the sprite weight.
 */
export function wallScreenPixel(input: WallLayerInput, zoom: number, px: number, py: number): Rgba {
  const { samples, step, weight } = spriteSampling(zoom);
  const wx = (px + 0.5) / zoom;
  const wy = (py + 0.5) / zoom;
  const tx = Math.floor(wx);
  const ty = Math.floor(wy);
  const sum = [0, 0, 0, 0];
  for (let y = 0; y < samples; y++) {
    for (let x = 0; x < samples; x++) {
      const at = (centre: number, k: number): number =>
        Math.min(15, Math.max(0, Math.floor(centre * 16 + ((k + 0.5) / samples - 0.5) * step)));
      const sampled = wallSprites(input, tx, ty, at(wx - tx, x), at(wy - ty, y));
      for (let k = 0; k < 3; k++) sum[k] = (sum[k] ?? 0) + (sampled[k] ?? 0) * sampled[3];
      sum[3] = (sum[3] ?? 0) + sampled[3];
    }
  }
  const alpha = sum[3] ?? 0;
  const n = samples * samples;
  const channel = (k: number): number => Math.floor((2 * (sum[k] ?? 0) + alpha) / (2 * alpha));
  const mean: Rgba = alpha === 0 ? [0, 0, 0, 0] : [channel(0), channel(1), channel(2), Math.floor((2 * alpha + n) / (2 * n))];
  const layer = over(mean, pixelAt(input.background, (ty * input.world.width + tx) * 4));
  if (weight >= 256) return layer;
  const map = pixelAt(input.mapWalls, (ty * input.world.width + tx) * 4);
  const mix = (k: number): number => Math.floor(((map[k] ?? 0) * (256 - weight) + (layer[k] ?? 0) * weight + 128) / 256);
  return [mix(0), mix(1), mix(2), mix(3)];
}
