import { afterEach, describe, expect, test } from "vitest";
import {
  MISSING_SPRITE_COLORS, SPRITE_MIN_ZOOM, createMapRenderer, liquidColors, renderChunk, spriteSampling,
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
// Palette indices: 0 chest-like (16 × 16 cells), 1 torch-like (20 × 20 cells), 2 a block without frames, 3 a wall,
// 4 frame-important content with no sheet in the atlas, 5 a tree (frame-important, has a sheet, but trees are deferred).
const CHEST = 0;
const TORCH = 1;
const STONE = 2;
const WALL = 3;
const NO_SHEET = 4;
const TREE = 5;
const palette = [
  { kind: "vanilla", id: 21 }, { kind: "vanilla", id: 4 }, { kind: "vanilla", id: 1 }, { kind: "vanilla", id: 2 },
  { kind: "vanilla", id: 600 }, { kind: "vanilla", id: 5 },
] as const;

/**
 * Tiles of the test world: (x, y, block, frameX, frameY); every other tile has the wall only (row 2 has none). The
 * second chest is under water (WATER_AMOUNT), so liquids are composited over its sprite.
 */
const TILES: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, CHEST, 0, 0],
  [1, 0, CHEST, 36, 18],
  [2, 0, TORCH, 0, 0],
  [3, 0, TORCH, 22, 44],
  [0, 1, STONE, -1, -1],
  [2, 1, NO_SHEET, 0, 0],
  [3, 1, TREE, 22, 0],
];
const WIDTH = 4;
const HEIGHT = 3;
const WATER_TILE = [1, 0] as const;
const WATER_AMOUNT = 128;

function spriteWorld(): RenderableWorld {
  const count = WIDTH * HEIGHT;
  const block = new Uint16Array(count).fill(ABSENT);
  const wall = new Uint16Array(count).fill(ABSENT);
  const frameX = new Int16Array(count).fill(-1);
  const frameY = new Int16Array(count).fill(-1);
  const liquid = new Uint8Array(count);
  const liquidAmount = new Uint8Array(count);
  liquid[WATER_TILE[0] * HEIGHT + WATER_TILE[1]] = 1;
  liquidAmount[WATER_TILE[0] * HEIGHT + WATER_TILE[1]] = WATER_AMOUNT;
  for (let x = 0; x < WIDTH; x++) for (let y = 0; y < HEIGHT; y++) if (y !== 2) wall[x * HEIGHT + y] = WALL;
  for (const [x, y, id, fx, fy] of TILES) {
    block[x * HEIGHT + y] = id;
    frameX[x * HEIGHT + y] = fx;
    frameY[x * HEIGHT + y] = fy;
  }
  return {
    width: WIDTH, height: HEIGHT, surfaceY: 1,
    planes: {
      block, wall, frameX, frameY, liquid, liquidAmount, paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
    },
    palette,
  };
}

const PAGE = 128;
/** Sheets of the synthetic atlas: the chest-like sheet at (2, 2), the torch-like one on page 1 at (2, 2). */
const SHEETS = [
  { kind: "tile", id: 21, page: 0, x: 2, y: 2, width: 72, height: 40, frameWidth: 16, frameHeight: 16, gapX: 2, gapY: 2 },
  { kind: "tile", id: 4, page: 1, x: 2, y: 2, width: 66, height: 66, frameWidth: 20, frameHeight: 20, gapX: 2, gapY: 2 },
  { kind: "tile", id: 5, page: 0, x: 2, y: 60, width: 44, height: 44, frameWidth: 20, frameHeight: 20, gapX: 2, gapY: 2 },
] as const;

/** A sheet pixel: distinct per position and sheet; transparent, half transparent or opaque by its diagonal. */
function sheetPixel(sheet: number, x: number, y: number): readonly [number, number, number, number] {
  const diagonal = (x + y) % 7;
  return [(x * 3 + sheet * 90) % 256, (y * 5 + 7) % 256, (x * y + sheet * 40) % 256, diagonal === 0 ? 0 : diagonal === 3 ? 128 : 255];
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
  const { pixels } = renderChunk(world as never, 0, 0, { surfaceY: world.surfaceY, layers });
  return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
}

type Rgba = readonly [number, number, number, number];

/**
 * Straight-alpha `top` over `below`, in the shader's integer arithmetic: over an opaque pixel the rounded blend
 * `renderChunk` uses, over a partly transparent one the general rule with rounded alpha.
 */
function over(top: Rgba, below: Rgba): Rgba {
  const [r, g, b, a] = top;
  if (a === 0) return below;
  if (below[3] === 0 || a === 255) return top;
  if (below[3] === 255) {
    const mix = (t: number, d: number): number => Math.floor((2 * (t * a + d * (255 - a)) + 255) / 510);
    return [mix(r, below[0]), mix(g, below[1]), mix(b, below[2]), 255];
  }
  const weight = below[3] * (255 - a);
  const alpha = a + Math.floor((weight + 127) / 255);
  const mix = (t: number, d: number): number => Math.floor((t * a * 255 + d * weight + Math.floor((alpha * 255) / 2)) / (alpha * 255));
  return [mix(r, below[0]), mix(g, below[1]), mix(b, below[2]), alpha];
}

const ALL: ChunkLayers = { background: true, walls: true, blocks: true, liquids: true };
const ZOOM = 16;

function pixelAt(pixels: Uint8Array, index: number): Rgba {
  return [pixels[index] ?? 0, pixels[index + 1] ?? 0, pixels[index + 2] ?? 0, pixels[index + 3] ?? 0];
}

/**
 * The sprite of canvas pixel (px, py) at `zoom` pixels per tile, as the chunk pass samples it (spriteSampling): the
 * straight-alpha mean of samples² sprite pixels spread over the pixel's footprint, kept inside the tile; `pixel` is
 * the sprite's colour at sprite pixel (sx, sy) of the tile.
 */
function sampled(zoom: number, px: number, py: number, pixel: (sx: number, sy: number) => Rgba): Rgba {
  const { samples, step } = spriteSampling(zoom);
  const at = (p: number, k: number): number => {
    const centre = (((p % zoom) + 0.5) * 16) / zoom;
    return Math.min(15, Math.max(0, Math.floor(centre + ((k + 0.5) / samples - 0.5) * step)));
  };
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  for (let ky = 0; ky < samples; ky++) {
    for (let kx = 0; kx < samples; kx++) {
      const [r, g, b, a] = pixel(at(px, kx), at(py, ky));
      red += r * a;
      green += g * a;
      blue += b * a;
      alpha += a;
    }
  }
  const count = samples * samples;
  if (alpha === 0) return [0, 0, 0, 0];
  const mean = (sum: number): number => Math.floor((2 * sum + alpha) / (2 * alpha));
  return [mean(red), mean(green), mean(blue), Math.floor((2 * alpha + count) / (2 * count))];
}

/**
 * The expected canvas at `zoom` (an integer) pixels per tile, computed on the CPU. Without sprites it is each tile's
 * map colour; with them a tile that has a sheet shows the sheet pixel `frame + sub × cell / 16` of its sprite pixel
 * `sub`, over the map colour of what lies behind, with the liquid over that.
 */
function expectedCanvas(world: RenderableWorld, layers: ChunkLayers, zoom: number, sprites: boolean): Uint8Array {
  const map = mapColors(world, layers);
  const behind = mapColors(world, { ...layers, blocks: false, liquids: false });
  const water = liquidColors(undefined)[1] ?? [0, 0, 0, 0];
  const out = new Uint8Array(WIDTH * zoom * HEIGHT * zoom * 4);
  for (let py = 0; py < HEIGHT * zoom; py++) {
    for (let px = 0; px < WIDTH * zoom; px++) {
      const tx = Math.floor(px / zoom);
      const ty = Math.floor(py / zoom);
      const tile = (ty * WIDTH + tx) * 4;
      let color = pixelAt(map, tile);
      const missing = sprites && layers.blocks && TILES.some(([x, y, id]) => x === tx && y === ty && id === NO_SHEET);
      if (missing) {
        // Content with a stored frame but no sheet: the missing-texture checkerboard, 2 × 2 squares per tile.
        color = sampled(zoom, px, py, (sx, sy) =>
          [...(MISSING_SPRITE_COLORS[(Math.floor(sx / 8) + Math.floor(sy / 8)) % 2] ?? [0, 0, 0]), 255] as unknown as Rgba);
      }
      const placed = sprites && layers.blocks ? TILES.find(([x, y]) => x === tx && y === ty) : undefined;
      const sheetIndex = placed === undefined ? -1 : [CHEST, TORCH].indexOf(placed[2]);
      const sheet = SHEETS[sheetIndex];
      if (placed !== undefined && sheet !== undefined) {
        const sprite = sampled(zoom, px, py, (sx, sy) => sheetPixel(
          sheetIndex, placed[3] + Math.floor((sx * sheet.frameWidth) / 16), placed[4] + Math.floor((sy * sheet.frameHeight) / 16),
        ));
        color = over(sprite, pixelAt(behind, tile));
        if (layers.liquids && tx === WATER_TILE[0] && ty === WATER_TILE[1]) {
          color = over([water[0], water[1], water[2], WATER_AMOUNT], color);
        }
      }
      out.set(color, (py * WIDTH * zoom + px) * 4);
    }
  }
  return out;
}

function draw(world: RenderableWorld, zoom: number, layers: ChunkLayers, sprites: boolean, atlas = true): Uint8Array {
  const { canvas, renderer } = makeRenderer(Math.ceil(WIDTH * zoom), Math.ceil(HEIGHT * zoom));
  renderer.setWorld(world);
  renderer.setLayers(layers);
  if (atlas) renderer.setAtlas(syntheticAtlas());
  renderer.setSpriteMode(sprites);
  renderer.setCamera({ x: 0, y: 0, zoom });
  renderer.render();
  expect(canvas.getContext("webgl2")?.getError()).toBe(0);
  return readCanvas(canvas);
}

describe("sprite mode", () => {
  // At 8 pixels per tile a canvas pixel is the mean of 2 × 2 sprite pixels.
  test.each([ZOOM, 8])(
    "at %i pixels per tile frame-important tiles show the atlas cell their frames select, or the missing-texture checkerboard without a sheet; other blocks, trees and walls keep their map colour",
    (zoom) => {
      const world = spriteWorld();
      expect(draw(world, zoom, ALL, true)).toEqual(expectedCanvas(world, ALL, zoom, true));
    },
  );

  test("layer toggles remove exactly their pixels in sprite mode, and liquids cover sprites, half-transparent ones too", { tags: ["perf"], timeout: 60_000 }, () => {
    const world = spriteWorld();
    for (const layers of [
      { ...ALL, blocks: false }, { ...ALL, walls: false }, { ...ALL, background: false }, { ...ALL, liquids: false },
      { ...ALL, walls: false, background: false },
    ]) {
      expect(draw(world, ZOOM, layers, true), JSON.stringify(layers)).toEqual(expectedCanvas(world, layers, ZOOM, true));
    }
  });

  // Software GL comparisons exceeded the shared pipeline timeout but passed both isolated reruns.
  test(`below ${String(SPRITE_MIN_ZOOM)} pixels per tile the map keeps its map colours, and the overview is unchanged`, { tags: ["perf"] }, () => {
    const world = spriteWorld();
    for (const zoom of [SPRITE_MIN_ZOOM - 1, 4, 1]) {
      expect(draw(world, zoom, ALL, true), `zoom ${String(zoom)}`).toEqual(expectedCanvas(world, ALL, zoom, false));
    }
    // Filtered and overview zooms: the same pixels as without an atlas or sprites, and something is drawn.
    for (const zoom of [0.75, 0.25]) {
      const drawn = draw(world, zoom, ALL, true);
      expect(drawn, `zoom ${String(zoom)}`).toEqual(draw(world, zoom, ALL, false, false));
      expect(drawn.some((value, index) => index % 4 === 3 && value !== 0), `zoom ${String(zoom)} drew nothing`).toBe(true);
    }
  });

  test("without an atlas, or with sprite mode off, the map is drawn in map colours at any zoom", () => {
    const world = spriteWorld();
    const expected = expectedCanvas(world, ALL, ZOOM, false);
    expect(draw(world, ZOOM, ALL, true, false)).toEqual(expected);
    expect(draw(world, ZOOM, ALL, false)).toEqual(expected);
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

/**
 * spriteWorld() placed at columns 128–131 (the second chunk), with other chests at columns 0–3 of the first chunk: a
 * cache of one chunk must evict the first to draw the second.
 */
function twoChunkWorld(): RenderableWorld {
  const inner = spriteWorld();
  const width = 256;
  const count = width * HEIGHT;
  const block = new Uint16Array(count).fill(ABSENT);
  const wall = new Uint16Array(count).fill(WALL);
  const frameX = new Int16Array(count).fill(-1);
  const frameY = new Int16Array(count).fill(-1);
  const liquid = new Uint8Array(count);
  const liquidAmount = new Uint8Array(count);
  const offset = 128 * HEIGHT;
  const planes = inner.planes;
  block.set(planes.block, offset);
  wall.set(planes.wall, offset);
  if (planes.frameX !== undefined) frameX.set(planes.frameX, offset);
  if (planes.frameY !== undefined) frameY.set(planes.frameY, offset);
  liquid.set(planes.liquid, offset);
  liquidAmount.set(planes.liquidAmount, offset);
  for (let x = 0; x < WIDTH; x++) {
    block[x * HEIGHT] = CHEST;
    frameX[x * HEIGHT] = 18 * x;
    frameY[x * HEIGHT] = 18;
  }
  return {
    width, height: HEIGHT, surfaceY: inner.surfaceY,
    planes: { block, wall, frameX, frameY, liquid, liquidAmount, paint: new Uint8Array(count), wallPaint: new Uint8Array(count) },
    palette,
  };
}

describe("sprite mode with the chunk cache", () => {
  test("after a cache slot is evicted and reused, the frames drawn belong to the new chunk", () => {
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH * ZOOM;
    canvas.height = HEIGHT * ZOOM;
    const renderer = createMapRenderer(canvas, { maxCachedChunks: 1 });
    created.push(renderer);
    renderer.setWorld(twoChunkWorld());
    renderer.setAtlas(syntheticAtlas());
    renderer.setSpriteMode(true);
    renderer.setCamera({ x: 0, y: 0, zoom: ZOOM });
    renderer.render();
    const first = readCanvas(canvas);
    renderer.setCamera({ x: 128, y: 0, zoom: ZOOM });
    renderer.render();
    expect(renderer.stats().evictedChunks).toBeGreaterThanOrEqual(1);
    expect(renderer.stats().residentChunks).toBe(1);
    const second = readCanvas(canvas);
    expect(second).not.toEqual(first);
    expect(second).toEqual(expectedCanvas(spriteWorld(), ALL, ZOOM, true));
  });

  test("panning across the whole world draws sprites without uploading or rebuilding the atlas again", () => {
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH * ZOOM;
    canvas.height = HEIGHT * ZOOM;
    const renderer = createMapRenderer(canvas, { maxCachedChunks: 1 });
    created.push(renderer);
    const world = twoChunkWorld();
    renderer.setWorld(world);
    renderer.setAtlas(syntheticAtlas());
    renderer.setSpriteMode(true);
    for (let x = 0; x <= world.width - WIDTH; x += 6) {
      renderer.setCamera({ x, y: 0, zoom: ZOOM });
      renderer.render();
    }
    for (let x = world.width - WIDTH; x >= 0; x -= 6) {
      renderer.setCamera({ x, y: 0, zoom: ZOOM });
      renderer.render();
    }
    // Chunks were uploaded along the way (the cache grows to the views that straddle both), the atlas never again.
    expect(renderer.stats().atlasUploads).toBe(1);
    expect(renderer.stats().textureUploads).toBeGreaterThan(2);
  });
});
