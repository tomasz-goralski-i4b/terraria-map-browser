// Chunk residency: the page textures holding resident chunks' planes and framed cells, their LRU, and the uploads into
// them. The frame policy (what to upload when, within which budget) stays in the map renderer.
/// <reference lib="dom" />

import { CHUNK_SIZE } from "../camera/camera.js";
import type { ChunkCoord } from "../camera/camera.js";
import { NO_CELL } from "../framing/cells.js";
import { createChunkCellCache, type ChunkCellCache } from "../framing/chunk-cells.js";
import { createChunkWallCellCache, type ChunkWallCellCache } from "../framing/chunk-wall-cells.js";
import type { BlockFraming } from "../framing/frame-block.js";
import { chunkGrid, union, type Area } from "./chunk-grid.js";
import { UNIT, arrayTexture, bindTexture, defaultUnpack, requireValue, type Counters, type GpuPart, type UnpackState } from "./gl.js";
import {
  CELLS_INSTANCE_BIT, LAYER_ATTRIBUTE, PAGE_APRON, PLANES_16, PLANES_8, PLANE_COUNT_16, PLANE_COUNT_8, PRESENT, RECT_ATTRIBUTE,
  WALLS_INSTANCE_BIT,
} from "./shaders.js";
import type { RenderableWorld } from "./types.js";

/**
 * Chunks per page. A page holds one layer per plane and chunk: 32 × 7 = 224 layers of the 16-bit texture and
 * 32 × 5 = 160 of the 8-bit one, within the 256 array layers WebGL2 guarantees, with room for one more 16-bit
 * plane (32 × 8 = 256). A page of both textures is about 9.8 MiB.
 */
export const CHUNKS_PER_PAGE = 32;
/** Texels per side of a page layer: the chunk and its apron of neighbouring tiles on every side. */
export const PAGE_SIZE: number = CHUNK_SIZE + 2 * PAGE_APRON;
/** Ints per instance: the chunk rectangle (origin x, origin y, columns, rows) and its page layer. */
const INSTANCE_INTS = 5;

/** A chunk and the page slot it is resident in. */
export type Resident = readonly [chunk: ChunkCoord, slot: number];

/** One array texture per plane format, holding up to CHUNKS_PER_PAGE chunks with their aprons, a layer per plane. */
interface Page {
  /** R16UI, PLANES_16 per chunk: block, wall, flags, frameX, frameY, framed block cell, framed wall cell. */
  readonly planes16: WebGLTexture;
  /** R8UI, PLANES_8 per chunk: liquid kind, liquid amount, block paint, wall paint, block shape. */
  readonly planes8: WebGLTexture;
}

/** One plane of a world as uploaded: its layer within a chunk's layers and the memory read in place. */
interface PlaneSource {
  readonly plane: number;
  readonly data: Uint16Array | Uint8Array;
}

/** The planes of one world, by page texture. */
interface WorldPlanes {
  readonly world: RenderableWorld;
  readonly planes16: readonly PlaneSource[];
  readonly planes8: readonly PlaneSource[];
  /** PRESENT bits of the optional planes. */
  readonly present: number;
}

/** The planes of `source` to upload, by page texture; the frame planes as Uint16Array views of their memory. */
function planesOf(source: RenderableWorld): WorldPlanes {
  const { block, wall, flags, frameX, frameY, liquid, liquidAmount, paint, wallPaint, shape } = source.planes;
  const bits = (frame: Int16Array): Uint16Array => new Uint16Array(frame.buffer, frame.byteOffset, frame.length);
  const planes16: PlaneSource[] = [{ plane: PLANES_16.block, data: block }, { plane: PLANES_16.wall, data: wall }];
  let present = 0;
  if (flags !== undefined) {
    planes16.push({ plane: PLANES_16.flags, data: flags });
    present |= PRESENT.flags;
  }
  if (frameX !== undefined) {
    planes16.push({ plane: PLANES_16.frameX, data: bits(frameX) });
    present |= PRESENT.frameX;
  }
  if (frameY !== undefined) {
    planes16.push({ plane: PLANES_16.frameY, data: bits(frameY) });
    present |= PRESENT.frameY;
  }
  const planes8: PlaneSource[] = [
    { plane: PLANES_8.liquid, data: liquid }, { plane: PLANES_8.liquidAmount, data: liquidAmount },
    { plane: PLANES_8.paint, data: paint }, { plane: PLANES_8.wallPaint, data: wallPaint },
  ];
  if (shape !== undefined) {
    planes8.push({ plane: PLANES_8.shape, data: shape });
    present |= PRESENT.shape;
  }
  return { world: source, planes16, planes8, present };
}

export interface ChunkStore extends GpuPart {
  /** Resident chunks. */
  readonly size: () => number;
  /** Chunks the cache holds before it evicts; grows (`grow`) to fit the largest set drawn chunk by chunk. */
  readonly capacity: () => number;
  readonly grow: (count: number) => void;
  /** Chunks evicted since creation. */
  readonly evicted: () => number;
  /** Tiles and wall cells framed since creation (MapRendererStats.framedTiles, framedWalls). */
  readonly framedTiles: () => number;
  readonly framedWalls: () => number;
  /** PRESENT bits of the current world's optional planes. */
  readonly present: () => number;
  /** Drops every chunk and the plane sources: the world changed (capacity back to its baseline). */
  readonly setWorld: (world: RenderableWorld | null) => void;
  /** Lets go of the framed cells: the next sprite-mode upload frames chunks again. */
  readonly setFraming: (framing: BlockFraming | null) => void;
  /** The slot of a resident chunk, without touching the LRU order. */
  readonly slotOf: (key: number) => number | undefined;
  /** Marks a resident chunk as the most recently used. */
  readonly use: (key: number, slot: number) => void;
  /** Evicts least recently used chunks outside `keep` until `count` more fit the cache. */
  readonly makeRoom: (count: number, keep: ReadonlySet<number>) => void;
  /** Evicts the least recently used chunk outside `keep`; false when every chunk is in it. */
  readonly evictOne: (keep: ReadonlySet<number>) => boolean;
  /** Uploads `chunk` into a free slot (call makeRoom first) as the most recently used; returns the slot. */
  readonly insert: (chunk: ChunkCoord, key: number) => number;
  /** The changed tiles of resident chunks (invalidateTiles), uploaded again on their next draw. */
  readonly isDirty: (key: number) => boolean;
  readonly markDirty: (key: number, area: Area) => void;
  /** Uploads the changed part of a dirty chunk into its slot, and of its cells if the slot holds them. */
  readonly refresh: (chunk: ChunkCoord, key: number, slot: number) => void;
  /** Whether the slot's cell layers hold its chunk's current cells. */
  readonly isFramed: (slot: number) => boolean;
  /** Frames `chunk` (once; cached while resident) and uploads its cells into the slot's cell layers. No-op without a framing. */
  readonly frame: (chunk: ChunkCoord, slot: number) => void;
  /** Recomputes the cached cells around changed tiles; returns the block and wall cell areas recomputed. */
  readonly invalidateCells: (tiles: readonly { readonly x: number; readonly y: number }[]) => {
    readonly blocks: readonly { left: number; top: number; width: number; height: number }[];
    readonly walls: readonly { left: number; top: number; width: number; height: number }[];
  };
  /**
   * Draws `items` with the current program: one instanced draw call per page, the page textures bound. Its instance
   * buffer is kept for the same `items` array (INSTANCE_BUFFERS), so drawing it again in the same frame uploads nothing.
   */
  readonly draw: (items: readonly Resident[]) => number;
  /**
   * Draws instances the caller wrote into `buffer` (`count` of them, sorted by page, page runs in `runs` as
   * [page, first instance]) with the bound vertex array; `pointers(first)` sets the attribute pointers of a run.
   */
  readonly drawRuns: (
    runs: readonly (readonly [page: number, first: number])[], count: number, pointers: (first: number) => void,
  ) => number;
  /** The page layer of a slot with its CELLS_INSTANCE_BIT and WALLS_INSTANCE_BIT, as the chunk vertex shader reads it. */
  readonly layerOf: (slot: number) => number;
}

/**
 * Instance buffers kept at once: the chunks a frame draws and one subset of them (the liquid overlay pass's) keep
 * theirs, so the strips of a reused frame and the highlight pass draw them without uploading them again.
 */
const INSTANCE_BUFFERS = 2;

/** An instance buffer and the items it holds (null: stale), with their page runs. */
interface InstanceBuffer {
  readonly buffer: WebGLBuffer;
  readonly array: WebGLVertexArrayObject;
  items: readonly Resident[] | null;
  runs: readonly (readonly [number, number])[];
}

/** The chunk pass's vertex array: the chunk rectangle and page layer per instance; pointers set per draw. */
function instanceArray(gl: WebGL2RenderingContext, buffer: WebGLBuffer): WebGLVertexArrayObject {
  const array = requireValue(gl.createVertexArray(), "a vertex array");
  gl.bindVertexArray(array);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const location of [RECT_ATTRIBUTE, LAYER_ATTRIBUTE]) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribDivisor(location, 1);
  }
  gl.bindVertexArray(null);
  return array;
}

export function createChunkStore(
  gl: WebGL2RenderingContext, unpack: UnpackState, counters: Counters, baseCapacity: number,
): ChunkStore {
  let world: RenderableWorld | null = null;
  let planes: WorldPlanes | null = null;
  let capacity = baseCapacity;
  // LRU of chunk key → page slot (page * CHUNKS_PER_PAGE + slot in page): Map iteration order is insertion order, and
  // a hit re-inserts its key at the end.
  const chunks = new Map<number, number>();
  const pages: Page[] = [];
  const freeSlots: number[] = [];
  let nextSlot = 0;
  let evicted = 0;
  // Resident chunks whose planes changed, with the world tiles that changed in their layers (right and bottom
  // exclusive): uploaded again on their next draw, that rectangle only.
  const dirty = new Map<number, Area>();
  // Self-framed blocks and walls: the framing, the framed cells of the current world's resident chunks, and the slots
  // whose cell layers hold their chunk's current cells. Tiles framed by caches already let go are kept in the
  // framed…Before counts.
  let framing: BlockFraming | null = null;
  let cellCache: ChunkCellCache | null = null;
  let wallCache: ChunkWallCellCache | null = null;
  let framedBefore = 0;
  let framedWallsBefore = 0;
  const framedSlots = new Set<number>();
  // The framed slots whose wall cell layer holds any wall cell (WALLS_INSTANCE_BIT).
  const wallSlots = new Set<number>();
  let instanceData = new Int32Array(INSTANCE_INTS * 256);
  // The instance buffers, least recently drawn first.
  let instances: InstanceBuffer[] = [];
  /** The slots' layers changed: no instance buffer may be drawn again as it is. */
  const staleInstances = (): void => {
    for (const entry of instances) entry.items = null;
  };

  const coordOf = (key: number): ChunkCoord => chunkGrid(requireWorld()).coordOf(key);

  const releaseCells = (): void => {
    framedBefore += cellCache?.framedTiles ?? 0;
    framedWallsBefore += wallCache?.framedTiles ?? 0;
    cellCache = null;
    wallCache = null;
    framedSlots.clear();
    wallSlots.clear();
    staleInstances();
  };

  /** Forgets every chunk; their page textures are deleted by the caller (or died with the context). */
  const forget = (): void => {
    pages.length = 0;
    chunks.clear();
    freeSlots.length = 0;
    nextSlot = 0;
    dirty.clear();
    releaseCells();
  };

  const deletePages = (): void => {
    for (const page of pages) {
      gl.deleteTexture(page.planes16);
      gl.deleteTexture(page.planes8);
    }
  };

  const pageOf = (slot: number): Page => {
    const page = pages[Math.floor(slot / CHUNKS_PER_PAGE)];
    if (page === undefined) throw new Error(`chunk slot ${String(slot)} has no page`);
    return page;
  };

  const allocateSlot = (): number => {
    const free = freeSlots.pop();
    if (free !== undefined) return free;
    const slot = nextSlot++;
    if (slot >= pages.length * CHUNKS_PER_PAGE) {
      gl.activeTexture(gl.TEXTURE0 + UNIT.planes16);
      const planes16 = arrayTexture(gl, gl.R16UI, PAGE_SIZE, CHUNKS_PER_PAGE * PLANE_COUNT_16);
      gl.activeTexture(gl.TEXTURE0 + UNIT.planes8);
      const planes8 = arrayTexture(gl, gl.R8UI, PAGE_SIZE, CHUNKS_PER_PAGE * PLANE_COUNT_8);
      pages.push({ planes16, planes8 });
    }
    return slot;
  };

  const requireWorld = (): RenderableWorld => {
    if (world === null) throw new Error("no world is set");
    return world;
  };

  const planesOfWorld = (): WorldPlanes => {
    const source = requireWorld();
    if (planes?.world !== source) planes = planesOf(source);
    return planes;
  };

  /**
   * Uploads one chunk, with its apron of neighbouring tiles, into its page layers: one texSubImage3D per present plane,
   * read in place from the world's plane. A chunk is a rectangle of a column-major plane and a layer stores it
   * transposed, so the unpack parameters select it: an upload row is a world column (UNPACK_ROW_LENGTH is the world's
   * height, UNPACK_IMAGE_HEIGHT its width), starting at the chunk's first column (UNPACK_SKIP_ROWS) and first row
   * (UNPACK_SKIP_PIXELS). No tile is touched in JavaScript. With `area` (world tiles, after an edit) only the part of
   * the layers inside it, and the slot's cell layers stay as they are (uploadCellArea updates them).
   */
  const uploadChunk = (chunk: ChunkCoord, slot: number, area?: Area): void => {
    const source = requireWorld();
    const originX = chunk.x * CHUNK_SIZE;
    const originY = chunk.y * CHUNK_SIZE;
    // The apron, clipped to the world: texels past the world's edges keep stale values the shaders never read.
    let firstColumn = Math.max(-PAGE_APRON, -originX);
    let endColumn = Math.min(CHUNK_SIZE + PAGE_APRON, source.width - originX);
    let firstRow = Math.max(-PAGE_APRON, -originY);
    let endRow = Math.min(CHUNK_SIZE + PAGE_APRON, source.height - originY);
    if (area !== undefined) {
      firstColumn = Math.max(firstColumn, area.left - originX);
      endColumn = Math.min(endColumn, area.right - originX);
      firstRow = Math.max(firstRow, area.top - originY);
      endRow = Math.min(endRow, area.bottom - originY);
      if (endColumn <= firstColumn || endRow <= firstRow) return;
    }
    const page = pageOf(slot);
    const inPage = slot % CHUNKS_PER_PAGE;
    const { planes16, planes8 } = planesOfWorld();
    unpack.forWorld(source);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, originY + firstRow);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, originX + firstColumn);
    const upload = (sources: readonly PlaneSource[], count: number, type: number): void => {
      for (const { plane, data } of sources) {
        gl.texSubImage3D(
          gl.TEXTURE_2D_ARRAY, 0, firstRow + PAGE_APRON, firstColumn + PAGE_APRON, inPage * count + plane,
          endRow - firstRow, endColumn - firstColumn, 1, gl.RED_INTEGER, type, data,
        );
      }
    };
    bindTexture(gl, UNIT.planes16, gl.TEXTURE_2D_ARRAY, page.planes16);
    upload(planes16, PLANE_COUNT_16, gl.UNSIGNED_SHORT);
    bindTexture(gl, UNIT.planes8, gl.TEXTURE_2D_ARRAY, page.planes8);
    upload(planes8, PLANE_COUNT_8, gl.UNSIGNED_BYTE);
    counters.textureUploads++;
    // The slot's cell layer still holds the cells of whatever was there before.
    if (area === undefined) {
      framedSlots.delete(slot);
      staleInstances();
    }
  };

  /** The framed cells of the world's chunks, blocks and walls; null without a framing. */
  const cellsOf = (): { blocks: ChunkCellCache; walls: ChunkWallCellCache } | null => {
    if (framing === null) return null;
    const source = requireWorld();
    if (cellCache === null || wallCache === null || cellCache.world !== source) {
      releaseCells();
      cellCache = createChunkCellCache(source, framing);
      wallCache = createChunkWallCellCache(source, framing.walls, CHUNK_SIZE, PAGE_APRON);
    }
    return { blocks: cellCache, walls: wallCache };
  };

  const noteWalls = (slot: number, walls: Uint16Array): void => {
    if (walls.some((cell) => cell !== NO_CELL)) wallSlots.add(slot);
    else wallSlots.delete(slot);
    staleInstances();
  };

  /**
   * Uploads the framed cells of `chunk` (framing it on first use) into the cell layers of its slot: the chunk's block
   * cells without the apron, which the sprite pass never reads for blocks, and its wall cells with the apron, whose
   * overhang reaches into the chunk (the whole layer: NO_CELL past the world's edges). One texture upload.
   */
  const uploadCells = (chunk: ChunkCoord, slot: number): void => {
    const caches = cellsOf();
    if (caches === null) return;
    const source = requireWorld();
    const page = pageOf(slot);
    const cells = caches.blocks.cells(chunk);
    const columns = Math.min(CHUNK_SIZE, source.width - chunk.x * CHUNK_SIZE);
    const rows = Math.min(CHUNK_SIZE, source.height - chunk.y * CHUNK_SIZE);
    const layer = (slot % CHUNKS_PER_PAGE) * PLANE_COUNT_16;
    unpack.reset();
    // Column-major cells are the transposed layer's rows: `rows` cells each, 2-byte aligned.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    bindTexture(gl, UNIT.planes16, gl.TEXTURE_2D_ARRAY, page.planes16);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY, 0, PAGE_APRON, PAGE_APRON, layer + PLANES_16.cell,
      rows, columns, 1, gl.RED_INTEGER, gl.UNSIGNED_SHORT, cells,
    );
    const walls = caches.walls.cells(chunk);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer + PLANES_16.wallCell, PAGE_SIZE, PAGE_SIZE, 1, gl.RED_INTEGER,
      gl.UNSIGNED_SHORT, walls,
    );
    noteWalls(slot, walls);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    counters.textureUploads++;
    framedSlots.add(slot);
  };

  /**
   * Uploads the framed cells of `chunk` inside `area` (world tiles), recomputed after an edit, into its slot's cell
   * layers, which hold the rest of its current cells (framedSlots): the block cells inside the chunk and the wall
   * cells inside its layer, apron included. The unpack parameters select the rectangle of the column-major arrays.
   */
  const uploadCellArea = (chunk: ChunkCoord, slot: number, area: Area): void => {
    const caches = cellsOf();
    if (caches === null) return;
    const source = requireWorld();
    const page = pageOf(slot);
    const originX = chunk.x * CHUNK_SIZE;
    const originY = chunk.y * CHUNK_SIZE;
    const layer = (slot % CHUNKS_PER_PAGE) * PLANE_COUNT_16;
    unpack.reset();
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    bindTexture(gl, UNIT.planes16, gl.TEXTURE_2D_ARRAY, page.planes16);
    /** Uploads columns [c0, c1) × rows [r0, r1) of a column-major array of `rows` rows, `offset` texels into the layer. */
    const part = (
      plane: number, cells: Uint16Array, rows: number, offset: number, c0: number, c1: number, r0: number, r1: number,
    ): boolean => {
      if (c1 <= c0 || r1 <= r0) return false;
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, rows);
      // A 3D upload must fit its skipped rows within the image height: the array's columns.
      gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, cells.length / rows);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, r0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, c0);
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY, 0, offset + r0, offset + c0, layer + plane, r1 - r0, c1 - c0, 1, gl.RED_INTEGER,
        gl.UNSIGNED_SHORT, cells,
      );
      return true;
    };
    const columns = Math.min(CHUNK_SIZE, source.width - originX);
    const rows = Math.min(CHUNK_SIZE, source.height - originY);
    const blocks = part(
      PLANES_16.cell, caches.blocks.cells(chunk), rows, PAGE_APRON,
      Math.max(0, area.left - originX), Math.min(columns, area.right - originX),
      Math.max(0, area.top - originY), Math.min(rows, area.bottom - originY),
    );
    const walls = caches.walls.cells(chunk);
    const wallsUploaded = part(
      PLANES_16.wallCell, walls, PAGE_SIZE, 0,
      Math.max(0, area.left - originX + PAGE_APRON), Math.min(PAGE_SIZE, area.right - originX + PAGE_APRON),
      Math.max(0, area.top - originY + PAGE_APRON), Math.min(PAGE_SIZE, area.bottom - originY + PAGE_APRON),
    );
    defaultUnpack(gl);
    if (blocks || wallsUploaded) counters.textureUploads++;
    // A wall cell may have appeared where the chunk had none.
    noteWalls(slot, walls);
  };

  const layerOf = (slot: number): number => (slot % CHUNKS_PER_PAGE) | (framedSlots.has(slot)
    ? CELLS_INSTANCE_BIT | (wallSlots.has(slot) ? WALLS_INSTANCE_BIT : 0)
    : 0);

  const drawRuns: ChunkStore["drawRuns"] = (runs, count, pointers) => {
    let calls = 0;
    runs.forEach(([pageIndex, first], index) => {
      const end = runs[index + 1]?.[1] ?? count;
      const page = pages[pageIndex];
      if (page === undefined) return;
      bindTexture(gl, UNIT.planes16, gl.TEXTURE_2D_ARRAY, page.planes16);
      bindTexture(gl, UNIT.planes8, gl.TEXTURE_2D_ARRAY, page.planes8);
      // No base instance in WebGL2: each page's instances start at an attribute offset.
      pointers(first);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, end - first);
      calls++;
    });
    return calls;
  };

  return {
    size: () => chunks.size,
    capacity: () => capacity,
    grow: (count) => { capacity = Math.max(capacity, count); },
    evicted: () => evicted,
    framedTiles: () => framedBefore + (cellCache?.framedTiles ?? 0),
    framedWalls: () => framedWallsBefore + (wallCache?.framedTiles ?? 0),
    present: () => (world === null ? 0 : planesOfWorld().present),
    setWorld: (next) => {
      if (!gl.isContextLost()) deletePages();
      forget();
      capacity = baseCapacity;
      planes = null;
      world = next;
    },
    setFraming: (next) => {
      releaseCells();
      framing = next;
    },
    slotOf: (key) => chunks.get(key),
    use: (key, slot) => {
      chunks.delete(key);
      chunks.set(key, slot);
    },
    makeRoom: (count, keep) => {
      for (const [key, slot] of chunks) {
        if (chunks.size + count <= capacity) break;
        if (keep.has(key)) continue;
        chunks.delete(key);
        freeSlots.push(slot);
        evicted++;
        dirty.delete(key);
        cellCache?.drop(coordOf(key));
        wallCache?.drop(coordOf(key));
        // Its slot is filled again: no instance buffer drawn before may be drawn again.
        staleInstances();
      }
    },
    evictOne: (keep) => {
      for (const [key, slot] of chunks) {
        if (keep.has(key)) continue;
        chunks.delete(key);
        freeSlots.push(slot);
        evicted++;
        dirty.delete(key);
        cellCache?.drop(coordOf(key));
        wallCache?.drop(coordOf(key));
        // Its slot is filled again: no instance buffer drawn before may be drawn again.
        staleInstances();
        return true;
      }
      return false;
    },
    insert: (chunk, key) => {
      const slot = allocateSlot();
      uploadChunk(chunk, slot);
      dirty.delete(key);
      chunks.set(key, slot);
      return slot;
    },
    isDirty: (key) => dirty.has(key),
    markDirty: (key, area) => {
      if (!chunks.has(key)) return;
      dirty.set(key, union(dirty.get(key), area));
    },
    refresh: (chunk, key, slot) => {
      const area = dirty.get(key);
      if (area === undefined) return;
      uploadChunk(chunk, slot, area);
      if (framedSlots.has(slot)) uploadCellArea(chunk, slot, area);
      dirty.delete(key);
    },
    isFramed: (slot) => framedSlots.has(slot),
    frame: uploadCells,
    invalidateCells: (tiles) => ({
      blocks: cellCache !== null && cellCache.world === world ? cellCache.invalidate(tiles) : [],
      walls: wallCache !== null && wallCache.world === world ? wallCache.invalidate(tiles) : [],
    }),
    draw: (items) => {
      if (items.length === 0) return 0;
      let held = instances.find((entry) => entry.items === items);
      if (held === undefined) {
        // A new buffer while there is room, else the least recently drawn one.
        if (instances.length < INSTANCE_BUFFERS) {
          const buffer = requireValue(gl.createBuffer(), "a buffer");
          held = { buffer, array: instanceArray(gl, buffer), items: null, runs: [] };
        } else {
          held = instances[0];
          if (held === undefined) throw new Error("no instance buffer");
        }
        gl.bindVertexArray(held.array);
        gl.bindBuffer(gl.ARRAY_BUFFER, held.buffer);
        const sorted = [...items].sort((first, second) => first[1] - second[1]);
        if (instanceData.length < sorted.length * INSTANCE_INTS) instanceData = new Int32Array(sorted.length * INSTANCE_INTS * 2);
        const source = requireWorld();
        const runs: (readonly [number, number])[] = [];
        sorted.forEach(([chunk, slot], index) => {
          const page = Math.floor(slot / CHUNKS_PER_PAGE);
          if (runs.at(-1)?.[0] !== page) runs.push([page, index]);
          const originX = chunk.x * CHUNK_SIZE;
          const originY = chunk.y * CHUNK_SIZE;
          const at = index * INSTANCE_INTS;
          instanceData[at] = originX;
          instanceData[at + 1] = originY;
          instanceData[at + 2] = Math.min(CHUNK_SIZE, source.width - originX);
          instanceData[at + 3] = Math.min(CHUNK_SIZE, source.height - originY);
          instanceData[at + 4] = layerOf(slot);
        });
        gl.bufferData(gl.ARRAY_BUFFER, instanceData.subarray(0, sorted.length * INSTANCE_INTS), gl.STREAM_DRAW);
        held.items = items;
        held.runs = runs;
      } else {
        gl.bindVertexArray(held.array);
        gl.bindBuffer(gl.ARRAY_BUFFER, held.buffer);
      }
      // Most recently drawn last.
      instances = [...instances.filter((entry) => entry !== held), held];
      const stride = INSTANCE_INTS * 4;
      const calls = drawRuns(held.runs, items.length, (first) => {
        gl.vertexAttribIPointer(RECT_ATTRIBUTE, 4, gl.INT, stride, first * stride);
        gl.vertexAttribIPointer(LAYER_ATTRIBUTE, 1, gl.INT, stride, first * stride + 16);
      });
      gl.bindVertexArray(null);
      return calls;
    },
    drawRuns,
    layerOf,
    lost: () => {
      forget();
      instances = [];
    },
    release: () => {
      deletePages();
      forget();
      for (const entry of instances) {
        gl.deleteBuffer(entry.buffer);
        gl.deleteVertexArray(entry.array);
      }
      instances = [];
      planes = null;
      world = null;
    },
  };
}
