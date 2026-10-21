// Liquids in sprite mode as the game draws them (docs/assets.md, "Liquids"): read-back pixels of a pool underground
// and under the sky, a fall below a lone liquid tile, the liquid behind a block, and shimmer, against synthetic
// water_<n> and Liquid_<n> sheets.
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { createWorld, type CanonicalWorld } from "@studio/world-model";
import {
  createBlockFraming, createMapRenderer, loadFramingDatabase, renderChunk, terrariaFramingData,
} from "../src/index.js";
import type { BlockFraming, ChunkLayers, MapRenderer, RenderableWorld, SpriteAtlasSource, SpriteSheetEntry } from "../src/index.js";
import { liquidLayout, liquidPiece } from "../src/chunk/liquid-layout.js";

let framing: BlockFraming;
beforeAll(async () => {
  framing = createBlockFraming(await loadFramingDatabase(terrariaFramingData));
});

const created: MapRenderer[] = [];
afterEach(() => {
  for (const renderer of created.splice(0)) renderer.dispose();
});

type Rgba = readonly [number, number, number, number];

const STONE = 1;
const WATER = 1;
const SHIMMER = 4;
const ZOOM = 16;
const PAGE = 1536;
const ALL: ChunkLayers = { background: true, walls: true, blocks: true, liquids: true };

/** water_0 and water_14 (48 and 144 × 1360), Liquid_0 (34 × 16) and a fully transparent Tiles_1. */
const SHEETS: readonly SpriteSheetEntry[] = [
  { kind: "water", id: 0, page: 0, x: 2, y: 2, width: 48, height: 1360, frameWidth: 16, frameHeight: 16 },
  { kind: "water", id: 14, page: 0, x: 60, y: 2, width: 144, height: 1360, frameWidth: 16, frameHeight: 16 },
  { kind: "liquid", id: 0, page: 0, x: 210, y: 2, width: 34, height: 16, frameWidth: 16, frameHeight: 16 },
  { kind: "tile", id: STONE, page: 0, x: 260, y: 2, width: 288, height: 288, frameWidth: 16, frameHeight: 16 },
];

/**
 * Distinct opaque pixels per water sheet; shimmer's base pieces white, as the game's, its sparkle columns black (adding
 * nothing) or, with `sparkles`, white; the stone transparent.
 */
function sheetPixel(sheet: number, x: number, y: number, sparkles = false): Rgba {
  if (sheet === 3) return [0, 0, 0, 0];
  if (sheet === 1) return x < 48 || sparkles ? [255, 255, 255, 255] : [0, 0, 0, 255];
  return [(x * 5 + sheet * 70) % 256, (y * 3 + 20) % 256, (x * y + sheet * 40) % 256, 255];
}

function syntheticAtlas(sparkles = false): SpriteAtlasSource {
  const page = new Uint8Array(PAGE * PAGE * 4);
  SHEETS.forEach((sheet, index) => {
    for (let y = 0; y < sheet.height; y++) {
      for (let x = 0; x < sheet.width; x++) page.set(sheetPixel(index, x, y, sparkles), ((sheet.y + y) * PAGE + sheet.x + x) * 4);
    }
  });
  return { pages: [page], index: { pageSize: PAGE, entries: SHEETS } };
}

/** The shader's integer `over` (straight alpha) over an opaque pixel. */
function over(top: Rgba, below: Rgba): Rgba {
  const t = top[3];
  const mix = (k: 0 | 1 | 2): number => Math.floor((2 * (top[k] * t + below[k] * (255 - t)) + 255) / 510);
  return [mix(0), mix(1), mix(2), 255];
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

/**
 * A pool of water three tiles wide in stone (row 2, x 1–3; stone at x 0 and 4 and under it), a lone water tile in the
 * air at (7, 1), a stone block at (9, 2) with water beside it at (8, 2) on stone, and shimmer at (11, 2) on stone.
 */
function liquidWorld(): CanonicalWorld {
  const world = createWorld(13, 14);
  const stone = (x: number, y: number): void => {
    world.setTile(x, y, { block: { kind: "vanilla", id: STONE }, wires: 0, actuator: false });
  };
  const pour = (x: number, y: number, kind: number): void => {
    world.planes.liquid[x * world.height + y] = kind;
    world.planes.liquidAmount[x * world.height + y] = 255;
  };
  for (let x = 0; x < 5; x++) stone(x, 3);
  stone(0, 2);
  stone(4, 2);
  for (const x of [1, 2, 3]) pour(x, 2, WATER);
  pour(7, 1, WATER);
  stone(8, 3);
  stone(9, 3);
  stone(9, 2);
  pour(8, 2, WATER);
  stone(11, 3);
  pour(11, 2, SHIMMER);
  return world;
}

function renderable(world: CanonicalWorld, surfaceY: number): RenderableWorld {
  return { width: world.width, height: world.height, surfaceY, planes: world.planes, palette: world.palette };
}

function draw(world: RenderableWorld, sparkles = false): {
  pixel: (tx: number, ty: number, sx: number, sy: number) => Rgba; renderer: MapRenderer; read: () => void;
} {
  const canvas = document.createElement("canvas");
  canvas.width = world.width * ZOOM;
  canvas.height = world.height * ZOOM;
  const renderer = createMapRenderer(canvas);
  created.push(renderer);
  renderer.setWorld(world);
  renderer.setLayers(ALL);
  renderer.setAtlas(syntheticAtlas(sparkles));
  renderer.setFraming(framing);
  renderer.setSpriteMode(true);
  renderer.setCamera({ x: 0, y: 0, zoom: ZOOM });
  renderer.render();
  let pixels = readCanvas(canvas);
  return {
    renderer,
    read: () => { pixels = readCanvas(canvas); },
    pixel: (tx, ty, sx, sy) => {
      const i = ((ty * ZOOM + sy) * canvas.width + tx * ZOOM + sx) * 4;
      return [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0, pixels[i + 3] ?? 0];
    },
  };
}

/** The background map colour of tile row `y`. */
function background(world: RenderableWorld, y: number): Rgba {
  const { pixels } = renderChunk(world as never, 0, 0, { surfaceY: world.surfaceY, layers: { background: true, walls: false, blocks: false, liquids: false } });
  const i = y * world.width * 4;
  return [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0, 255];
}

/** The water_0 pixel the tile's liquid piece shows at sprite pixel (sx, sy). */
function pieceArt(world: RenderableWorld, tx: number, ty: number, sx: number, sy: number): Rgba {
  const layout = liquidLayout(world, { left: tx, top: ty, width: 1, height: 1 });
  const piece = liquidPiece(layout.cell[0] ?? 0, layout.rect[0] ?? 0, layout.behind[0] ?? 0);
  if (piece === null) throw new Error("no piece");
  const y = (piece.surface ? 1280 : piece.source.y) + sy - piece.offset.y;
  return sheetPixel(0, piece.source.x + sx - piece.offset.x, y);
}

const withAlpha = (color: Rgba, alpha: number): Rgba => [color[0], color[1], color[2], alpha];

describe("liquids drawn as the game draws them", () => {
  test("underground, a pool's surface piece lies over the background at 0.6 opacity", () => {
    const world = renderable(liquidWorld(), 0);
    const { pixel } = draw(world);
    for (const [sx, sy] of [[5, 0], [5, 9], [15, 15]] as const) {
      expect(pixel(2, 2, sx, sy)).toEqual(over(withAlpha(pieceArt(world, 2, 2, sx, sy), 153), background(world, 2)));
    }
  });

  test("under the sky the back layer hides the background: the pool shows its art", () => {
    const world = renderable(liquidWorld(), 10);
    const { pixel } = draw(world);
    expect(pixel(2, 2, 5, 9)).toEqual(pieceArt(world, 2, 2, 5, 9));
  });

  test("below a lone liquid tile the fall fades one eleventh per tile", () => {
    const world = renderable(liquidWorld(), 0);
    const { pixel } = draw(world);
    const alpha = Math.round((153 * 10) / 11);
    expect(pixel(7, 2, 8, 8)).toEqual(over(withAlpha(pieceArt(world, 7, 2, 8, 8), alpha), background(world, 2)));
    expect(pixel(7, 0, 8, 8)).toEqual(background(world, 0));
  });

  test("removing a liquid tile clears its fall; pouring one draws it", () => {
    const world = renderable(liquidWorld(), 0);
    const { pixel, renderer, read } = draw(world);
    const lit = pixel(7, 4, 8, 8);
    world.planes.liquidAmount[7 * world.height + 1] = 0;
    renderer.invalidateTiles([{ x: 7, y: 1 }]);
    renderer.render();
    read();
    expect(pixel(7, 4, 8, 8)).toEqual(background(world, 4));
    world.planes.liquidAmount[7 * world.height + 1] = 255;
    renderer.invalidateTiles([{ x: 7, y: 1 }]);
    renderer.render();
    read();
    expect(pixel(7, 4, 8, 8)).toEqual(lit);
  });

  test("water beside a block shows in a 4-pixel strip behind it, at half opacity underground", () => {
    const world = renderable(liquidWorld(), 0);
    const { pixel } = draw(world);
    // Liquid_0's frame 0 from its top row (no liquid above the block).
    expect(pixel(9, 2, 1, 6)).toEqual(over(withAlpha(sheetPixel(2, 1, 6), 128), background(world, 2)));
    expect(pixel(9, 2, 6, 6)).toEqual(background(world, 2));
  });

  test("shimmer is its base colour, which varies along the world", () => {
    const world = renderable(liquidWorld(), 0);
    const { pixel } = draw(world);
    const shimmer = pixel(11, 2, 8, 8);
    expect(shimmer).not.toEqual(background(world, 2));
    // A violet: blue strongest, red over green.
    expect(shimmer[2]).toBeGreaterThan(shimmer[0]);
    expect(shimmer[0]).toBeGreaterThan(shimmer[1]);
  });

  test("shimmer's glitter adds the sheet's sparkle art, coloured by a hue across the world, over its pieces", () => {
    const world = renderable(liquidWorld(), 0);
    const plain = draw(world).pixel(11, 2, 8, 8);
    const lit = draw(world, true).pixel(11, 2, 8, 8);
    // The lone shimmer tile is an edge piece: its glitter at 0.5, added twice under the sky (back and front layers).
    const added = [0, 1, 2].map((k) => (lit[k] ?? 0) - (plain[k] ?? 0));
    expect(Math.max(...added)).toBeGreaterThan(60);
    expect(added.every((value) => value >= 0)).toBe(true);
  });
});
