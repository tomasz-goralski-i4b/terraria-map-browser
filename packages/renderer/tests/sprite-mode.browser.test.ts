import { afterEach, describe, expect, test } from "vitest";
import { SPRITE_MIN_ZOOM, createMapRenderer, renderChunk } from "../src/index.js";
import type { ChunkLayers, MapRenderer, RenderableWorld, SpriteAtlasSource } from "../src/index.js";

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

const ABSENT = 0xffff;
// Palette indices: 0 chest-like (16 × 16 cells), 1 torch-like (20 × 20 cells), 2 a block without frames, 3 a wall,
// 4 frame-important content with no sheet in the atlas.
const CHEST = 0;
const TORCH = 1;
const STONE = 2;
const WALL = 3;
const NO_SHEET = 4;
const palette = [
  { kind: "vanilla", id: 21 }, { kind: "vanilla", id: 4 }, { kind: "vanilla", id: 1 }, { kind: "vanilla", id: 2 },
  { kind: "vanilla", id: 600 },
] as const;

/** Tiles of the test world: (x, y, block, frameX, frameY); every other tile has the wall only. */
const TILES: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, CHEST, 0, 0],
  [1, 0, CHEST, 36, 18],
  [2, 0, TORCH, 0, 0],
  [3, 0, TORCH, 22, 44],
  [0, 1, STONE, -1, -1],
  [2, 1, NO_SHEET, 0, 0],
];
const WIDTH = 4;
const HEIGHT = 3;

function spriteWorld(): RenderableWorld {
  const count = WIDTH * HEIGHT;
  const block = new Uint16Array(count).fill(ABSENT);
  const wall = new Uint16Array(count).fill(ABSENT);
  const frameX = new Int16Array(count).fill(-1);
  const frameY = new Int16Array(count).fill(-1);
  for (let x = 0; x < WIDTH; x++) for (let y = 0; y < HEIGHT; y++) if (y !== 2) wall[x * HEIGHT + y] = WALL;
  for (const [x, y, id, fx, fy] of TILES) {
    block[x * HEIGHT + y] = id;
    frameX[x * HEIGHT + y] = fx;
    frameY[x * HEIGHT + y] = fy;
  }
  return {
    width: WIDTH, height: HEIGHT, surfaceY: 1,
    planes: {
      block, wall, frameX, frameY, liquid: new Uint8Array(count), liquidAmount: new Uint8Array(count),
      paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
    },
    palette,
  };
}

const PAGE = 128;
/** Sheets of the synthetic atlas: the chest-like sheet at (2, 2), the torch-like one on page 1 at (2, 2). */
const SHEETS = [
  { kind: "tile", id: 21, page: 0, x: 2, y: 2, width: 72, height: 40, frameWidth: 16, frameHeight: 16, gapX: 2, gapY: 2 },
  { kind: "tile", id: 4, page: 1, x: 2, y: 2, width: 66, height: 66, frameWidth: 20, frameHeight: 20, gapX: 2, gapY: 2 },
] as const;

/** A sheet pixel: distinct per position and sheet, fully transparent on every seventh diagonal. */
function sheetPixel(sheet: number, x: number, y: number): readonly [number, number, number, number] {
  return [(x * 3 + sheet * 90) % 256, (y * 5 + 7) % 256, (x * y + sheet * 40) % 256, (x + y) % 7 === 0 ? 0 : 255];
}

function syntheticAtlas(): SpriteAtlasSource {
  const pages = [new Uint8Array(PAGE * PAGE * 4), new Uint8Array(PAGE * PAGE * 4)];
  SHEETS.forEach((sheet, index) => {
    const page = pages[sheet.page];
    if (page === undefined) throw new Error("no page");
    for (let y = 0; y < sheet.height; y++) {
      for (let x = 0; x < sheet.width; x++) page.set(sheetPixel(index, x, y), ((sheet.y + y) * PAGE + sheet.x + x) * 4);
    }
  });
  return { pages, index: { pageSize: PAGE, entries: SHEETS } };
}

/** The map colours of the world at one pixel per tile, from the CPU reference. */
function mapColors(world: RenderableWorld, layers: ChunkLayers): Uint8Array {
  return renderChunk(world as never, 0, 0, { surfaceY: world.surfaceY, layers }).pixels;
}

const ALL: ChunkLayers = { background: true, walls: true, blocks: true, liquids: true };
const ZOOM = 16;

/** The expected canvas at ZOOM pixels per tile with sprites: sheet pixels over the map colour of what lies behind. */
function expectedSprites(world: RenderableWorld, layers: ChunkLayers): Uint8Array {
  const map = mapColors(world, layers);
  const behind = mapColors(world, { ...layers, blocks: false });
  const out = new Uint8Array(WIDTH * ZOOM * HEIGHT * ZOOM * 4);
  for (let py = 0; py < HEIGHT * ZOOM; py++) {
    for (let px = 0; px < WIDTH * ZOOM; px++) {
      const tx = Math.floor(px / ZOOM);
      const ty = Math.floor(py / ZOOM);
      const tile = (ty * WIDTH + tx) * 4;
      let color: readonly number[] = [...map.subarray(tile, tile + 4)];
      const placed = layers.blocks ? TILES.find(([x, y]) => x === tx && y === ty) : undefined;
      const sheetIndex = placed === undefined ? -1 : [CHEST, TORCH].indexOf(placed[2]);
      const sheet = SHEETS[sheetIndex];
      if (placed !== undefined && sheet !== undefined) {
        // A tile is 16 sprite pixels; a larger cell is scaled into it.
        const sx = placed[3] + Math.floor(((px % ZOOM) * sheet.frameWidth) / 16);
        const sy = placed[4] + Math.floor(((py % ZOOM) * sheet.frameHeight) / 16);
        const pixel = sheetPixel(sheetIndex, sx, sy);
        color = pixel[3] === 0 ? [...behind.subarray(tile, tile + 4)] : pixel;
      }
      out.set(color, (py * WIDTH * ZOOM + px) * 4);
    }
  }
  return out;
}

/** The canvas drawn in map mode at `zoom`, for comparison. */
function mapModeAt(world: RenderableWorld, zoom: number, width: number, height: number): Uint8Array {
  const { canvas, renderer } = makeRenderer(width, height);
  renderer.setWorld(world);
  renderer.setCamera({ x: 0, y: 0, zoom });
  renderer.render();
  return readCanvas(canvas);
}

describe("sprite mode", () => {
  test("frame-important tiles show the atlas cell their frames select; other blocks and walls keep their map colour", () => {
    const world = spriteWorld();
    const { canvas, renderer } = makeRenderer(WIDTH * ZOOM, HEIGHT * ZOOM);
    renderer.setWorld(world);
    renderer.setAtlas(syntheticAtlas());
    renderer.setSpriteMode(true);
    renderer.setCamera({ x: 0, y: 0, zoom: ZOOM });
    renderer.render();
    expect(readCanvas(canvas)).toEqual(expectedSprites(world, ALL));
  });

  test("layer toggles remove exactly their pixels in sprite mode", () => {
    const world = spriteWorld();
    const { canvas, renderer } = makeRenderer(WIDTH * ZOOM, HEIGHT * ZOOM);
    renderer.setWorld(world);
    renderer.setAtlas(syntheticAtlas());
    renderer.setSpriteMode(true);
    renderer.setCamera({ x: 0, y: 0, zoom: ZOOM });
    for (const layers of [
      { ...ALL, blocks: false }, { ...ALL, walls: false }, { ...ALL, background: false }, { ...ALL, walls: false, background: false },
    ]) {
      renderer.setLayers(layers);
      renderer.render();
      expect(readCanvas(canvas), JSON.stringify(layers)).toEqual(expectedSprites(world, layers));
    }
  });

  test(`below ${String(SPRITE_MIN_ZOOM)} pixels per tile the map is drawn exactly as in map mode, overview included`, () => {
    const world = spriteWorld();
    for (const zoom of [SPRITE_MIN_ZOOM - 1, 4, 1, 0.75, 0.25]) {
      const width = Math.ceil(WIDTH * zoom);
      const height = Math.ceil(HEIGHT * zoom);
      const { canvas, renderer } = makeRenderer(width, height);
      renderer.setWorld(world);
      renderer.setAtlas(syntheticAtlas());
      renderer.setSpriteMode(true);
      renderer.setCamera({ x: 0, y: 0, zoom });
      renderer.render();
      expect(readCanvas(canvas), `zoom ${String(zoom)}`).toEqual(mapModeAt(world, zoom, width, height));
    }
  });

  test("without an atlas, or with sprite mode off, the map is drawn in map colours at any zoom", () => {
    const world = spriteWorld();
    const expected = mapModeAt(world, ZOOM, WIDTH * ZOOM, HEIGHT * ZOOM);
    const { canvas, renderer } = makeRenderer(WIDTH * ZOOM, HEIGHT * ZOOM);
    renderer.setWorld(world);
    renderer.setCamera({ x: 0, y: 0, zoom: ZOOM });
    renderer.setSpriteMode(true);
    renderer.render();
    expect(readCanvas(canvas)).toEqual(expected);
    renderer.setAtlas(syntheticAtlas());
    renderer.setSpriteMode(false);
    renderer.render();
    expect(readCanvas(canvas)).toEqual(expected);
  });

  test("switching sprite mode and crossing the threshold upload no chunk; the atlas is uploaded once per setAtlas", () => {
    const world = spriteWorld();
    const { renderer } = makeRenderer(WIDTH * ZOOM, HEIGHT * ZOOM);
    renderer.setWorld(world);
    renderer.setCamera({ x: 0, y: 0, zoom: ZOOM });
    renderer.render();
    renderer.setAtlas(syntheticAtlas());
    renderer.render();
    expect(renderer.stats().atlasUploads).toBe(1);
    const uploads = renderer.stats().textureUploads;
    for (const zoom of [ZOOM, 12, SPRITE_MIN_ZOOM, SPRITE_MIN_ZOOM - 0.5, 2, 9, ZOOM]) {
      renderer.setSpriteMode(zoom !== 2);
      renderer.setCamera({ x: 0, y: 0, zoom });
      renderer.render();
    }
    renderer.setSpriteMode(false);
    renderer.render();
    expect(renderer.stats().textureUploads).toBe(uploads);
    expect(renderer.stats().atlasUploads).toBe(1);
    renderer.setAtlas(syntheticAtlas());
    renderer.setAtlas(null);
    renderer.render();
    expect(renderer.stats().atlasUploads).toBe(2);
  });
});
