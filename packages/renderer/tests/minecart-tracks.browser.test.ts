// Minecart tracks in sprite mode (docs/assets.md, "Minecart tracks"): read-back pixels of a straight track, a slope
// with its decoration, a bumper and a junction against a synthetic Tiles_314.
import { afterEach, describe, expect, test } from "vitest";
import { createMapRenderer, renderChunk } from "../src/index.js";
import type { ChunkLayers, MapRenderer, RenderableWorld, SpriteAtlasSource } from "../src/index.js";

const created: MapRenderer[] = [];
afterEach(() => {
  for (const renderer of created.splice(0)) renderer.dispose();
});

type Rgba = readonly [number, number, number, number];

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
const TRACK = 0;
const MOD_BLOCK = 1;
const palette = [{ kind: "vanilla", id: 314 }, { kind: "mod", mod: "Example", internalName: "Crate" }] as const;
const WIDTH = 11;
const HEIGHT = 5;

/**
 * (x, y, block, frameX (front piece), frameY (back piece)). Piece 2 is a left end with a bumper (drawn on the tile above),
 * 1 a straight middle, 1 over 9 a junction (whose back piece draws a left-down decoration below), 8 a slope with its
 * right-down decoration (drawn on the tile below); the second slope has a block below it, which keeps its map colour.
 */
const TILES: readonly (readonly [number, number, number, number, number])[] = [
  [1, 1, TRACK, 2, -1],
  [3, 1, TRACK, 1, -1],
  [5, 1, TRACK, 1, 9],
  [7, 2, TRACK, 8, -1],
  [9, 2, TRACK, 8, -1],
  [9, 3, MOD_BLOCK, -1, -1],
];

function trackWorld(): RenderableWorld {
  const count = WIDTH * HEIGHT;
  const block = new Uint16Array(count).fill(ABSENT);
  const frameX = new Int16Array(count).fill(-1);
  const frameY = new Int16Array(count).fill(-1);
  for (const [x, y, id, fx, fy] of TILES) {
    block[x * HEIGHT + y] = id;
    frameX[x * HEIGHT + y] = fx;
    frameY[x * HEIGHT + y] = fy;
  }
  return {
    width: WIDTH, height: HEIGHT, surfaceY: 2,
    planes: {
      block, wall: new Uint16Array(count).fill(ABSENT), frameX, frameY, liquid: new Uint8Array(count),
      liquidAmount: new Uint8Array(count), paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
    },
    palette,
  };
}

const PAGE = 256;
const SHEET = { kind: "tile", id: 314, page: 0, x: 6, y: 4, width: 144, height: 144, frameWidth: 16, frameHeight: 16, gapX: 2, gapY: 2 } as const;

/** Distinct per sheet pixel; every fifth diagonal transparent, so pieces drawn over each other show their order. */
function sheetPixel(x: number, y: number): Rgba {
  return [(x * 7 + 3) % 256, (y * 5 + 11) % 256, (x * y + 29) % 256, (x + 2 * y) % 5 === 0 ? 0 : 255];
}

function syntheticAtlas(): SpriteAtlasSource {
  const page = new Uint8Array(PAGE * PAGE * 4);
  for (let y = 0; y < SHEET.height; y++) {
    for (let x = 0; x < SHEET.width; x++) page.set(sheetPixel(x, y), ((SHEET.y + y) * PAGE + SHEET.x + x) * 4);
  }
  return { pages: [page], index: { pageSize: PAGE, entries: [SHEET] } };
}

function over(top: Rgba, below: Rgba): Rgba {
  return top[3] === 0 ? below : top;
}

/** The documented cells (docs/assets.md, "Minecart tracks"), written out here so the test pins them. */
const PIECE_CELLS: Readonly<Record<number, readonly [number, number]>> = { 1: [1, 0], 2: [2, 1], 8: [0, 3], 9: [1, 3] };
const LEFT_DOWN: readonly [number, number] = [0, 6];
const RIGHT_DOWN: readonly [number, number] = [1, 6];
const BUMPER: readonly [number, number] = [0, 7];

function cellPixel(cell: readonly [number, number], sx: number, sy: number): Rgba {
  return sheetPixel(cell[0] * 18 + sx, cell[1] * 18 + sy);
}

const LAYERS: ChunkLayers = { background: true, walls: true, blocks: true, liquids: true };
const ZOOM = 16;

/**
 * The expected canvas at 16 pixels per tile: the pieces and their extras over the background (a track's own map colour
 * is not drawn under its sprite); the block keeps its map colour.
 */
function expectedCanvas(world: RenderableWorld): Uint8Array {
  const colors = (layers: ChunkLayers): Uint8ClampedArray => renderChunk(world as never, 0, 0, { surfaceY: world.surfaceY, layers }).pixels;
  const blocks = colors(LAYERS);
  const background = colors({ ...LAYERS, blocks: false });
  const map = (tx: number, ty: number): Rgba => {
    const at = (ty * WIDTH + tx) * 4;
    const pixels = TILES.some(([x, y, id]) => x === tx && y === ty && id === MOD_BLOCK) ? blocks : background;
    return [pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0, pixels[at + 3] ?? 0];
  };
  const tileAt = (tx: number, ty: number): (readonly [number, number, number, number, number]) | undefined =>
    TILES.find(([x, y]) => x === tx && y === ty);
  const out = new Uint8Array(WIDTH * ZOOM * HEIGHT * ZOOM * 4);
  for (let py = 0; py < HEIGHT * ZOOM; py++) {
    for (let px = 0; px < WIDTH * ZOOM; px++) {
      const tx = Math.floor(px / ZOOM);
      const ty = Math.floor(py / ZOOM);
      const sx = px % ZOOM;
      const sy = py % ZOOM;
      let color = map(tx, ty);
      const own = tileAt(tx, ty);
      if (own?.[2] === TRACK) {
        const back = PIECE_CELLS[own[4]];
        const front = PIECE_CELLS[own[3]];
        if (back !== undefined) color = over(cellPixel(back, sx, sy), color);
        if (front !== undefined) color = over(cellPixel(front, sx, sy), color);
      } else if (own === undefined) {
        // Decorations lie on the tile below their track (slope 8: right-down; the junction's back piece 9: left-down), the
        // end's bumper on the tile above it.
        const above = tileAt(tx, ty - 1);
        const pieces = above?.[2] === TRACK ? [above[3], above[4]] : [];
        if (pieces.includes(9)) color = over(cellPixel(LEFT_DOWN, sx, sy), color);
        if (pieces.includes(8)) color = over(cellPixel(RIGHT_DOWN, sx, sy), color);
        if (tileAt(tx, ty + 1)?.[3] === 2) color = over(cellPixel(BUMPER, sx, sy), color);
      }
      out.set(color, (py * WIDTH * ZOOM + px) * 4);
    }
  }
  return out;
}

describe("minecart tracks in sprite mode", () => {
  test("a straight track, a slope, a bumper and a junction draw their documented cells; a block keeps its pixels", () => {
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH * ZOOM;
    canvas.height = HEIGHT * ZOOM;
    const renderer = createMapRenderer(canvas);
    created.push(renderer);
    const world = trackWorld();
    renderer.setWorld(world);
    renderer.setLayers(LAYERS);
    renderer.setAtlas(syntheticAtlas());
    renderer.setSpriteMode(true);
    renderer.setCamera({ x: 0, y: 0, zoom: ZOOM });
    renderer.render();
    expect(canvas.getContext("webgl2")?.getError()).toBe(0);
    const actual = readCanvas(canvas);
    const expected = expectedCanvas(world);
    const differing: string[] = [];
    for (let i = 0; i < expected.length; i += 4) {
      if ([0, 1, 2, 3].some((k) => actual[i + k] !== expected[i + k])) {
        const pixel = i / 4;
        differing.push(`(${String(pixel % (WIDTH * ZOOM))}, ${String(Math.floor(pixel / (WIDTH * ZOOM)))})`);
      }
    }
    expect(differing.slice(0, 8), `${String(differing.length)} pixels differ`).toEqual([]);
  });
});
