import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { createWorld, type CanonicalWorld, type ContentRef } from "@studio/world-model";
import {
  CHUNK_SIZE, createBlockFraming, createChunkWallCellCache, createMapRenderer, loadFramingDatabase, renderChunk,
  terrariaFramingData,
} from "../src/index.js";
import type { BlockFraming, ChunkLayers, MapRenderer, RenderableWorld, SpriteAtlasSource, SpriteSheetEntry } from "../src/index.js";
import {
  expectClose, onTop, over, pixelAt, premultiply, straight, wallLayerPixel, wallScreenPixel, type Rgba,
} from "./wall-sprites.fixture.js";

let framing: BlockFraming;
beforeAll(async () => {
  framing = createBlockFraming(await loadFramingDatabase(terrariaFramingData));
});

const created: MapRenderer[] = [];
afterEach(() => {
  for (const renderer of created.splice(0)) renderer.dispose();
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

const STONE_WALL = 1;
const DIRT_WALL = 2;
/** A large-frame wall (cells by position, 6 × 6). */
const LARGE_WALL = 185;
/** A wall the synthetic atlas has no sheet for: drawn as the missing-texture checkerboard. */
const UNSHEETED_WALL = 7;
const MOD_BLOCK: ContentRef = { kind: "mod", mod: "Example", internalName: "Crate" };
const MOD_WALL: ContentRef = { kind: "mod", mod: "Example", internalName: "Panel" };

/** `1` stone wall, `2` dirt wall, `L` large-frame wall, `7` a wall without a sheet, `m` a modded wall; `#` puts a
 * modded block (no sprite: its map colour) over a stone wall, `B` one with no wall behind it. */
const LEGEND: Readonly<Record<string, { readonly wall?: ContentRef; readonly block?: ContentRef }>> = {
  "1": { wall: { kind: "vanilla", id: STONE_WALL } }, "2": { wall: { kind: "vanilla", id: DIRT_WALL } },
  L: { wall: { kind: "vanilla", id: LARGE_WALL } }, "7": { wall: { kind: "vanilla", id: UNSHEETED_WALL } },
  m: { wall: MOD_WALL }, "#": { wall: { kind: "vanilla", id: STONE_WALL }, block: MOD_BLOCK }, B: { block: MOD_BLOCK },
};

function stamp(world: CanonicalWorld, left: number, top: number, rows: readonly string[]): void {
  rows.forEach((line, y) => {
    Array.from(line).forEach((char, x) => {
      const entry = LEGEND[char];
      if (entry !== undefined) world.setTile(left + x, top + y, { ...entry, wires: 0, actuator: false });
    });
  });
}

function renderable(world: CanonicalWorld): RenderableWorld {
  return { width: world.width, height: world.height, surfaceY: 2, planes: world.planes, palette: world.palette };
}

const PAGE = 1024;
/** Wall sheets of 13 × 6 cells of 36 pixels: rows 0–4 of every wall and row 5 of the large-frame walls. */
const SHEETS: readonly SpriteSheetEntry[] = [STONE_WALL, DIRT_WALL, LARGE_WALL].map((id, index) => ({
  kind: "wall" as const, id, page: 0, x: 4, y: 4 + index * 220, width: 468, height: 216, frameWidth: 32, frameHeight: 32,
}));

/**
 * Distinct per pixel and sheet. A cell's 16 × 16 middle is opaque; its 8-pixel overhang mixes transparent, opaque and
 * half-transparent pixels, so overlapping overhangs show their drawing order.
 */
function sheetPixel(sheet: number, x: number, y: number): Rgba {
  const cx = x % 36;
  const cy = y % 36;
  const middle = cx >= 8 && cx < 24 && cy >= 8 && cy < 24;
  const alpha = middle ? 255 : [0, 255, 128][(x + 2 * y + sheet) % 3] ?? 0;
  return [(x * 5 + sheet * 70) % 256, (y * 3 + x + sheet * 20) % 256, (x * y + 17) % 256, alpha];
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

/** renderChunk's colours of the whole world, chunk by chunk, row-major (y · width + x). */
function mapColors(world: CanonicalWorld, layers: ChunkLayers): Uint8Array {
  const out = new Uint8Array(world.width * world.height * 4);
  for (let cx = 0; cx * CHUNK_SIZE < world.width; cx++) {
    for (let cy = 0; cy * CHUNK_SIZE < world.height; cy++) {
      const { pixels, width, height } = renderChunk(world, cx, cy, { surfaceY: 2, layers });
      for (let y = 0; y < height; y++) {
        out.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), ((cy * CHUNK_SIZE + y) * world.width + cx * CHUNK_SIZE) * 4);
      }
    }
  }
  return out;
}

/**
 * The expected canvas of world tiles [left, left + columns) × [top, top + rows) at ZOOM: a block (modded, without a
 * sprite) shows its map colour over everything; elsewhere the wall layer of wallLayerPixel.
 */
function layerInput(world: CanonicalWorld): Parameters<typeof wallLayerPixel>[0] {
  return {
    world, cellAt: createChunkWallCellCache(world, framing.walls).cellAt, sheets: SHEETS, sheetPixel,
    mapWalls: mapColors(world, { ...ALL, blocks: false, liquids: false }),
    background: mapColors(world, { background: true, walls: false, blocks: false, liquids: false }),
  };
}

function expectedCanvas(world: CanonicalWorld, left = 0, top = 0, columns = world.width, rows = world.height): Uint8Array {
  const input = layerInput(world);
  const map = mapColors(world, ALL);
  const out = new Uint8Array(columns * ZOOM * rows * ZOOM * 4);
  for (let py = 0; py < rows * ZOOM; py++) {
    for (let px = 0; px < columns * ZOOM; px++) {
      const tx = left + Math.floor(px / ZOOM);
      const ty = top + Math.floor(py / ZOOM);
      const block = world.planes.block[tx * world.height + ty] ?? 0xffff;
      const color = block !== 0xffff
        ? pixelAt(map, (ty * world.width + tx) * 4)
        : wallLayerPixel(input, tx, ty, px % ZOOM, py % ZOOM);
      out.set(color, (py * columns * ZOOM + px) * 4);
    }
  }
  return out;
}

function draw(world: CanonicalWorld, layers: ChunkLayers = ALL, zoom = ZOOM): { canvas: HTMLCanvasElement; renderer: MapRenderer } {
  const { canvas, renderer } = makeRenderer(Math.floor(world.width * zoom), Math.floor(world.height * zoom));
  renderer.setWorld(renderable(world));
  renderer.setLayers(layers);
  renderer.setAtlas(syntheticAtlas());
  renderer.setFraming(framing);
  renderer.setSpriteMode(true);
  renderer.setCamera({ x: 0, y: 0, zoom });
  renderer.render();
  expect(canvas.getContext("webgl2")?.getError()).toBe(0);
  return { canvas, renderer };
}

/** Stone and dirt walls, a lone wall, a large-frame patch, unsheeted and modded walls, blocks over and beside walls. */
const SCENE = [
  "............",
  ".1111222....",
  ".11#1222..1.",
  ".1111B22....",
  "......LLL...",
  ".7..m.LLL.12",
  "......LLL.21",
  "............",
];

describe("walls in sprite mode", () => {
  test("walls show their framed 32 × 32 cells centred on the tile, overhanging 8 pixels, blocks drawn over them", () => {
    const world = createWorld(12, 8);
    stamp(world, 0, 0, SCENE);
    const { canvas } = draw(world);
    const pixels = readCanvas(canvas);
    expectClose(pixels, expectedCanvas(world), world.width * ZOOM);
    const at = (x: number, y: number): Rgba => pixelAt(pixels, (y * world.width * ZOOM + x) * 4);
    const background = mapColors(world, { background: true, walls: false, blocks: false, liquids: false });
    // The lone wall at (10, 2) reaches into the empty tiles beside it: the wall layer differs from the background
    // somewhere in the 8 pixels left of it.
    const reach = Array.from({ length: 16 * 8 }, (_, i) => at(9 * ZOOM + 8 + (i % 8), 2 * ZOOM + Math.floor(i / 8)));
    expect(reach.some((color) => color.join() !== pixelAt(background, (2 * world.width + 9) * 4).join())).toBe(true);
    // The block over a wall (3, 2) and the one beside walls (5, 3) cover every pixel of their tiles.
    const map = mapColors(world, ALL);
    for (const [tx, ty] of [[3, 2], [5, 3]] as const) {
      for (let s = 0; s < ZOOM * ZOOM; s++) {
        expect(at(tx * ZOOM + (s % ZOOM), ty * ZOOM + Math.floor(s / ZOOM))).toEqual(pixelAt(map, (ty * world.width + tx) * 4));
      }
    }
  });

  test("pinned pixels: a lone wall's overhang, and two half-transparent overhangs drawn upper row first", () => {
    const world = createWorld(12, 8);
    stamp(world, 0, 0, SCENE);
    const pixels = readCanvas(draw(world).canvas);
    const at = (x: number, y: number): Rgba => pixelAt(pixels, (y * world.width * ZOOM + x) * 4);
    // The lone stone wall at (10, 2) takes variant (70 + 22) mod 3 = 2 of its lone cell: (11, 3). Sprite pixel (15, 10)
    // of the empty tile west of it is its cell pixel (15 + 8 − 16, 10 + 8) = (7, 18), sheet pixel (403, 126), opaque.
    expect(sheetPixel(0, 403, 126)[3]).toBe(255);
    expect(at(9 * ZOOM + 15, 2 * ZOOM + 10)).toEqual(sheetPixel(0, 403, 126));

    // An empty tile (1, 1) between a stone wall east of it at (2, 1) and a dirt wall south of it at (1, 2):
    // sprite pixel (12, 12) lies in both overhangs. Stone (2, 1) is lone at variant 1, cell (10, 3): pixel
    // (12 + 8 − 16, 12 + 8) of it, sheet (364, 128). Dirt (1, 2) is lone at variant 2, cell (11, 3): pixel
    // (12 + 8, 12 + 8 − 16), sheet (416, 112). Both are half transparent; row 1 is drawn first, then row 2 over it.
    const small = createWorld(4, 4);
    stamp(small, 0, 0, ["....", "..1.", ".2..", "...."]);
    const stone = sheetPixel(0, 364, 128);
    const dirt = sheetPixel(1, 416, 112);
    expect([stone[3], dirt[3]]).toEqual([128, 128]);
    const background = pixelAt(mapColors(small, { background: true, walls: false, blocks: false, liquids: false }), (1 * 4 + 1) * 4);
    const composite = (top: Rgba, below: Rgba): Rgba =>
      over(straight(onTop(premultiply(top), onTop(premultiply(below), [0, 0, 0, 0]))), background);
    const expected = composite(dirt, stone);
    const reversed = composite(stone, dirt);
    expect(expected.some((value, k) => Math.abs(value - (reversed[k] ?? 0)) > 1)).toBe(true);
    const drawn = readCanvas(draw(small).canvas);
    const actual = pixelAt(drawn, ((ZOOM + 12) * small.width * ZOOM + ZOOM + 12) * 4);
    expect(actual.every((value, k) => Math.abs(value - (expected[k] ?? 0)) <= 1), `${actual.join()} ≠ ${expected.join()}`).toBe(true);
  });

  test.each([
    ["12.8 pixels per tile: the art pixel under each screen pixel, sprites whole", 12.8],
    ["8 pixels per tile: one sample of the half-resolution atlas", 8],
    ["6.4 pixels per tile: 2 × 2 samples of the half-resolution atlas, faded in over the map colours", 6.4],
  ])("below 16 pixels per tile the wall layer is sampled and faded like block sprites (%s)", (_name, zoom) => {
    const world = createWorld(12, 8);
    stamp(world, 0, 0, SCENE);
    const { canvas } = draw(world, ALL, zoom);
    const pixels = readCanvas(canvas);
    const input = layerInput(world);
    const map = mapColors(world, ALL);
    const expected = new Uint8Array(pixels.length);
    for (let py = 0; py < canvas.height; py++) {
      for (let px = 0; px < canvas.width; px++) {
        const tx = Math.floor((px + 0.5) / zoom);
        const ty = Math.floor((py + 0.5) / zoom);
        const block = world.planes.block[tx * world.height + ty] ?? 0xffff;
        const color = block !== 0xffff ? pixelAt(map, (ty * world.width + tx) * 4) : wallScreenPixel(input, zoom, px, py);
        expected.set(color, (py * canvas.width + px) * 4);
      }
    }
    expectClose(pixels, expected, canvas.width);
  });

  test("a wall's overhang crosses chunk borders: the chunk beside it draws it from its apron", () => {
    const world = createWorld(CHUNK_SIZE * 2, 8);
    stamp(world, CHUNK_SIZE - 4, 0, ["........", ".1112...", ".1..2.2.", ".111222.", "........"]);
    const columns = 8;
    const { canvas, renderer } = makeRenderer(columns * ZOOM, world.height * ZOOM);
    renderer.setWorld(renderable(world));
    renderer.setLayers(ALL);
    renderer.setAtlas(syntheticAtlas());
    renderer.setFraming(framing);
    renderer.setSpriteMode(true);
    renderer.setCamera({ x: CHUNK_SIZE - 4, y: 0, zoom: ZOOM });
    renderer.render();
    expect(renderer.stats().visibleChunks).toHaveLength(2);
    expectClose(readCanvas(canvas), expectedCanvas(world, CHUNK_SIZE - 4, 0, columns, world.height), columns * ZOOM);
  });

  test("a chunk without wall cells skips the wall layer: its neighbour's overhang, a modded wall and a new wall still show", () => {
    // The chunk beside the walls has none of its own; only its apron holds the overhang of the wall left of it.
    const world = createWorld(CHUNK_SIZE * 2, 8);
    stamp(world, CHUNK_SIZE - 2, 0, ["..", ".1", ".1", ".."]);
    stamp(world, CHUNK_SIZE + 3, 5, ["m."]);
    const columns = 8;
    const { canvas, renderer } = makeRenderer(columns * ZOOM, world.height * ZOOM);
    renderer.setWorld(renderable(world));
    renderer.setLayers(ALL);
    renderer.setAtlas(syntheticAtlas());
    renderer.setFraming(framing);
    renderer.setSpriteMode(true);
    renderer.setCamera({ x: CHUNK_SIZE - 4, y: 0, zoom: ZOOM });
    renderer.render();
    expectClose(readCanvas(canvas), expectedCanvas(world, CHUNK_SIZE - 4, 0, columns, world.height), columns * ZOOM);
    // A wall placed where the chunk had none is drawn once its tiles are invalidated.
    stamp(world, CHUNK_SIZE + 1, 1, ["22", "2."]);
    renderer.invalidateTiles([{ x: CHUNK_SIZE + 1, y: 1 }, { x: CHUNK_SIZE + 2, y: 1 }, { x: CHUNK_SIZE + 1, y: 2 }]);
    renderer.render();
    expectClose(readCanvas(canvas), expectedCanvas(world, CHUNK_SIZE - 4, 0, columns, world.height), columns * ZOOM);
  });

  test("invalidating one changed wall recomputes exactly its 3 × 3 area and redraws it", () => {
    const world = createWorld(12, 8);
    stamp(world, 0, 0, SCENE);
    const { canvas, renderer } = draw(world);
    const before = renderer.stats().framedWalls;
    world.setTile(2, 2, { wires: 0, actuator: false });
    renderer.invalidateTiles([{ x: 2, y: 2 }]);
    renderer.render();
    expect(renderer.stats().framedWalls - before).toBe(9);
    expectClose(readCanvas(canvas), expectedCanvas(world), world.width * ZOOM);
  });

  test("with the wall layer hidden no wall and no overhang is drawn; without sprite mode walls keep their map colours", () => {
    const world = createWorld(12, 8);
    stamp(world, 0, 0, SCENE);
    const hidden = { ...ALL, walls: false };
    const noWalls = draw(world, hidden);
    const map = mapColors(world, hidden);
    const pixels = readCanvas(noWalls.canvas);
    for (let ty = 0; ty < world.height; ty++) {
      for (let tx = 0; tx < world.width; tx++) {
        for (const [sx, sy] of [[0, 0], [3, 12], [15, 15], [8, 7]] as const) {
          expect(pixelAt(pixels, ((ty * ZOOM + sy) * world.width * ZOOM + tx * ZOOM + sx) * 4)).toEqual(pixelAt(map, (ty * world.width + tx) * 4));
        }
      }
    }
    const shown = draw(world);
    shown.renderer.setSpriteMode(false);
    shown.renderer.render();
    const plain = readCanvas(shown.canvas);
    const allMap = mapColors(world, ALL);
    for (let ty = 0; ty < world.height; ty++) {
      for (let tx = 0; tx < world.width; tx++) {
        expect(pixelAt(plain, ((ty * ZOOM + 5) * world.width * ZOOM + tx * ZOOM + 5) * 4)).toEqual(pixelAt(allMap, (ty * world.width + tx) * 4));
      }
    }
  });
});
