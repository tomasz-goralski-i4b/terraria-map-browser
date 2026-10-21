// A world's chunk grid as every per-chunk cache and the overview index it: keys, neighbourhoods, the chunks around a
// view and their distance order, and rectangles of tiles.
import { CHUNK_SIZE, visibleChunks } from "../camera/camera.js";
import type { Camera, ChunkCoord, Size } from "../camera/camera.js";

/** The chunks of a world, keyed row-major (`y * columns + x`). */
export interface ChunkGrid {
  readonly columns: number;
  readonly rows: number;
  readonly keyOf: (chunk: ChunkCoord) => number;
  readonly coordOf: (key: number) => ChunkCoord;
  /** The key of the chunk holding tile (x, y). */
  readonly keyAt: (x: number, y: number) => number;
  /** The keys of `chunk` and its neighbours (3 × 3) inside the world. */
  readonly around: (chunk: ChunkCoord) => number[];
}

const grids = new WeakMap<object, ChunkGrid>();

/** The chunk grid of a world (cached per world object). */
export function chunkGrid(world: { readonly width: number; readonly height: number }): ChunkGrid {
  const cached = grids.get(world);
  if (cached !== undefined) return cached;
  const columns = Math.ceil(world.width / CHUNK_SIZE);
  const rows = Math.ceil(world.height / CHUNK_SIZE);
  const grid: ChunkGrid = {
    columns, rows,
    keyOf: (chunk) => chunk.y * columns + chunk.x,
    coordOf: (key) => ({ x: key % columns, y: Math.floor(key / columns) }),
    keyAt: (x, y) => Math.floor(y / CHUNK_SIZE) * columns + Math.floor(x / CHUNK_SIZE),
    around: (chunk) => {
      const keys: number[] = [];
      for (let y = Math.max(0, chunk.y - 1); y <= Math.min(rows - 1, chunk.y + 1); y++) {
        for (let x = Math.max(0, chunk.x - 1); x <= Math.min(columns - 1, chunk.x + 1); x++) keys.push(y * columns + x);
      }
      return keys;
    },
  };
  grids.set(world, grid);
  return grid;
}

/** The chunks within `margin` tiles around the view of `camera` over `viewport`. */
export function chunksAround(
  camera: Camera, viewport: Size, world: { readonly width: number; readonly height: number }, margin: number,
): ChunkCoord[] {
  return visibleChunks(
    { x: camera.x - margin, y: camera.y - margin, zoom: camera.zoom },
    { width: viewport.width + 2 * margin * camera.zoom, height: viewport.height + 2 * margin * camera.zoom },
    world,
  );
}

/** Sorts `chunks` in place by distance from the centre of the view of `camera` over `viewport`; the sort is stable. */
export function byDistance<T extends ChunkCoord>(chunks: T[], camera: Camera, viewport: Size): T[] {
  const centreX = camera.x + viewport.width / (2 * camera.zoom);
  const centreY = camera.y + viewport.height / (2 * camera.zoom);
  const distance = (chunk: T): number => Math.hypot((chunk.x + 0.5) * CHUNK_SIZE - centreX, (chunk.y + 0.5) * CHUNK_SIZE - centreY);
  return chunks.sort((first, second) => distance(first) - distance(second));
}

/** A rectangle of world tiles; right and bottom exclusive. */
export interface Area {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The smallest area holding `first` (if any) and `second`. */
export function union(first: Area | undefined, second: Area): Area {
  if (first === undefined) return second;
  return {
    left: Math.min(first.left, second.left), top: Math.min(first.top, second.top),
    right: Math.max(first.right, second.right), bottom: Math.max(first.bottom, second.bottom),
  };
}
