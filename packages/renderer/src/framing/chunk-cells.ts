import { CHUNK_SIZE } from "../camera/camera.js";
import type { ChunkCoord } from "../camera/camera.js";
import { NO_CELL } from "./frame-block.js";
import type { BlockFraming, BlockRegion, FramingWorld } from "./frame-block.js";

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

/**
 * One 2-pixel column of a shaped block: `height` cell rows from `sourceY` of cell column `sourceX`, drawn at tile
 * column `destX`, tile row `destY`. Offsets are relative to the cell's and the tile's top-left pixel.
 */
export interface ShapedColumn {
  readonly sourceX: number;
  readonly sourceY: number;
  readonly destX: number;
  readonly destY: number;
  readonly width: number;
  readonly height: number;
}

/** Per shape, column i → (sourceY, destY, height) (docs/assets.md, "Slopes and half blocks", drawing). */
const SHAPE_RULES: readonly ((i: number) => readonly [number, number, number])[] = [
  () => [0, 0, 16],
  // Half block: the upper half of the cell in the lower half of the tile.
  () => [0, 8, 8],
  // Slope cut at NE: rows 0 … 15 − 2i, moved down by 2i.
  (i) => [0, 2 * i, 16 - 2 * i],
  // Slope cut at NW: rows 0 … 2i + 1, moved down by 14 − 2i.
  (i) => [0, 14 - 2 * i, 2 * i + 2],
  // Slope cut at SE: rows 2i … 15, at the top.
  (i) => [2 * i, 0, 16 - 2 * i],
  // Slope cut at SW: rows 0 … 2i + 1, at the top.
  (i) => [0, 0, 2 * i + 2],
];

const SHAPED_COLUMNS: readonly (readonly ShapedColumn[])[] = SHAPE_RULES.map((rule) =>
  Array.from({ length: 8 }, (_, i) => {
    const [sourceY, destY, height] = rule(i);
    return { sourceX: 2 * i, sourceY, destX: 2 * i, destY, width: 2, height };
  }));

/**
 * How a block of `shape` (0 full, 1 half, 2–5 slopes; others are drawn full) draws its 16 × 16 cell: eight 2-pixel
 * columns. The chunk shader applies the same table.
 */
export function shapedColumns(shape: number): readonly ShapedColumn[] {
  return SHAPED_COLUMNS[shape] ?? SHAPED_COLUMNS[0] ?? [];
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
   * around it, d the deepest `BlockFraming.depth` of the types within 6 tiles of it. Chunks never framed are left to
   * frame later. Returns each tile's area, clipped to the world.
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
    // Per cached chunk: which of its tiles to recompute, so overlapping areas frame each tile once.
    const marks = new Map<number, Uint8Array>();
    for (const { x, y } of tiles) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const reach = Math.max(0, depthAround(x, y)) + 1;
      const left = Math.max(0, x - reach);
      const top = Math.max(0, y - reach);
      const region = {
        left, top, width: Math.min(width, x + reach + 1) - left, height: Math.min(height, y + reach + 1) - top,
      };
      regions.push(region);
      for (let tx = region.left; tx < region.left + region.width; tx++) {
        for (let ty = region.top; ty < region.top + region.height; ty++) {
          const key = Math.floor(ty / chunkSize) * chunksX + Math.floor(tx / chunkSize);
          if (!chunks.has(key)) continue;
          let mark = marks.get(key);
          if (mark === undefined) {
            mark = new Uint8Array(chunkSize * chunkSize);
            marks.set(key, mark);
          }
          mark[(tx % chunkSize) * chunkSize + (ty % chunkSize)] = 1;
        }
      }
    }
    for (const [key, mark] of marks) {
      const target = chunks.get(key);
      if (target === undefined) continue;
      const chunk = regionOf({ x: key % chunksX, y: Math.floor(key / chunksX) });
      // Frame the marked tiles' bounding box once, then copy only the marked tiles.
      let minX = chunkSize;
      let minY = chunkSize;
      let maxX = -1;
      let maxY = -1;
      for (let i = 0; i < chunk.width; i++) {
        for (let j = 0; j < chunk.height; j++) {
          if (mark[i * chunkSize + j] !== 1) continue;
          minX = Math.min(minX, i);
          minY = Math.min(minY, j);
          maxX = Math.max(maxX, i);
          maxY = Math.max(maxY, j);
        }
      }
      if (maxX < 0) continue;
      const box = { left: chunk.left + minX, top: chunk.top + minY, width: maxX - minX + 1, height: maxY - minY + 1 };
      if (scratch.length < box.width * box.height) scratch = new Uint16Array(box.width * box.height);
      framing.frameRegion(world, box, scratch);
      for (let i = minX; i <= maxX; i++) {
        for (let j = minY; j <= maxY; j++) {
          if (mark[i * chunkSize + j] !== 1) continue;
          target[i * chunk.height + j] = scratch[(i - minX) * box.height + (j - minY)] ?? NO_CELL;
          framedTiles++;
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
