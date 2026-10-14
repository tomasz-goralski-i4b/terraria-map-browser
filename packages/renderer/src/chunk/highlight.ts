// The content highlight (#186): which tiles match a search, the overlay the WebGL2 chunk pass draws over them from one
// pixel per tile up (`highlightOverlay` is its CPU reference), and the overview's match mask, built on the CPU in slices.
import type { Camera, Size } from "../camera/camera.js";

/** What to highlight: tiles holding any of these blocks, walls or liquids. */
export interface MapHighlight {
  /** Palette indices (the world's ContentRef palette, as stored in the block plane) whose blocks match. */
  readonly blocks: readonly number[];
  /** Palette indices whose walls match. */
  readonly walls: readonly number[];
  /** CWM liquid kinds 1–4 that match: a tile matches when `liquid & 0b111` is that kind (its amount is ignored). */
  readonly liquids: readonly number[];
  /** Darken the tiles that do not match, so the matches stand out. */
  readonly dim: boolean;
}

/** The highlight's colours (MapRendererOptions). */
export interface HighlightOptions {
  /** Outline and tint colour of matches, RGB 0–255. Default `DEFAULT_HIGHLIGHT_COLOR`. */
  readonly highlightColor?: readonly [number, number, number];
  /** Opacity (0–1) of the black layer over tiles that do not match, when dimming. Default `DEFAULT_HIGHLIGHT_DIM`. */
  readonly highlightDim?: number;
}

/** The slice of a world the highlight reads: column-major planes (`x * height + y`). */
export interface HighlightWorld {
  readonly width: number;
  readonly height: number;
  readonly planes: { readonly block: Uint16Array; readonly wall: Uint16Array; readonly liquid: Uint8Array };
  readonly palette: { readonly length: number };
}

/** A warm yellow: reads over the sky, dirt, stone and the dark underground alike, and is no map colour of its own. */
export const DEFAULT_HIGHLIGHT_COLOR: readonly [number, number, number] = [255, 214, 64];
/** Opacity of the black layer over non-matching tiles. */
export const DEFAULT_HIGHLIGHT_DIM = 0.6;
/** Width of the outline along a match's edges, in backing pixels. */
export const HIGHLIGHT_OUTLINE_PIXELS = 2;
/** Pixels per tile from which matches are outlined; below, a tint of the highlight colour covers them. */
export const HIGHLIGHT_OUTLINE_ZOOM = 4;
/** Alpha (0–255) of the tint over matches below HIGHLIGHT_OUTLINE_ZOOM. */
export const HIGHLIGHT_TINT_ALPHA = 179;
/** Entries of the lookup: every 16-bit palette index but 65535 (absent). */
export const HIGHLIGHT_LOOKUP_SIZE = 0x10000;
/** Bits of a lookup entry. */
export const HIGHLIGHT_BLOCK_BIT = 1;
export const HIGHLIGHT_WALL_BIT = 2;
/** CWM liquid kind bits of the liquid plane. */
const LIQUID_KIND_MASK = 0b111;
const ABSENT = 0xffff;

function checkIndices(indices: readonly number[], what: string): void {
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= ABSENT) throw new RangeError(`Invalid highlight ${what} index ${String(index)}`);
  }
}

/** Per palette index, HIGHLIGHT_BLOCK_BIT when its block matches and HIGHLIGHT_WALL_BIT when its wall does. */
export function highlightLookup(highlight: MapHighlight): Uint8Array {
  checkIndices(highlight.blocks, "block");
  checkIndices(highlight.walls, "wall");
  const lookup = new Uint8Array(HIGHLIGHT_LOOKUP_SIZE);
  for (const index of highlight.blocks) lookup[index] = (lookup[index] ?? 0) | HIGHLIGHT_BLOCK_BIT;
  for (const index of highlight.walls) lookup[index] = (lookup[index] ?? 0) | HIGHLIGHT_WALL_BIT;
  return lookup;
}

/** Bit k set when liquid kind k matches. Throws on a kind outside 1–4. */
export function highlightLiquids(highlight: MapHighlight): number {
  let bits = 0;
  for (const kind of highlight.liquids) {
    if (!Number.isInteger(kind) || kind < 1 || kind > 4) throw new RangeError(`Invalid highlight liquid kind ${String(kind)}`);
    bits |= 1 << kind;
  }
  return bits;
}

/** Whether tile `index` (column-major) matches: block or wall index below the palette's length, or liquid kind. */
export function highlightMatches(world: HighlightWorld, lookup: Uint8Array, liquids: number, index: number): boolean {
  const length = world.palette.length;
  const block = world.planes.block[index] ?? ABSENT;
  if (block < length && ((lookup[block] ?? 0) & HIGHLIGHT_BLOCK_BIT) !== 0) return true;
  const wall = world.planes.wall[index] ?? ABSENT;
  if (wall < length && ((lookup[wall] ?? 0) & HIGHLIGHT_WALL_BIT) !== 0) return true;
  return ((liquids >> ((world.planes.liquid[index] ?? 0) & LIQUID_KIND_MASK)) & 1) !== 0;
}

/** The highlight's colours as the overlay draws them: RGB, and the alphas (0–255) of the dim layer and the tint. */
export function highlightColors(options: HighlightOptions | undefined): {
  readonly color: readonly [number, number, number]; readonly dim: number;
} {
  const color = options?.highlightColor ?? DEFAULT_HIGHLIGHT_COLOR;
  if (!color.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)) {
    throw new RangeError("Invalid highlight colour");
  }
  const dim = options?.highlightDim ?? DEFAULT_HIGHLIGHT_DIM;
  if (!Number.isFinite(dim) || dim < 0 || dim > 1) throw new RangeError("Invalid highlight dim opacity");
  return { color, dim: Math.round(dim * 255) };
}

/**
 * The overlay the map renderer composes over the terrain from one pixel per tile up (the CPU reference of its highlight
 * pass): straight-alpha RGBA, row-major, for the viewport. The pixel's centre picks its tile, as in the chunk pass.
 * - A matching tile is clear, but from HIGHLIGHT_OUTLINE_ZOOM pixels per tile an outline of the highlight colour,
 *   HIGHLIGHT_OUTLINE_PIXELS wide, runs inside it along each side whose neighbour does not match (the world's edge is
 *   not outlined); below that zoom the whole tile is tinted with the colour at HIGHLIGHT_TINT_ALPHA.
 * - A tile that does not match is black at the dim opacity when `highlight.dim`, else clear.
 * - Pixels outside the world are clear.
 */
export function highlightOverlay(
  world: HighlightWorld, highlight: MapHighlight, camera: Camera, viewport: Size, options?: HighlightOptions,
): Uint8ClampedArray {
  const lookup = highlightLookup(highlight);
  const liquids = highlightLiquids(highlight);
  const { color, dim } = highlightColors(options);
  const { width, height, zoom } = { ...viewport, zoom: camera.zoom };
  const pixels = new Uint8ClampedArray(width * height * 4);
  const matches = (x: number, y: number): boolean => highlightMatches(world, lookup, liquids, x * world.height + y);
  // A neighbour past the world's edge is not outlined against.
  const differs = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < world.width && y < world.height && !matches(x, y);
  const outline = zoom >= HIGHLIGHT_OUTLINE_ZOOM;
  for (let py = 0; py < height; py++) {
    const worldY = camera.y + (py + 0.5) / zoom;
    const tileY = Math.floor(worldY);
    if (tileY < 0 || tileY >= world.height) continue;
    for (let px = 0; px < width; px++) {
      const worldX = camera.x + (px + 0.5) / zoom;
      const tileX = Math.floor(worldX);
      if (tileX < 0 || tileX >= world.width) continue;
      const at = (py * width + px) * 4;
      if (!matches(tileX, tileY)) {
        if (highlight.dim) pixels[at + 3] = dim;
        continue;
      }
      if (!outline) {
        pixels.set([...color, HIGHLIGHT_TINT_ALPHA], at);
        continue;
      }
      const insideX = (worldX - tileX) * zoom;
      const insideY = (worldY - tileY) * zoom;
      const ink = (insideX < HIGHLIGHT_OUTLINE_PIXELS && differs(tileX - 1, tileY))
        || (zoom - insideX < HIGHLIGHT_OUTLINE_PIXELS && differs(tileX + 1, tileY))
        || (insideY < HIGHLIGHT_OUTLINE_PIXELS && differs(tileX, tileY - 1))
        || (zoom - insideY < HIGHLIGHT_OUTLINE_PIXELS && differs(tileX, tileY + 1));
      if (ink) pixels.set([...color, 255], at);
    }
  }
  return pixels;
}

/** A rectangle of texels of one mip level that changed. */
export interface MaskRect {
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The overview's match mask: one texel per factor × factor tiles, 255 when any of them matches, and its mip levels
 * (GL's sizes: halved and floored, at least 1), each texel the maximum of the texels below it, so a lone match stays
 * visible however far the map is zoomed out. An odd last column or row folds into the last texel of the next level.
 */
export interface HighlightMask {
  readonly world: HighlightWorld;
  readonly factor: number;
  readonly width: number;
  readonly height: number;
  /** Row-major R8 levels, level 0 first. */
  readonly levels: readonly Uint8Array[];
  /** Whether every column of level 0 is built. */
  readonly done: boolean;
  /**
   * Builds the next columns of level 0 (left to right), at least one, until `expired()` is true, and updates the levels
   * above them. Returns the rectangles that changed, one per level.
   */
  readonly step: (expired: () => boolean) => readonly MaskRect[];
  /** Recomputes the texels holding `tiles` (after an edit) and the levels above them; returns what changed. */
  readonly patch: (tiles: readonly { readonly x: number; readonly y: number }[]) => readonly MaskRect[];
}

/** Sizes of the mip levels of a `width` × `height` texture, as WebGL allocates them. */
function levelSizes(width: number, height: number): (readonly [number, number])[] {
  const count = Math.floor(Math.log2(Math.max(width, height))) + 1;
  return Array.from({ length: count }, (_, level) => [Math.max(1, width >> level), Math.max(1, height >> level)] as const);
}

export function createHighlightMask(world: HighlightWorld, lookup: Uint8Array, liquids: number, factor: number): HighlightMask {
  const width = Math.ceil(world.width / factor);
  const height = Math.ceil(world.height / factor);
  const sizes = levelSizes(width, height);
  const levels = sizes.map(([w, h]) => new Uint8Array(w * h));
  const base = levels[0] ?? new Uint8Array(0);
  const { block, wall, liquid } = world.planes;
  const worldHeight = world.height;
  let next = 0;

  /** Level-0 column `column` from the planes: every tile column it covers, top to bottom. */
  const buildColumn = (column: number, top = 0, bottom = height): void => {
    const length = world.palette.length;
    const firstX = column * factor;
    const lastX = Math.min(world.width, firstX + factor);
    for (let row = top; row < bottom; row++) base[row * width + column] = 0;
    for (let x = firstX; x < lastX; x++) {
      const columnStart = x * worldHeight;
      const endY = Math.min(worldHeight, bottom * factor);
      for (let y = top * factor; y < endY; y++) {
        const index = columnStart + y;
        const b = block[index] ?? ABSENT;
        const w = wall[index] ?? ABSENT;
        if ((b < length && ((lookup[b] ?? 0) & HIGHLIGHT_BLOCK_BIT) !== 0)
          || (w < length && ((lookup[w] ?? 0) & HIGHLIGHT_WALL_BIT) !== 0)
          || ((liquids >> ((liquid[index] ?? 0) & LIQUID_KIND_MASK)) & 1) !== 0) {
          base[Math.floor(y / factor) * width + column] = 255;
        }
      }
    }
  };

  /** Recomputes the levels above level-0 texels [x0, x1) × [y0, y1); returns every level's changed rectangle. */
  const reduce = (x0: number, y0: number, x1: number, y1: number): MaskRect[] => {
    const rects: MaskRect[] = [{ level: 0, x: x0, y: y0, width: x1 - x0, height: y1 - y0 }];
    for (let level = 1; level < levels.length; level++) {
      const [belowWidth, belowHeight] = sizes[level - 1] ?? [1, 1];
      const [levelWidth, levelHeight] = sizes[level] ?? [1, 1];
      const below = levels[level - 1] ?? base;
      const target = levels[level] ?? base;
      x0 = Math.min(levelWidth - 1, x0 >> 1);
      y0 = Math.min(levelHeight - 1, y0 >> 1);
      x1 = Math.min(levelWidth, ((x1 - 1) >> 1) + 1);
      y1 = Math.min(levelHeight, ((y1 - 1) >> 1) + 1);
      for (let y = y0; y < y1; y++) {
        // The last texel also covers an odd last row (column) below it.
        const fromY = 2 * y;
        const toY = y === levelHeight - 1 ? belowHeight : Math.min(belowHeight, fromY + 2);
        for (let x = x0; x < x1; x++) {
          const fromX = 2 * x;
          const toX = x === levelWidth - 1 ? belowWidth : Math.min(belowWidth, fromX + 2);
          let value = 0;
          for (let v = fromY; v < toY && value === 0; v++) {
            for (let u = fromX; u < toX; u++) value = Math.max(value, below[v * belowWidth + u] ?? 0);
          }
          target[y * levelWidth + x] = value;
        }
      }
      rects.push({ level, x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
    }
    return rects;
  };

  return {
    world, factor, width, height, levels,
    get done() { return next >= width; },
    step: (expired) => {
      const first = next;
      if (first >= width) return [];
      do buildColumn(next++); while (next < width && !expired());
      return reduce(first, 0, next, height);
    },
    patch: (tiles) => {
      let x0 = width, y0 = height, x1 = 0, y1 = 0;
      for (const { x, y } of tiles) {
        if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
        const column = Math.floor(x / factor);
        const row = Math.floor(y / factor);
        buildColumn(column, row, row + 1);
        x0 = Math.min(x0, column); y0 = Math.min(y0, row);
        x1 = Math.max(x1, column + 1); y1 = Math.max(y1, row + 1);
      }
      return x1 <= x0 ? [] : reduce(x0, y0, x1, y1);
    },
  };
}
