import type { CanonicalWorld, ContentRef } from "@studio/world-model";
import {
  backgroundColor, contentColor, liquidColors, mapOption, optionColor, optionColors, optionRule, paintedColor,
} from "../palette/map-palette.js";
import type { MapOptionRule, MapPalette, Rgba } from "../palette/map-palette.js";

export interface ChunkLayers {
  readonly background: boolean;
  readonly walls: boolean;
  readonly blocks: boolean;
  readonly liquids: boolean;
  /**
   * Wire overlay: a mask of the CWM `flags` bits to show (bit 0 red, 1 blue, 2 green, 3 yellow wire, 4 actuator; see
   * `WIRE_LAYER`). Absent or 0 draws no overlay.
   */
  readonly wires?: number;
}

/** Bits of `ChunkLayers.wires`, equal to the CWM `flags` bits they show. */
export const WIRE_LAYER = { red: 1, blue: 2, green: 4, yellow: 8, actuator: 16, all: 31 } as const;

/**
 * Overlay colours, in drawing priority: a tile shows the topmost visible wire (yellow over green over blue over red,
 * the order the game draws them), else its actuator. They are UI colours, not map colours.
 */
export const WIRE_COLORS: readonly (readonly [bit: number, color: readonly [number, number, number]])[] = [
  [WIRE_LAYER.yellow, [255, 221, 51]],
  [WIRE_LAYER.green, [51, 221, 85]],
  [WIRE_LAYER.blue, [68, 119, 255]],
  [WIRE_LAYER.red, [255, 68, 68]],
  [WIRE_LAYER.actuator, [214, 140, 230]],
];

/** Opacity of the wire overlay over an opaque tile (0–255). */
export const WIRE_ALPHA = 192;

/** The overlay colour of a tile's flags under a wire mask, or undefined when it shows none. */
export function wireColor(flags: number, mask: number): readonly [number, number, number] | undefined {
  const shown = flags & mask & WIRE_LAYER.all;
  if (shown === 0) return undefined;
  for (const [bit, color] of WIRE_COLORS) if ((shown & bit) !== 0) return color;
  return undefined;
}

export interface ChunkRenderOptions {
  /** The world's surface level: the sky is above it. */
  readonly surfaceY: number;
  /** The world's rock level; without one the dirt layer reaches the underworld (only drawn with a map palette). */
  readonly rockY?: number;
  readonly layers: ChunkLayers;
  /**
   * Map colours: vanilla content, paint and the background by depth. Without one, every block and wall gets its
   * placeholder colour, paint is ignored and the background is the placeholder sky and underground.
   */
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
const transparent: Rgba = [0, 0, 0, 0];

/** A block whose map option its frame selects: the rule and one colour per option. */
interface FramedBlock {
  readonly rule: MapOptionRule;
  readonly colors: readonly Rgba[];
}

interface PaletteColors {
  readonly block: Rgba[];
  readonly wall: Rgba[];
  /** By palette index; undefined for blocks without a frame rule (they use `block`). */
  readonly framed: (FramedBlock | undefined)[];
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
    colors = { block: [], wall: [], framed: [] };
    byPalette.set(palette, colors);
  }
  for (let index = colors.block.length; index < palette.length; index++) {
    const ref = palette[index];
    if (ref === undefined) break;
    colors.block.push(contentColor(ref, "block", mapPalette));
    colors.wall.push(contentColor(ref, "wall", mapPalette));
    const rule = optionRule(ref, "block", mapPalette);
    const options = optionColors(ref, "block", mapPalette);
    colors.framed.push(rule === undefined || options === undefined ? undefined : { rule, colors: options });
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
  const { layers, mapPalette } = options;
  const depth = { surfaceY: options.surfaceY, height: world.height, ...(options.rockY === undefined ? {} : { rockY: options.rockY }) };
  const { planes } = world;
  // Typed as optional: the WebGL2 backend's worlds may omit the frame planes (frame 0), and its CPU reference reuses this.
  const frameX = planes.frameX as Int16Array | undefined;
  const frameY = planes.frameY as Int16Array | undefined;
  const flags = planes.flags as Uint16Array | undefined;
  const wireMask = (layers.wires ?? 0) & WIRE_LAYER.all;
  // Palette colours are cached outside the pixel loop; no semantic tile views are created.
  const colors = paletteColors(world.palette, mapPalette);
  const blockColors = layers.blocks ? colors.block : [];
  const wallColors = layers.walls ? colors.wall : [];
  const liquids = liquidColors(mapPalette);

  for (let y = 0; y < height; y++) {
    const background = layers.background ? backgroundColor(originY + y, depth, mapPalette) : transparent;
    for (let x = 0; x < width; x++) {
      const index = (originX + x) * world.height + originY + y;
      let red = background[0];
      let green = background[1];
      let blue = background[2];
      let alpha = background[3];

      // Both content layers are opaque, so the uppermost present colour replaces the background.
      const blockId = planes.block[index] ?? absentContent;
      let block = blockColors[blockId];
      const framed = block === undefined || !layers.blocks ? undefined : colors.framed[blockId];
      if (framed !== undefined) {
        block = optionColor(framed.colors, mapOption(framed.rule, frameX?.[index] ?? 0, frameY?.[index] ?? 0)) ?? block;
      }
      const wall = block === undefined ? wallColors[planes.wall[index] ?? absentContent] : undefined;
      let color = block ?? wall;
      if (mapPalette !== undefined && color !== undefined) {
        color = block === undefined
          ? paintedColor(color, planes.wallPaint[index] ?? 0, "wall", mapPalette)
          : paintedColor(color, planes.paint[index] ?? 0, "block", mapPalette);
      }
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

      const wire = wireMask === 0 ? undefined : wireColor(flags?.[index] ?? 0, wireMask);
      if (wire !== undefined) {
        // Integer blend, the same expression as the shader (bit-exact); over a non-opaque pixel the wire replaces it.
        if (alpha === 255) {
          red = Math.floor((2 * (wire[0] * WIRE_ALPHA + red * (255 - WIRE_ALPHA)) + 255) / 510);
          green = Math.floor((2 * (wire[1] * WIRE_ALPHA + green * (255 - WIRE_ALPHA)) + 255) / 510);
          blue = Math.floor((2 * (wire[2] * WIRE_ALPHA + blue * (255 - WIRE_ALPHA)) + 255) / 510);
        } else {
          [red, green, blue] = wire;
          alpha = WIRE_ALPHA;
        }
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
