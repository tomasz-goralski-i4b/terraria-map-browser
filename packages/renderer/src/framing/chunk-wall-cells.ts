import { CHUNK_SIZE } from "../camera/camera.js";
import type { ChunkCoord } from "../camera/camera.js";
import { NO_CELL } from "./cells.js";
import type { BlockRegion } from "./cells.js";
import type { WallFraming, WallFramingWorld } from "./frame-wall.js";

/**
 * The framed cells of a world's walls, per chunk and its apron: a wall's cell reaches 8 pixels into its neighbours, so
 * a chunk draws the walls of the tiles around it too. Each chunk is framed once, on first use, and kept until dropped.
 */
export interface ChunkWallCellCache {
  readonly world: WallFramingWorld;
  /** Cells per side of a chunk's array: the chunk size and the apron on both sides. */
  readonly side: number;
  /**
   * The cells of `chunk` (inside the world's chunk grid) and its apron, framed on first use: `side` × `side`, column-major (index
   * (x − left + apron) · side + (y − top + apron)), the packed cell or NO_CELL (also past the world's edges). The
   * array is the cache's own.
   */
  readonly cells: (chunk: ChunkCoord) => Uint16Array;
  readonly has: (chunk: ChunkCoord) => boolean;
  /** Forgets the cells of `chunk` (its next `cells` frames it again). */
  readonly drop: (chunk: ChunkCoord) => void;
  /** The cell of tile (x, y), framing its chunk on first use; NO_CELL outside the world. */
  readonly cellAt: (x: number, y: number) => number;
  /**
   * Recomputes the cached cells around changed tiles, after the world's planes changed: per tile its 3 × 3 area (a
   * wall's cell reads its four sides only), in every cached chunk whose array holds part of it. Chunks never framed are
   * left to frame later. Returns each tile's area, clipped to the world.
   */
  readonly invalidate: (tiles: Iterable<{ readonly x: number; readonly y: number }>) => readonly BlockRegion[];
  /** Tiles framed into the cache since creation (apron tiles inside the world included). */
  readonly framedTiles: number;
}

export function createChunkWallCellCache(
  world: WallFramingWorld, framing: WallFraming, chunkSize: number = CHUNK_SIZE, apron = 1,
): ChunkWallCellCache {
  const { width, height } = world;
  const chunksX = Math.ceil(width / chunkSize);
  const chunksY = Math.ceil(height / chunkSize);
  const side = chunkSize + 2 * apron;
  const chunks = new Map<number, Uint16Array>();
  let framedTiles = 0;

  const keyOf = (chunk: ChunkCoord): number => chunk.y * chunksX + chunk.x;

  const cells = (chunk: ChunkCoord): Uint16Array => {
    const key = keyOf(chunk);
    const cached = chunks.get(key);
    if (cached !== undefined) return cached;
    const out = new Uint16Array(side * side).fill(NO_CELL);
    const left = chunk.x * chunkSize - apron;
    const top = chunk.y * chunkSize - apron;
    for (let i = Math.max(0, -left); i < Math.min(side, width - left); i++) {
      for (let j = Math.max(0, -top); j < Math.min(side, height - top); j++) {
        out[i * side + j] = framing.cellAt(world, left + i, top + j);
        framedTiles++;
      }
    }
    chunks.set(key, out);
    return out;
  };

  const invalidate = (tiles: Iterable<{ readonly x: number; readonly y: number }>): readonly BlockRegion[] => {
    const regions: BlockRegion[] = [];
    // Per cached chunk, the tiles already written by an earlier area of this call: overlapping areas write each once.
    const written = new Map<number, Uint8Array>();
    for (const { x, y } of tiles) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const left = Math.max(0, x - 1);
      const top = Math.max(0, y - 1);
      const region = { left, top, width: Math.min(width, x + 2) - left, height: Math.min(height, y + 2) - top };
      regions.push(region);
      const right = region.left + region.width;
      const bottom = region.top + region.height;
      const lastX = Math.min(chunksX - 1, Math.floor((right - 1 + apron) / chunkSize));
      const lastY = Math.min(chunksY - 1, Math.floor((bottom - 1 + apron) / chunkSize));
      for (let cx = Math.max(0, Math.floor((region.left - apron) / chunkSize)); cx <= lastX; cx++) {
        for (let cy = Math.max(0, Math.floor((region.top - apron) / chunkSize)); cy <= lastY; cy++) {
          const key = cy * chunksX + cx;
          const target = chunks.get(key);
          if (target === undefined) continue;
          let done = written.get(key);
          if (done === undefined) {
            done = new Uint8Array(side * side);
            written.set(key, done);
          }
          const originX = cx * chunkSize - apron;
          const originY = cy * chunkSize - apron;
          for (let tx = Math.max(region.left, originX); tx < Math.min(right, originX + side); tx++) {
            for (let ty = Math.max(region.top, originY); ty < Math.min(bottom, originY + side); ty++) {
              const at = (tx - originX) * side + (ty - originY);
              if (done[at] === 1) continue;
              done[at] = 1;
              target[at] = framing.cellAt(world, tx, ty);
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
    side,
    cells,
    has: (chunk) => chunks.has(keyOf(chunk)),
    drop: (chunk) => { chunks.delete(keyOf(chunk)); },
    cellAt: (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return NO_CELL;
      const chunk = { x: Math.floor(x / chunkSize), y: Math.floor(y / chunkSize) };
      return cells(chunk)[(x - chunk.x * chunkSize + apron) * side + (y - chunk.y * chunkSize + apron)] ?? NO_CELL;
    },
    invalidate,
    get framedTiles() {
      return framedTiles;
    },
  };
}
