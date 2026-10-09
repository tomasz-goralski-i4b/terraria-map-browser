import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createWorld, type BlockShape, type CanonicalWorld } from "@studio/world-model";
import {
  CHUNK_SIZE, NO_CELL, SPRITE_MIN_ZOOM, createBlockFraming, createChunkCellCache, createChunkWallCellCache,
  createMapRenderer, loadFramingDatabase, renderChunk, shapedColumns, terrariaFramingData,
} from "../src/index.js";
import type {
  BlockFraming, ChunkLayers, MapRenderer, RenderableWorld, SpriteAtlasSource, SpriteSheetEntry,
} from "../src/index.js";
import { pixelAt, wallLayerPixel, type Rgba } from "./wall-sprites.fixture.js";

let framing: BlockFraming;
beforeAll(async () => {
  framing = createBlockFraming(await loadFramingDatabase(terrariaFramingData));
});

const created: MapRenderer[] = [];
afterEach(() => {
  for (const renderer of created.splice(0)) renderer.dispose();
  vi.restoreAllMocks();
});

function makeRenderer(width: number, height: number): { canvas: HTMLCanvasElement; renderer: MapRenderer } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = createMapRenderer(canvas);
  created.push(renderer);
  return { canvas, renderer };
}

function readCanvas(canvas: HTMLCanvasElement): Uint8Array {
  const gl = canvas.getContext("webgl2");
  if (gl === null) throw new Error("no webgl2 context");
  const out = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
  const flipped = new Uint8Array(out.length);
  const row = canvas.width * 4;
  for (let y = 0; y < canvas.height; y++) flipped.set(out.subarray((canvas.height - 1 - y) * row, (canvas.height - y) * row), y * row);
  return flipped;
}

const DIRT = 0;
const STONE = 1;
const IRON = 6;
const SAND = 53;
const WALL = 2;

/** Dirt shapes: `H` half block (1), slopes cut at NE `T` (2), NW `N` (3), SE `R` (4), SW `L` (5). */
const LEGEND: Readonly<Record<string, readonly [number, BlockShape]>> = {
  d: [DIRT, "full"], s: [STONE, "full"], S: [SAND, "full"], H: [DIRT, "half"], T: [DIRT, "slopeTopRight"],
  N: [DIRT, "slopeTopLeft"], R: [DIRT, "slopeBottomRight"], L: [DIRT, "slopeBottomLeft"],
};

/** Every tile of row 1 and below has a wall, so the cut parts of shaped blocks show a wall behind them. */
function stamp(world: CanonicalWorld, left: number, top: number, rows: readonly string[]): void {
  rows.forEach((line, y) => {
    Array.from(line).forEach((char, x) => {
      const entry = LEGEND[char];
      const wall = top + y >= 1 ? { wall: { kind: "vanilla" as const, id: WALL } } : {};
      if (entry === undefined) {
        world.setTile(left + x, top + y, { ...wall, wires: 0, actuator: false });
        return;
      }
      const [id, shape] = entry;
      world.setTile(left + x, top + y, {
        block: { kind: "vanilla", id }, ...wall, wires: 0, actuator: false, ...(shape === "full" ? {} : { shape }),
      });
    });
  });
}

function renderable(world: CanonicalWorld): RenderableWorld {
  return { width: world.width, height: world.height, surfaceY: 2, planes: world.planes, palette: world.palette };
}

const PAGE = 1024;
const SHEET = 288;
/**
 * Synthetic sheets of the self-framed blocks (16 × 16 cells of 18 pixels, opaque, distinct per pixel and sheet) and of
 * the wall behind them (13 × 6 cells of 36 pixels, its 8-pixel overhang partly transparent).
 */
const SHEETS: readonly SpriteSheetEntry[] = [
  ...[DIRT, STONE, SAND, IRON].map((id, index) => ({
    kind: "tile" as const, id, page: 0, x: 2 + (index % 2) * 300, y: 2 + Math.floor(index / 2) * 300,
    width: SHEET, height: SHEET, frameWidth: 16, frameHeight: 16,
  })),
  { kind: "wall", id: WALL, page: 0, x: 2, y: 600, width: 468, height: 216, frameWidth: 32, frameHeight: 32 },
];
const WALL_SHEET = 4;

function sheetPixel(sheet: number, x: number, y: number): Rgba {
  if (sheet === WALL_SHEET) {
    const middle = x % 36 >= 8 && x % 36 < 24 && y % 36 >= 8 && y % 36 < 24;
    return [(x * 3) % 256, (y * 5 + 40) % 256, (x + y) % 256, middle ? 255 : [0, 255, 128][(x + y) % 3] ?? 0];
  }
  return [(x * 7 + sheet * 60) % 256, (y * 3 + x) % 256, (x * y + sheet * 31) % 256, 255];
}

function syntheticAtlas(): SpriteAtlasSource {
  const page = new Uint8Array(PAGE * PAGE * 4);
  SHEETS.forEach((sheet, index) => {
    for (let y = 0; y < sheet.height; y++) {
      for (let x = 0; x < sheet.width; x++) page.set(sheetPixel(index, x, y), ((sheet.y + y) * PAGE + sheet.x + x) * 4);
    }
  });
  return { pages: [page], index: { pageSize: PAGE, entries: SHEETS } };
}

const ALL: ChunkLayers = { background: true, walls: true, blocks: true, liquids: true };
const ZOOM = 16;

function mapColors(world: CanonicalWorld, layers: ChunkLayers): Uint8Array {
  const { pixels } = renderChunk(world, 0, 0, { surfaceY: 2, layers });
  return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
}

/** The wall layer of `world` in sprite mode (wall-sprites.fixture.ts), at sprite pixel (sx, sy) of tile (tx, ty). */
function wallLayer(world: CanonicalWorld): (tx: number, ty: number, sx: number, sy: number) => Rgba {
  const walls = framing.walls;
  if (walls === undefined) throw new Error("the framing has no wall framing");
  const input = {
    world, cellAt: createChunkWallCellCache(world, walls).cellAt, sheets: SHEETS, sheetPixel,
    mapWalls: mapColors(world, { ...ALL, blocks: false, liquids: false }),
    background: mapColors(world, { background: true, walls: false, blocks: false, liquids: false }),
  };
  return (tx, ty, sx, sy) => wallLayerPixel(input, tx, ty, sx, sy);
}

/**
 * The expected canvas at ZOOM pixels per tile (one sprite pixel per canvas pixel): a block with a framed cell shows its
 * sheet's cell, cut by its shape's columns (docs/assets.md, "Slopes and half blocks"), with the wall layer behind it
 * where the shape cuts it away; a block without one its map colour; every other tile the wall layer. The cells come from
 * the CPU chunk cell caches.
 */
function expectedCanvas(world: CanonicalWorld): Uint8Array {
  const map = mapColors(world, ALL);
  const behind = wallLayer(world);
  const cache = createChunkCellCache(world, framing);
  const { width, height } = world;
  const out = new Uint8Array(width * ZOOM * height * ZOOM * 4);
  for (let py = 0; py < height * ZOOM; py++) {
    for (let px = 0; px < width * ZOOM; px++) {
      const tx = Math.floor(px / ZOOM);
      const ty = Math.floor(py / ZOOM);
      const tile = (ty * width + tx) * 4;
      const sx = px % ZOOM;
      const sy = py % ZOOM;
      const hasBlock = (world.planes.block[tx * height + ty] ?? 0xffff) !== 0xffff;
      let color = hasBlock ? pixelAt(map, tile) : behind(tx, ty, sx, sy);
      const cell = cache.cellAt(tx, ty);
      if (cell !== NO_CELL) {
        const block = world.planes.block[tx * height + ty] ?? 0xffff;
        const ref = world.palette[block];
        const sheet = SHEETS.findIndex((entry) => ref?.kind === "vanilla" && entry.id === ref.id);
        const shape = world.planes.shape[tx * height + ty] ?? 0;
        const column = shapedColumns(shape)[Math.floor(sx / 2)];
        if (column === undefined) throw new Error("no column");
        color = behind(tx, ty, sx, sy);
        if (sy >= column.destY && sy < column.destY + column.height) {
          color = sheetPixel(sheet, (cell >> 6) * 18 + column.sourceX + sx - column.destX, (cell & 63) * 18 + column.sourceY + sy - column.destY);
        }
      }
      out.set(color, (py * width * ZOOM + px) * 4);
    }
  }
  return out;
}

function draw(world: CanonicalWorld, zoom = ZOOM): { pixels: Uint8Array; renderer: MapRenderer } {
  const { canvas, renderer } = makeRenderer(world.width * zoom, world.height * zoom);
  renderer.setWorld(renderable(world));
  renderer.setLayers(ALL);
  renderer.setAtlas(syntheticAtlas());
  renderer.setFraming(framing);
  renderer.setSpriteMode(true);
  renderer.setCamera({ x: 0, y: 0, zoom });
  renderer.render();
  expect(canvas.getContext("webgl2")?.getError()).toBe(0);
  return { pixels: readCanvas(canvas), renderer };
}

describe("self-framed blocks in sprite mode", () => {
  test("blocks show their framed cell; half blocks and slopes are cut by the shape table over the wall behind", () => {
    const world = createWorld(10, 6);
    stamp(world, 0, 0, ["..........", "..dHddTN..", ".dddddddd.", ".ssssssss.", ".RddddddL.", ".........."]);
    const { pixels } = draw(world);
    expect(pixels).toEqual(expectedCanvas(world));
    // Sanity: the half block's top half is the wall layer, its bottom half the sheet.
    const at = (x: number, y: number): Rgba => pixelAt(pixels, (y * world.width * ZOOM + x) * 4);
    const wall = wallLayer(world);
    expect(at(3 * ZOOM + 5, 1 * ZOOM + 2)).toEqual(wall(3, 1, 5, 2));
    expect(at(3 * ZOOM + 5, 1 * ZOOM + 12)).not.toEqual(wall(3, 1, 5, 12));
  });

  test("a sand block with air below it is drawn in its map colour (unstable), a supported one with its sprite", () => {
    const world = createWorld(8, 5);
    stamp(world, 0, 0, ["........", ".S...S..", ".....s..", "........", "........"]);
    const { pixels } = draw(world);
    expect(pixels).toEqual(expectedCanvas(world));
    const map = mapColors(world, ALL);
    const at = (x: number, y: number): Rgba => pixelAt(pixels, (y * world.width * ZOOM + x) * 4);
    for (let sy = 0; sy < ZOOM; sy++) for (let sx = 0; sx < ZOOM; sx++) {
      expect(at(ZOOM + sx, ZOOM + sy)).toEqual(pixelAt(map, (1 * world.width + 1) * 4));
    }
    expect(at(5 * ZOOM + 3, ZOOM + 3)).not.toEqual(pixelAt(map, (1 * world.width + 5) * 4));
  });

  test("without framing, or below the sprite zoom, self-framed blocks keep their map colours", () => {
    const world = createWorld(6, 4);
    stamp(world, 0, 0, ["......", ".dddd.", ".ssss.", "......"]);
    const { canvas, renderer } = makeRenderer(world.width * ZOOM, world.height * ZOOM);
    renderer.setWorld(renderable(world));
    renderer.setAtlas(syntheticAtlas());
    renderer.setSpriteMode(true);
    renderer.setCamera({ x: 0, y: 0, zoom: ZOOM });
    renderer.render();
    const map = mapColors(world, ALL);
    const plain = readCanvas(canvas);
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
      expect(pixelAt(plain, ((y * ZOOM + 3) * world.width * ZOOM + x * ZOOM + 3) * 4)).toEqual(pixelAt(map, (y * world.width + x) * 4));
    }
    renderer.setFraming(framing);
    renderer.setCamera({ x: 0, y: 0, zoom: SPRITE_MIN_ZOOM - 1 });
    renderer.render();
    expect(renderer.stats().framedTiles).toBe(0);
  });
});

describe("cell caching per chunk", () => {
  /** Three chunks across, two down, solid stone below row 4. */
  function stoneWorld(): CanonicalWorld {
    const world = createWorld(CHUNK_SIZE * 3, CHUNK_SIZE * 2);
    // The first block set appends stone as palette entry 0; the rest is written into the block plane directly.
    world.setTile(0, 4, { block: { kind: "vanilla", id: STONE }, wires: 0, actuator: false });
    for (let x = 0; x < world.width; x++) world.planes.block.fill(0, x * world.height + 4, (x + 1) * world.height);
    return world;
  }

  test("cells are computed once per chunk upload: panning over resident chunks does not frame them again", () => {
    const world = stoneWorld();
    const { renderer } = makeRenderer(128, 128);
    renderer.setWorld(renderable(world));
    renderer.setAtlas(syntheticAtlas());
    renderer.setFraming(framing);
    renderer.setSpriteMode(true);
    renderer.setCamera({ x: 0, y: 0, zoom: SPRITE_MIN_ZOOM });
    renderer.render();
    const one = renderer.stats().framedTiles;
    expect(one).toBe(CHUNK_SIZE * CHUNK_SIZE);
    for (const [x, y] of [[40, 10], [100, 100], [3, 50], [0, 0]] as const) {
      renderer.setCamera({ x, y, zoom: SPRITE_MIN_ZOOM });
      renderer.render();
    }
    expect(renderer.stats().framedTiles).toBe(one);
    renderer.setCamera({ x: CHUNK_SIZE - 8, y: 0, zoom: SPRITE_MIN_ZOOM });
    renderer.render();
    expect(renderer.stats().framedTiles).toBe(2 * one);
    for (const x of [CHUNK_SIZE - 4, CHUNK_SIZE + 20, 10, CHUNK_SIZE - 8]) {
      renderer.setCamera({ x, y: 0, zoom: SPRITE_MIN_ZOOM });
      renderer.render();
    }
    expect(renderer.stats().framedTiles).toBe(2 * one);
  });

  test("a chunk first uploaded at a map-colour zoom is framed once when sprites appear, not at map zooms", () => {
    const world = stoneWorld();
    const { renderer } = makeRenderer(128, 128);
    renderer.setWorld(renderable(world));
    renderer.setAtlas(syntheticAtlas());
    renderer.setFraming(framing);
    renderer.setSpriteMode(true);
    for (const zoom of [1, 2, 4, SPRITE_MIN_ZOOM - 1]) {
      renderer.setCamera({ x: 0, y: 0, zoom });
      renderer.render();
    }
    expect(renderer.stats().framedTiles).toBe(0);
    const uploads = renderer.stats().textureUploads;
    renderer.setCamera({ x: 0, y: 0, zoom: SPRITE_MIN_ZOOM });
    renderer.render();
    expect(renderer.stats().framedTiles).toBe(CHUNK_SIZE * CHUNK_SIZE);
    // One upload: the chunk's cell layer (its planes were resident already).
    expect(renderer.stats().textureUploads).toBe(uploads + 1);
    renderer.setSpriteMode(false);
    renderer.render();
    renderer.setSpriteMode(true);
    renderer.render();
    expect(renderer.stats().framedTiles).toBe(CHUNK_SIZE * CHUNK_SIZE);
    expect(renderer.stats().textureUploads).toBe(uploads + 1);
  });

  test("invalidating changed tiles recomputes their area, marks the touched chunks dirty and redraws them", () => {
    const world = createWorld(12, 8);
    stamp(world, 0, 0, ["............", ".ssssssssss.", ".ssssssssss.", ".ssssssssss.", ".ssssssssss.", "............"]);
    const { canvas, renderer } = makeRenderer(world.width * ZOOM, world.height * ZOOM);
    renderer.setWorld(renderable(world));
    renderer.setLayers(ALL);
    renderer.setAtlas(syntheticAtlas());
    renderer.setFraming(framing);
    renderer.setSpriteMode(true);
    renderer.setCamera({ x: 0, y: 0, zoom: ZOOM });
    renderer.render();
    const before = renderer.stats().framedTiles;
    // An iron ore tile replaces a stone one: the stone area around it (depth 0) changes within 3 × 3.
    world.setTile(5, 3, { block: { kind: "vanilla", id: IRON }, wall: { kind: "vanilla", id: WALL }, wires: 0, actuator: false });
    renderer.invalidateTiles([{ x: 5, y: 3 }]);
    renderer.render();
    expect(renderer.stats().framedTiles - before).toBe(9);
    expect(readCanvas(canvas)).toEqual(expectedCanvas(world));
  });
});

describe("framing within the upload budget", () => {
  /** Runs only the callbacks queued for this frame; continuations belong to the next frame. */
  function animationFrames(): { step: () => void } {
    let nextId = 1;
    const pending = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pending.set(nextId, callback);
      return nextId++;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { pending.delete(id); });
    return {
      step: () => {
        const callbacks = [...pending.values()];
        pending.clear();
        for (const callback of callbacks) callback(0);
      },
    };
  }

  test("a resident chunk whose cells did not fit the frame still draws, its self-framed blocks in map colours", () => {
    const frames = animationFrames();
    const world = createWorld(CHUNK_SIZE * 2, 16);
    stamp(world, 0, 0, Array.from({ length: 16 }, (_, y) => (y < 4 ? "." : "s").repeat(CHUNK_SIZE * 2)));
    const size = { width: 128, height: 128 };
    const canvas = document.createElement("canvas");
    Object.assign(canvas, size);
    const renderer = createMapRenderer(canvas, { maxChunkUploadsPerFrame: 1 });
    created.push(renderer);
    renderer.setWorld(renderable(world));
    renderer.setAtlas(syntheticAtlas());
    renderer.setFraming(framing);
    renderer.setSpriteMode(true);
    // Both chunks resident at a map zoom (render ignores the budget), then one budgeted frame at a sprite zoom.
    renderer.setCamera({ x: CHUNK_SIZE - 16, y: 0, zoom: 4 });
    renderer.render();
    expect(renderer.stats().residentChunks).toBe(2);
    // 8 pixels per tile: sprites are whole there (SPRITE_FULL_ZOOM), so framed and unframed chunks differ.
    renderer.setCamera({ x: CHUNK_SIZE - 8, y: 0, zoom: 8 });
    frames.step();
    expect(renderer.stats().framedTiles).toBe(CHUNK_SIZE * 16);
    expect(renderer.stats().visibleChunks).toHaveLength(2);
    const partly = readCanvas(canvas);

    const reference = makeRenderer(size.width, size.height);
    reference.renderer.setWorld(renderable(world));
    reference.renderer.setAtlas(syntheticAtlas());
    reference.renderer.setSpriteMode(true);
    reference.renderer.setCamera({ x: CHUNK_SIZE - 8, y: 0, zoom: 8 });
    reference.renderer.render();
    const unframed = readCanvas(reference.canvas);
    const half = (pixels: Uint8Array, right: boolean): Uint8Array[] => Array.from({ length: size.height }, (_, y) =>
      pixels.slice((y * size.width + (right ? 64 : 0)) * 4, (y * size.width + (right ? 128 : 64)) * 4));
    // The first chunk (left) shows sprites, the second (right) still its map colours.
    expect(half(partly, false)).not.toEqual(half(unframed, false));
    expect(half(partly, true)).toEqual(half(unframed, true));

    frames.step();
    expect(renderer.stats().framedTiles).toBe(2 * CHUNK_SIZE * 16);
    expect(half(readCanvas(canvas), true)).not.toEqual(half(unframed, true));
  });
});
