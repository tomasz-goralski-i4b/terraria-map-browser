import type { CanonicalWorld, ContentRef } from "@studio/world-model";
import { contentColor, liquidColors } from "../palette/map-palette.js";
import type { MapPalette, Rgba } from "../palette/map-palette.js";

export interface ChunkLayers {
  readonly background: boolean;
  readonly walls: boolean;
  readonly blocks: boolean;
  readonly liquids: boolean;
}

export interface ChunkRenderOptions {
  readonly surfaceY: number;
  readonly layers: ChunkLayers;
  /** Map colours for vanilla content; without one, every block and wall gets its placeholder colour. */
  readonly mapPalette?: MapPalette;
}

export interface ChunkPixels {
  readonly width: number;
  readonly height: number;
  /** Straight-alpha RGBA, row-major within the chunk. */
  readonly pixels: Uint8ClampedArray;
}

const chunkSize = 128;
const absentContent = 0xffff;

interface PaletteColors {
  readonly block: Rgba[];
  readonly wall: Rgba[];
}

// Keyed by map palette, then by CWM palette. CWM palettes are append-only, so a cached colour stays valid and
// only new entries need resolving.
const withoutMapPalette = {};
const paletteColorCache = new WeakMap<object, WeakMap<readonly ContentRef[], PaletteColors>>();

function paletteColors(palette: readonly ContentRef[], mapPalette: MapPalette | undefined): PaletteColors {
  const key = mapPalette ?? withoutMapPalette;
  let byPalette = paletteColorCache.get(key);
  if (byPalette === undefined) {
    byPalette = new WeakMap();
    paletteColorCache.set(key, byPalette);
  }
  let colors = byPalette.get(palette);
  if (colors === undefined) {
    colors = { block: [], wall: [] };
    byPalette.set(palette, colors);
  }
  for (let index = colors.block.length; index < palette.length; index++) {
    const ref = palette[index];
    if (ref === undefined) break;
    colors.block.push(contentColor(ref, "block", mapPalette));
    colors.wall.push(contentColor(ref, "wall", mapPalette));
  }
  return colors;
}

export function renderChunk(
  world: CanonicalWorld,
  chunkX: number,
  chunkY: number,
  options: ChunkRenderOptions,
): ChunkPixels {
  const chunksX = Math.ceil(world.width / chunkSize);
  const chunksY = Math.ceil(world.height / chunkSize);
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY)
    || chunkX < 0 || chunkY < 0 || chunkX >= chunksX || chunkY >= chunksY) {
    throw new RangeError(`Chunk (${String(chunkX)}, ${String(chunkY)}) is outside the ${String(chunksX)} × `
      + `${String(chunksY)} chunk grid of a ${String(world.width)} × ${String(world.height)} world`);
  }
  const originX = chunkX * chunkSize;
  const originY = chunkY * chunkSize;
  const width = Math.min(chunkSize, world.width - originX);
  const height = Math.min(chunkSize, world.height - originY);
  const pixels = new Uint8ClampedArray(width * height * 4);
  const { layers, surfaceY, mapPalette } = options;
  const { planes } = world;
  // Palette colours are cached outside the pixel loop; no semantic tile views are created.
  const colors = paletteColors(world.palette, mapPalette);
  const blockColors = layers.blocks ? colors.block : [];
  const wallColors = layers.walls ? colors.wall : [];
  const liquids = liquidColors(mapPalette);

  for (let y = 0; y < height; y++) {
    const sky = originY + y < surfaceY;
    for (let x = 0; x < width; x++) {
      const index = (originX + x) * world.height + originY + y;
      let red = layers.background ? (sky ? 100 : 40) : 0;
      let green = layers.background ? (sky ? 160 : 30) : 0;
      let blue = layers.background ? (sky ? 220 : 20) : 0;
      let alpha = layers.background ? 255 : 0;

      // Both content layers are opaque, so the uppermost present colour replaces the background.
      const color = blockColors[planes.block[index] ?? absentContent]
        ?? wallColors[planes.wall[index] ?? absentContent];
      if (color !== undefined) {
        red = color[0];
        green = color[1];
        blue = color[2];
        alpha = color[3];
      }

      const liquid = layers.liquids ? liquids[planes.liquid[index] ?? 0] : undefined;
      const amount = planes.liquidAmount[index] ?? 0;
      if (liquid !== undefined && liquid[3] !== 0 && amount !== 0) {
        // Earlier layers are either opaque or absent. On transparent pixels retain straight RGB.
        const opacity = amount / 255;
        const retainedAlpha = (alpha / 255) * (1 - opacity);
        const outputAlpha = opacity + retainedAlpha;
        red = Math.round((liquid[0] * opacity + red * retainedAlpha) / outputAlpha);
        green = Math.round((liquid[1] * opacity + green * retainedAlpha) / outputAlpha);
        blue = Math.round((liquid[2] * opacity + blue * retainedAlpha) / outputAlpha);
        alpha = Math.round(outputAlpha * 255);
      }

      const offset = (y * width + x) * 4;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = alpha;
    }
  }
  return { width, height, pixels };
}
