import { CHUNK_SIZE } from "../camera/camera.js";
import type { ChunkCoord } from "../camera/camera.js";
import { NO_CELL } from "./frame-block.js";
import type { BlockFraming, BlockRegion, FramingWorld } from "./frame-block.js";
import { TILE_DRAW_FLAGS } from "../objects/tile-draw-flags.js";

/** Sheet pixels per cell of a self-framed block: a 16 × 16 cell and a 2-pixel gutter (docs/assets.md, "Sprite layout"). */
export const BLOCK_CELL_STRIDE = 18;
const BLOCK_CELL_PIXELS = 16;
/** Tiles around a changed tile whose types decide how far its change reaches: the deepest relative chain is 5 steps. */
const DEPTH_REACH = 6;

/** A rectangle of a tile sheet, in sheet pixels. */
export interface SourceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The sheet rectangle of a packed cell (`column · 64 + row`, as frameRegion writes it); null for NO_CELL. */
export function blockSourceRect(cell: number): SourceRect | null {
  if (cell === NO_CELL) return null;
  return { x: (cell >> 6) * BLOCK_CELL_STRIDE, y: (cell & 63) * BLOCK_CELL_STRIDE, width: BLOCK_CELL_PIXELS, height: BLOCK_CELL_PIXELS };
}

/** What shapedPixel reads of a tile and the tiles around it (docs/assets.md, "Slopes and half blocks"). */
export interface ShapeContext {
  /** The tile's shape: 0 full, 1 half, 2–5 slopes. */
  readonly shape: number;
  /** The tile type's draw flags (TILE_DRAW_FLAGS). */
  readonly flags: number;
  /** Whether a solid tile that is not a half block lies below it. */
  readonly solidBelow: boolean;
  /** Whether half blocks lie left and right of it. */
  readonly halfLeft: boolean;
  readonly halfRight: boolean;
  /** Whether the tile above is the same content, not sloped at its bottom. */
  readonly joinedAbove: boolean;
}

/**
 * The sheet pixel a block whose cell's top-left lies at `origin` on its sheet shows at sprite pixel (x, y) of its tile,
 * or null where its shape cuts the tile away (docs/assets.md, "Slopes and half blocks"): a slope draws eight 2-pixel
 * columns of the cell slid along it and a 2-row strip of the cell in place over them; a half block the cell's upper
 * half in the tile's lower half, its bottom 4 rows from the sheet's half-block edge (144, 66) without a solid tile under
 * it; a full solid block beside half blocks takes the top half of its side or sides from the sheet's half-block corners.
 * The chunk shader applies the same rules.
 */
export function shapedPixel(context: ShapeContext, origin: readonly [number, number], x: number, y: number): readonly [number, number] | null {
  const { flags } = context;
  const shape = context.shape >= 2 && (flags & TILE_DRAW_FLAGS.noSlopes) !== 0 ? 0 : context.shape;
  const own = (dy = 0): readonly [number, number] => [origin[0] + x, origin[1] + y + dy];
  const column = x >> 1;
  const platform = (flags & TILE_DRAW_FLAGS.platform) !== 0;
  if (shape === 1) {
    if (y < 8) return null;
    return !platform && !context.solidBelow && y >= 12 ? [144 + x, 66 + y - 12] : own(-8);
  }
  if (shape >= 2 && shape <= 5 && !platform) {
    if (shape <= 3) {
      if (y >= 14) return own();
      const down = shape === 2 ? 2 * column : 14 - 2 * column;
      return y < down ? null : own(-down);
    }
    if (y < 2) return own();
    const up = shape === 4 ? 2 * column : 14 - 2 * column;
    return y >= 16 - up ? null : own(up);
  }
  const reshaped = TILE_DRAW_FLAGS.solid | TILE_DRAW_FLAGS.platform | TILE_DRAW_FLAGS.ignoresHalf | TILE_DRAW_FLAGS.notReallySolid;
  if (shape === 0 && y < 8 && (flags & reshaped) === TILE_DRAW_FLAGS.solid) {
    if (context.halfLeft && context.halfRight) return [(context.joinedAbove ? 90 : 126) + x, y];
    const corner = (flags & TILE_DRAW_FLAGS.smoothBorders) !== 0 ? 2 : 4;
    if (context.halfLeft && x < corner) return [(corner === 2 && y < 2 ? 148 : 144) + x, y];
    if (context.halfRight && x >= 16 - corner) return [(corner === 2 && y < 2 && x >= 14 ? 142 : 144) + x, y];
  }
  return own();
}

/**
 * The framed cells of a world's self-framed blocks, per chunk: each chunk's cell plane is framed once, on first use,
 * and kept until dropped (docs/assets.md, "Tile framing"). A chunk's cells read the tiles of its neighbours.
 */
export interface ChunkCellCache {
  readonly world: FramingWorld;
  /**
   * The cells of `chunk`, framed on first use: one per tile of the chunk (clipped to the world), column-major (index
   * (x − left) · rows + (y − top)), the packed cell `column · 64 + row` or NO_CELL. The array is the cache's own.
   */
  readonly cells: (chunk: ChunkCoord) => Uint16Array;
  readonly has: (chunk: ChunkCoord) => boolean;
  /** Forgets the cells of `chunk` (its next `cells` frames it again). */
  readonly drop: (chunk: ChunkCoord) => void;
  /** The cell of tile (x, y), framing its chunk on first use. */
  readonly cellAt: (x: number, y: number) => number;
  /**
   * Recomputes the cached cells around changed tiles, after the world's planes changed: per tile the (2d + 3)² area
   * around it, d the deepest `BlockFraming.depth` of the types within 6 tiles of it, and the cactus plants touching
   * its 3 × 3 (`BlockFraming.extent`). Chunks never framed are left to frame later. Returns the areas, clipped to the
   * world.
   */
  readonly invalidate: (tiles: Iterable<{ readonly x: number; readonly y: number }>) => readonly BlockRegion[];
  /** Tiles framed into the cache since creation. */
  readonly framedTiles: number;
}

export function createChunkCellCache(world: FramingWorld, framing: BlockFraming, chunkSize: number = CHUNK_SIZE): ChunkCellCache {
  const { width, height } = world;
  const chunksX = Math.ceil(width / chunkSize);
  const chunks = new Map<number, Uint16Array>();
  let framedTiles = 0;
  let scratch = new Uint16Array(0);

  const keyOf = (chunk: ChunkCoord): number => chunk.y * chunksX + chunk.x;
  const regionOf = (chunk: ChunkCoord): BlockRegion => {
    const left = chunk.x * chunkSize;
    const top = chunk.y * chunkSize;
    return { left, top, width: Math.min(chunkSize, width - left), height: Math.min(chunkSize, height - top) };
  };

  const cells = (chunk: ChunkCoord): Uint16Array => {
    const key = keyOf(chunk);
    const cached = chunks.get(key);
    if (cached !== undefined) return cached;
    const region = regionOf(chunk);
    const out = new Uint16Array(Math.max(0, region.width) * Math.max(0, region.height));
    if (out.length > 0) framing.frameRegion(world, region, out);
    framedTiles += out.length;
    chunks.set(key, out);
    return out;
  };

  /** The deepest framing depth among the types within DEPTH_REACH tiles of (x, y); −1 without self-framed blocks. */
  const depthAround = (x: number, y: number): number => {
    const { block } = world.planes;
    let depth = -1;
    for (let nx = Math.max(0, x - DEPTH_REACH); nx <= Math.min(width - 1, x + DEPTH_REACH); nx++) {
      for (let ny = Math.max(0, y - DEPTH_REACH); ny <= Math.min(height - 1, y + DEPTH_REACH); ny++) {
        const content = block[nx * height + ny] ?? 0xffff;
        const ref = content === 0xffff ? undefined : world.palette[content];
        if (ref?.kind === "vanilla") depth = Math.max(depth, framing.depth(ref.id));
      }
    }
    return depth;
  };

  const invalidate = (tiles: Iterable<{ readonly x: number; readonly y: number }>): readonly BlockRegion[] => {
    const regions: BlockRegion[] = [];
    for (const { x, y } of tiles) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const reach = Math.max(0, depthAround(x, y)) + 1;
      const left = Math.max(0, x - reach);
      const top = Math.max(0, y - reach);
      regions.push({
        left, top, width: Math.min(width, x + reach + 1) - left, height: Math.min(height, y + reach + 1) - top,
      });
      // A cactus plant touching the change: its every tile may take another cell.
      const plant = framing.extent(world, x, y);
      if (plant !== null) regions.push(plant);
    }
    // Each area is framed on its own (sparse edits never frame the box between them), clipped to every cached chunk
    // it covers; a tile that overlapping areas share is written once.
    const written = new Map<number, Uint8Array>();
    for (const region of regions) {
      const right = region.left + region.width;
      const bottom = region.top + region.height;
      for (let cx = Math.floor(region.left / chunkSize); cx * chunkSize < right; cx++) {
        for (let cy = Math.floor(region.top / chunkSize); cy * chunkSize < bottom; cy++) {
          const key = cy * chunksX + cx;
          const target = chunks.get(key);
          if (target === undefined) continue;
          const chunk = regionOf({ x: cx, y: cy });
          const left = Math.max(region.left, chunk.left);
          const top = Math.max(region.top, chunk.top);
          const box = {
            left, top,
            width: Math.min(right, chunk.left + chunk.width) - left, height: Math.min(bottom, chunk.top + chunk.height) - top,
          };
          let done = written.get(key);
          if (done === undefined) {
            done = new Uint8Array(chunk.width * chunk.height);
            written.set(key, done);
          }
          if (scratch.length < box.width * box.height) scratch = new Uint16Array(box.width * box.height);
          framing.frameRegion(world, box, scratch);
          for (let i = 0; i < box.width; i++) {
            for (let j = 0; j < box.height; j++) {
              const at = (box.left - chunk.left + i) * chunk.height + (box.top - chunk.top + j);
              if (done[at] === 1) continue;
              done[at] = 1;
              target[at] = scratch[i * box.height + j] ?? NO_CELL;
              framedTiles++;
            }
          }
        }
      }
    }
    return regions;
  };

  return {
    world,
    cells,
    has: (chunk) => chunks.has(keyOf(chunk)),
    drop: (chunk) => { chunks.delete(keyOf(chunk)); },
    cellAt: (x, y) => {
      const chunk = { x: Math.floor(x / chunkSize), y: Math.floor(y / chunkSize) };
      const region = regionOf(chunk);
      return cells(chunk)[(x - region.left) * region.height + (y - region.top)] ?? NO_CELL;
    },
    invalidate,
    get framedTiles() {
      return framedTiles;
    },
  };
}
