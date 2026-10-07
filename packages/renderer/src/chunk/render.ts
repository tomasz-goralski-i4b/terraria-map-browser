import type { CanonicalWorld, ContentRef } from "../../../world-model/dist/index.js";

export type Rgba = readonly [number, number, number, number];

export interface ChunkLayers {
  readonly background: boolean;
  readonly walls: boolean;
  readonly blocks: boolean;
  readonly liquids: boolean;
}

export interface ChunkRenderOptions {
  readonly surfaceY: number;
  readonly layers: ChunkLayers;
}

export interface ChunkPixels {
  readonly width: number;
  readonly height: number;
  /** Straight-alpha RGBA, row-major within the chunk. */
  readonly pixels: Uint8ClampedArray;
}

const chunkSize = 128;
const absentContent = 0xffff;
const liquidColors: readonly Rgba[] = [
  [0, 0, 0, 0],
  [40, 110, 230, 255],
  [255, 80, 20, 255],
  [240, 180, 40, 255],
  [180, 100, 240, 255],
];

export function placeholderColor(ref: ContentRef, layer: "block" | "wall"): Rgba {
  if (ref.kind !== "vanilla") return [255, 0, 255, 255];
  const key = `vanilla:${String(ref.id)}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash = Math.imul(hash ^ key.charCodeAt(i), 16777619) >>> 0;
  }
  const divisor = layer === "wall" ? 2 : 1;
  return [
    Math.floor((64 + (hash & 127)) / divisor),
    Math.floor((64 + ((hash >>> 8) & 127)) / divisor),
    Math.floor((64 + ((hash >>> 16) & 127)) / divisor),
    255,
  ];
}

export function renderChunk(
  world: CanonicalWorld,
  chunkX: number,
  chunkY: number,
  options: ChunkRenderOptions,
): ChunkPixels {
  const originX = chunkX * chunkSize;
  const originY = chunkY * chunkSize;
  const width = Math.min(chunkSize, world.width - originX);
  const height = Math.min(chunkSize, world.height - originY);
  const pixels = new Uint8ClampedArray(width * height * 4);
  const { layers, surfaceY } = options;
  const { planes } = world;
  // Palette-sized allocations stay outside the pixel loop; no semantic tile views are created.
  const blockColors = layers.blocks ? world.palette.map((ref) => placeholderColor(ref, "block")) : [];
  const wallColors = layers.walls ? world.palette.map((ref) => placeholderColor(ref, "wall")) : [];

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

      const liquid = layers.liquids ? liquidColors[planes.liquid[index] ?? 0] : undefined;
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
