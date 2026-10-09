import { afterEach, describe, expect, test } from "vitest";
import {
  SPRITE_FULL_ZOOM, SPRITE_MIN_ZOOM, createMapRenderer, renderChunk, spriteSampling,
} from "../src/index.js";
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
const CHEST = 0;
const WALL = 1;
const palette = [{ kind: "vanilla", id: 21 }, { kind: "vanilla", id: 2 }] as const;
const PAGE = 128;
/** A chest-like sheet: 16 × 16 cells, gutter 2; frame (0, 0) and (18, 0) are the cells drawn here. */
const SHEET = { kind: "tile", id: 21, page: 0, x: 2, y: 2, width: 72, height: 40, frameWidth: 16, frameHeight: 16 } as const;

/** Sheet pixel colours: red by column (distinct for every column of the first two cells), opaque. */
function columnAtlas(): SpriteAtlasSource {
  const page = new Uint8Array(PAGE * PAGE * 4);
  for (let y = 0; y < SHEET.height; y++) {
    for (let x = 0; x < SHEET.width; x++) page.set([(x * 7) % 256, 100 + y, 50, 255], ((SHEET.y + y) * PAGE + SHEET.x + x) * 4);
  }
  return { pages: [page], index: { pageSize: PAGE, entries: [SHEET] } };
}

/** One uniform colour per cell: cell (0, 0) is (200, 40, 90), opaque. */
function flatAtlas(): SpriteAtlasSource {
  const page = new Uint8Array(PAGE * PAGE * 4);
  for (let y = 0; y < SHEET.height; y++) {
    for (let x = 0; x < SHEET.width; x++) page.set([200, 40, 90, 255], ((SHEET.y + y) * PAGE + SHEET.x + x) * 4);
  }
  return { pages: [page], index: { pageSize: PAGE, entries: [SHEET] } };
}

/** A world of chests with stored frames at `tiles` (x, y, frameX), walls everywhere. */
function chestWorld(width: number, height: number, tiles: readonly (readonly [number, number, number])[]): RenderableWorld {
  const count = width * height;
  const block = new Uint16Array(count).fill(ABSENT);
  const frameX = new Int16Array(count).fill(-1);
  const frameY = new Int16Array(count).fill(-1);
  for (const [x, y, fx] of tiles) {
    block[x * height + y] = CHEST;
    frameX[x * height + y] = fx;
    frameY[x * height + y] = 0;
  }
  return {
    width, height, surfaceY: 1,
    planes: {
      block, wall: new Uint16Array(count).fill(WALL), frameX, frameY, liquid: new Uint8Array(count),
      liquidAmount: new Uint8Array(count), paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
    },
    palette,
  };
}

describe("sprite sampling by zoom", () => {
  test(`sprites start at ${String(SPRITE_MIN_ZOOM * 100)}% and are whole from ${String(SPRITE_FULL_ZOOM * 100)}%`, () => {
    expect(SPRITE_MIN_ZOOM).toBe(5);
    expect(SPRITE_FULL_ZOOM).toBe(7.5);
    expect(spriteSampling(5)).toEqual({ samples: 4, step: 3.2, weight: 0 });
    expect(spriteSampling(6)).toEqual({ samples: 3, step: 16 / 6, weight: 102 });
    expect(spriteSampling(7.5)).toEqual({ samples: 3, step: 16 / 7.5, weight: 256 });
    expect(spriteSampling(8)).toEqual({ samples: 2, step: 2, weight: 256 });
    expect(spriteSampling(13.77)).toEqual({ samples: 2, step: 16 / 13.77, weight: 256 });
    expect(spriteSampling(16)).toEqual({ samples: 1, step: 1, weight: 256 });
    expect(spriteSampling(64)).toEqual({ samples: 1, step: 0.25, weight: 256 });
  });

  test("between the two zooms a sprite fades in over its map colour by the zoom", () => {
    const world = chestWorld(3, 3, [[1, 1, 0]]);
    const layers: ChunkLayers = { background: true, walls: true, blocks: true, liquids: true };
    const { pixels } = renderChunk(world as never, 0, 0, { surfaceY: 1, layers });
    const map = [pixels[(1 * 3 + 1) * 4] ?? 0, pixels[(1 * 3 + 1) * 4 + 1] ?? 0, pixels[(1 * 3 + 1) * 4 + 2] ?? 0];
    for (const zoom of [4, 5, 6, 7, 8]) {
      const { canvas, renderer } = makeRenderer(3 * zoom, 3 * zoom);
      renderer.setWorld(world);
      renderer.setLayers(layers);
      renderer.setAtlas(flatAtlas());
      renderer.setSpriteMode(true);
      renderer.setCamera({ x: 0, y: 0, zoom });
      renderer.render();
      const out = readCanvas(canvas);
      const { weight } = spriteSampling(zoom);
      const shown = zoom < SPRITE_MIN_ZOOM ? 0 : weight;
      const expected = [200, 40, 90].map((sprite, k) => Math.floor(((map[k] ?? 0) * (256 - shown) + sprite * shown + 128) / 256));
      // Every pixel of the tile (the samples stay inside it), not only its centre.
      for (let y = zoom; y < 2 * zoom; y++) {
        for (let x = zoom; x < 2 * zoom; x++) {
          const at = (y * 3 * zoom + x) * 4;
          expect([out[at], out[at + 1], out[at + 2], out[at + 3]], `zoom ${String(zoom)} (${String(x)}, ${String(y)})`)
            .toEqual([...expected, 255]);
        }
      }
    }
  });

  test("below one sprite pixel per screen pixel a pixel is the mean of the sprite pixels it covers", () => {
    const world = chestWorld(2, 1, [[0, 0, 0], [1, 0, 18]]);
    const layers: ChunkLayers = { background: false, walls: false, blocks: true, liquids: false };
    const zoom = 8;
    const { canvas, renderer } = makeRenderer(2 * zoom, zoom);
    renderer.setWorld(world);
    renderer.setLayers(layers);
    renderer.setAtlas(columnAtlas());
    renderer.setSpriteMode(true);
    renderer.setCamera({ x: 0, y: 0, zoom });
    renderer.render();
    const out = readCanvas(canvas);
    // At 8 pixels per tile a pixel covers 2 × 2 sprite pixels: columns 2q and 2q + 1, rows 2r and 2r + 1.
    for (let y = 0; y < zoom; y++) {
      for (let x = 0; x < 2 * zoom; x++) {
        const frame = x < zoom ? 0 : 18;
        const column = frame + 2 * (x % zoom);
        const red = Math.floor((2 * (((column * 7) % 256) + (((column + 1) * 7) % 256)) * 2 * 255 + 4 * 255) / (2 * 4 * 255));
        const green = Math.floor((2 * ((100 + 2 * y) + (101 + 2 * y)) * 2 * 255 + 4 * 255) / (2 * 4 * 255));
        const at = (y * 2 * zoom + x) * 4;
        expect([out[at], out[at + 1], out[at + 2], out[at + 3]], `(${String(x)}, ${String(y)})`).toEqual([red, green, 50, 255]);
      }
    }
  });
});

describe("chunk edges", () => {
  test("a pixel whose centre lies on a chunk border shows the sprite pixel on one side of it, never the far edge of a tile", () => {
    // Tile 127 (the last of chunk 0) shows cell (0, 0), tile 128 (the first of chunk 1) cell (18, 0). On the border
    // the pixel is column 15 of the first or column 0 of the second; anything else is a tile edge drawn in the wrong place.
    const world = chestWorld(256, 1, [[127, 0, 0], [128, 0, 18]]);
    const layers: ChunkLayers = { background: false, walls: false, blocks: true, liquids: false };
    const zoom = 16;
    const { canvas, renderer } = makeRenderer(24, 16);
    renderer.setWorld(world);
    renderer.setLayers(layers);
    renderer.setAtlas(columnAtlas());
    renderer.setSpriteMode(true);
    const allowed = new Set([(15 * 7) % 256, (18 * 7) % 256]);
    // 33 cameras around the one that puts the border on the centre of pixel 11, a float32 step apart (the old
    // shader drew a far tile edge at the first of them).
    const tie = 128 - 11.5 / zoom;
    const seen = new Set<number>();
    for (let k = -16; k <= 16; k++) {
      renderer.setCamera({ x: tie + k * 2 ** -17, y: 0, zoom });
      renderer.render();
      const out = readCanvas(canvas);
      for (let y = 0; y < 16; y++) {
        const red = out[(y * 24 + 11) * 4] ?? -1;
        seen.add(red);
        expect(allowed.has(red), `camera step ${String(k)}, row ${String(y)}: red ${String(red)}`).toBe(true);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  }, 60_000);
});
