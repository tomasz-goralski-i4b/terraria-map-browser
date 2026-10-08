// The CPU reference of the chunk pass below one pixel per tile (the WebGL2 backend's `uFilter` branch): the
// mean of the tiles a pixel's footprint covers, weighted by covered area. It uses the shader's integer arithmetic,
// so the GPU output equals it exactly.
import type { Camera, Size } from "../camera/camera.js";
import type { ChunkPixels } from "./render.js";

/**
 * Widest footprint the filter averages, in tiles per pixel: the overview takes over below 1 / 2 pixel per tile (its
 * factor for every vanilla size). Larger overview factors draw the band below that with a 2-tile footprint.
 */
export const MAX_FILTER_TILES = 2;

/** Footprint edges are quantized to 1 / SUBTILE of a tile; weights are products of covered lengths in those units. */
export const FILTER_SUBTILE = 64;

/** Tiles per pixel of the filter at a zoom, as the float the shader receives. */
export function filterTilesPerPixel(zoom: number): number {
  return Math.fround(Math.min(1 / zoom, MAX_FILTER_TILES));
}

/** First footprint edge of pixel `index`, in subtile units: the shader's float32 `camera + index * step`, rounded. */
function edge(camera: number, index: number, step: number): number {
  return Math.floor(Math.fround(Math.fround(camera) + Math.fround(index * step)) * FILTER_SUBTILE + 0.5);
}

/**
 * The pixels the chunk pass draws below one pixel per tile, from `tiles`: the whole world at one pixel per tile, as
 * `renderChunk` produces it (straight-alpha RGBA, row-major). Returns straight-alpha RGBA, row-major, for the viewport.
 *
 * Pixel (px, py) covers tiles `camera + p × step` to `camera + (p + 1) × step` on each axis, step = 1 / zoom capped at
 * `MAX_FILTER_TILES`, with edges rounded to 1 / `FILTER_SUBTILE` tile. Its colour is the premultiplied mean of the
 * in-world tiles under it, weighted by covered area: RGB is Σ rgb × a × w / Σ a × w and alpha Σ a × w / Σ w, both
 * rounded half up; with no alpha at all it is transparent black. A pixel whose centre is outside the world is not
 * drawn (transparent).
 */
export function filterTiles(tiles: ChunkPixels, camera: Camera, viewport: Size): Uint8ClampedArray {
  if (!(camera.zoom > 0 && camera.zoom < 1)) {
    throw new RangeError(`The box filter covers zoom levels below 1 pixel per tile, not ${String(camera.zoom)}`);
  }
  const { width, height, pixels } = tiles;
  const step = filterTilesPerPixel(camera.zoom);
  const out = new Uint8ClampedArray(viewport.width * viewport.height * 4);
  const span = (first: number, last: number, size: number): { tile: number; weight: number }[] => {
    const covered: { tile: number; weight: number }[] = [];
    for (let tile = Math.floor(first / FILTER_SUBTILE); tile * FILTER_SUBTILE < last; tile++) {
      if (tile < 0 || tile >= size) continue;
      const weight = Math.min(last, (tile + 1) * FILTER_SUBTILE) - Math.max(first, tile * FILTER_SUBTILE);
      if (weight > 0) covered.push({ tile, weight });
    }
    return covered;
  };
  const columns = Array.from({ length: viewport.width }, (_, px) => {
    const first = edge(camera.x, px, step);
    return span(first, edge(camera.x, px + 1, step), width);
  });
  for (let py = 0; py < viewport.height; py++) {
    const centreY = Math.fround(camera.y) + (py + 0.5) * step;
    if (centreY < 0 || centreY >= height) continue;
    const rows = span(edge(camera.y, py, step), edge(camera.y, py + 1, step), height);
    for (let px = 0; px < viewport.width; px++) {
      const centreX = Math.fround(camera.x) + (px + 0.5) * step;
      if (centreX < 0 || centreX >= width) continue;
      let area = 0;
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (const row of rows) {
        for (const column of columns[px] ?? []) {
          const weight = row.weight * column.weight;
          const offset = (row.tile * width + column.tile) * 4;
          const a = pixels[offset + 3] ?? 0;
          area += weight;
          alpha += a * weight;
          red += (pixels[offset] ?? 0) * a * weight;
          green += (pixels[offset + 1] ?? 0) * a * weight;
          blue += (pixels[offset + 2] ?? 0) * a * weight;
        }
      }
      if (alpha === 0) continue;
      const offset = (py * viewport.width + px) * 4;
      out[offset] = Math.floor((2 * red + alpha) / (2 * alpha));
      out[offset + 1] = Math.floor((2 * green + alpha) / (2 * alpha));
      out[offset + 2] = Math.floor((2 * blue + alpha) / (2 * alpha));
      out[offset + 3] = Math.floor((2 * alpha + area) / (2 * area));
    }
  }
  return out;
}
