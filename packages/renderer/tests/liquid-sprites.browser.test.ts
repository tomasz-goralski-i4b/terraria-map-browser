// Liquids in sprite mode (docs/assets.md, "Liquids"): read-back pixels of full, half-full and surface tiles of each
// liquid against synthetic Liquid_0/1/11 sheets; what lies behind shows through; the liquids toggle removes exactly
// the liquid pixels.
import { afterEach, describe, expect, test } from "vitest";
import { LIQUID_SHEETS, LIQUID_SPRITE_ALPHA, createMapRenderer, liquidColors, liquidFillPixels, liquidSheetRow, renderChunk } from "../src/index.js";
import type { SpriteSheetEntry, ChunkLayers, MapRenderer, RenderableWorld, SpriteAtlasSource } from "../src/index.js";

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
const WIDTH = 7;
const HEIGHT = 4;
const WATER = 1;
const LAVA = 2;
const HONEY = 3;
const SHIMMER = 4;

/**
 * Liquids per column: water full at the surface, full under water and half under water (x 0); half water at the
 * surface over a modded wall (x 1); full lava over a modded block (x 2); half honey over full honey (x 3); shimmer
 * (x 4); half lava (x 5); nothing (x 6).
 */
function liquidWorld(): RenderableWorld {
  const count = WIDTH * HEIGHT;
  const block = new Uint16Array(count).fill(ABSENT);
  const wall = new Uint16Array(count).fill(ABSENT);
  const liquid = new Uint8Array(count);
  const liquidAmount = new Uint8Array(count);
  const at = (x: number, y: number): number => x * HEIGHT + y;
  const pour = (x: number, y: number, kind: number, amount: number): void => {
    liquid[at(x, y)] = kind;
    liquidAmount[at(x, y)] = amount;
  };
  pour(0, 1, WATER, 255);
  pour(0, 2, WATER, 255);
  pour(0, 3, WATER, 127);
  pour(1, 2, WATER, 127);
  wall[at(1, 2)] = 1;
  pour(2, 2, LAVA, 255);
  block[at(2, 2)] = 0;
  pour(3, 1, HONEY, 127);
  pour(3, 2, HONEY, 255);
  pour(4, 2, SHIMMER, 255);
  pour(5, 3, LAVA, 127);
  return {
    width: WIDTH, height: HEIGHT, surfaceY: 2,
    planes: { block, wall, liquid, liquidAmount, paint: new Uint8Array(count), wallPaint: new Uint8Array(count) },
    palette: [{ kind: "mod", mod: "Example", internalName: "Crate" }, { kind: "mod", mod: "Example", internalName: "Panel" }],
  };
}

const PAGE = 256;
/** Two 16 × 16 frames at a stride of 18, as the game's Liquid_<n> sheets (frame 0 is drawn). */
const sheetEntry = (id: number, x: number): SpriteSheetEntry =>
  ({ kind: "liquid", id, page: 0, x, y: 2, width: 34, height: 16, frameWidth: 16, frameHeight: 16 });
const SHEETS = [sheetEntry(0, 4), sheetEntry(1, 42), sheetEntry(11, 80)];

/** Distinct per sheet pixel; a few pixels transparent, so the liquid's own alpha is applied to the art's. */
function sheetPixel(sheet: number, x: number, y: number): Rgba {
  return [(x * 11 + sheet * 70) % 256, (y * 13 + 40) % 256, (x * y + sheet * 30) % 256, (x + 2 * y) % 7 === 0 ? 0 : 255];
}

function syntheticAtlas(withLiquids = true): SpriteAtlasSource {
  const page = new Uint8Array(PAGE * PAGE * 4);
  const entries = withLiquids ? SHEETS : [];
  entries.forEach((sheet, index) => {
    for (let y = 0; y < sheet.height; y++) {
      for (let x = 0; x < sheet.width; x++) page.set(sheetPixel(index, x, y), ((sheet.y + y) * PAGE + sheet.x + x) * 4);
    }
  });
  return { pages: [page], index: { pageSize: PAGE, entries } };
}

/** The shader's integer `over` (straight alpha). */
function over(top: Rgba, below: Rgba): Rgba {
  if (top[3] === 0) return below;
  if (below[3] === 0 || top[3] === 255) return top;
  const t = top[3];
  if (below[3] === 255) {
    const mix = (k: 0 | 1 | 2): number => Math.floor((2 * (top[k] * t + below[k] * (255 - t)) + 255) / 510);
    return [mix(0), mix(1), mix(2), 255];
  }
  const weight = below[3] * (255 - t);
  const alpha = t + Math.floor((weight + 127) / 255);
  const mix = (k: 0 | 1 | 2): number => Math.floor((top[k] * t * 255 + below[k] * weight + Math.floor((alpha * 255) / 2)) / (alpha * 255));
  return [mix(0), mix(1), mix(2), alpha];
}

const ZOOM = 16;
/** Shimmer's map colour (placeholder palette: the renderer's liquid colours without a map palette). */
const SHIMMER_COLOR: Rgba = [...(liquidColors()[SHIMMER] ?? [0, 0, 0]).slice(0, 3), 255] as unknown as Rgba;
const ALL: ChunkLayers = { background: true, walls: true, blocks: true, liquids: true };

function pixelAt(pixels: ArrayLike<number>, x: number, y: number): Rgba {
  const i = (y * WIDTH + x) * 4;
  return [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0, pixels[i + 3] ?? 0];
}

/**
 * The expected canvas: map colours without liquids, then per liquid tile the frame-0 pixel of its sheet at the row
 * liquidSheetRow gives (surface when the tile above holds no liquid): opaque over the background (the back layer: the
 * modded wall and block here are opaque and hide it), then with its alpha scaled by the liquid's sprite alpha on top;
 * shimmer its flat map colour likewise; without the sheets (`sheets` false) the others their map colour as the map
 * mode draws it.
 */
function expectedCanvas(world: RenderableWorld, layers: ChunkLayers, sheets = true): Uint8Array {
  const behind = renderChunk(world as never, 0, 0, { surfaceY: world.surfaceY, layers: { ...layers, liquids: false } }).pixels;
  const { block, wall } = world.planes;
  const open = (x: number, y: number): boolean => block[x * HEIGHT + y] === ABSENT && (!layers.walls || wall[x * HEIGHT + y] === ABSENT);
  const mapped = renderChunk(world as never, 0, 0, { surfaceY: world.surfaceY, layers }).pixels;
  const { liquid, liquidAmount } = world.planes;
  const kindAt = (x: number, y: number): number => (y < 0 ? 0 : liquid[x * HEIGHT + y] ?? 0);
  const out = new Uint8Array(WIDTH * ZOOM * HEIGHT * ZOOM * 4);
  for (let py = 0; py < HEIGHT * ZOOM; py++) {
    for (let px = 0; px < WIDTH * ZOOM; px++) {
      const tx = Math.floor(px / ZOOM);
      const ty = Math.floor(py / ZOOM);
      let color = pixelAt(behind, tx, ty);
      const kind = kindAt(tx, ty);
      const amount = liquidAmount[tx * HEIGHT + ty] ?? 0;
      if (layers.liquids && kind !== 0 && amount !== 0) {
        // Shimmer is drawn flat with or without the sheets; the others keep their map colours without them.
        const sheet = sheets || LIQUID_SHEETS[kind - 1] === null ? LIQUID_SHEETS[kind - 1] : undefined;
        if (sheet === undefined) {
          color = pixelAt(mapped, tx, ty);
        } else if (sheet === null) {
          // Shimmer: its map colour, flat, cut to the fill, in both layers.
          const row = liquidSheetRow(py % ZOOM, liquidFillPixels(amount), true);
          if (row !== null) {
            const flat = SHIMMER_COLOR;
            if (open(tx, ty)) color = flat;
            color = over([flat[0], flat[1], flat[2], Math.floor((255 * (LIQUID_SPRITE_ALPHA[kind - 1] ?? 0) + 127) / 255)], color);
          }
        } else {
          const row = liquidSheetRow(py % ZOOM, liquidFillPixels(amount), kindAt(tx, ty - 1) === 0);
          if (row !== null) {
            const art = sheetPixel(SHEETS.findIndex((entry) => entry.id === sheet), px % ZOOM, row);
            if (open(tx, ty)) color = over(art, color);
            const alpha = Math.floor((art[3] * (LIQUID_SPRITE_ALPHA[kind - 1] ?? 0) + 127) / 255);
            color = over([art[0], art[1], art[2], alpha], color);
          }
        }
      }
      out.set(color, (py * WIDTH * ZOOM + px) * 4);
    }
  }
  return out;
}

function drawer(world: RenderableWorld, atlas: SpriteAtlasSource): (layers: ChunkLayers) => Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * ZOOM;
  canvas.height = HEIGHT * ZOOM;
  const renderer = createMapRenderer(canvas);
  created.push(renderer);
  renderer.setWorld(world);
  renderer.setAtlas(atlas);
  renderer.setCamera({ x: 0, y: 0, zoom: ZOOM });
  renderer.setSpriteMode(true);
  return (layers) => {
    renderer.setLayers(layers);
    renderer.render();
    expect(canvas.getContext("webgl2")?.getError()).toBe(0);
    return readCanvas(canvas);
  };
}

function differing(actual: Uint8Array, expected: Uint8Array): string[] {
  const out: string[] = [];
  for (let i = 0; i < expected.length; i += 4) {
    if ([0, 1, 2, 3].some((k) => actual[i + k] !== expected[i + k])) {
      const at = i / 4;
      out.push(`(${String(at % (WIDTH * ZOOM))}, ${String(Math.floor(at / (WIDTH * ZOOM)))}) ${String([...actual.subarray(i, i + 4)])} ≠ ${String([...expected.subarray(i, i + 4)])}`);
    }
  }
  return out;
}

describe("liquids in sprite mode", () => {
  test("full, half-full and surface tiles of water, lava and honey show their sheet cut to the fill, over what lies behind", () => {
    const world = liquidWorld();
    const draw = drawer(world, syntheticAtlas());
    const found = differing(draw(ALL), expectedCanvas(world, ALL));
    expect(found.slice(0, 8), `${String(found.length)} pixels differ`).toEqual([]);
    // Hiding the liquids removes exactly their pixels: what lies behind them stays.
    const hidden = { ...ALL, liquids: false };
    const gone = differing(draw(hidden), expectedCanvas(world, hidden));
    expect(gone.slice(0, 8), `${String(gone.length)} pixels differ`).toEqual([]);
  });

  test("without the liquid sheets water, lava and honey keep their map colours", () => {
    const world = liquidWorld();
    const found = differing(drawer(world, syntheticAtlas(false))(ALL), expectedCanvas(world, ALL, false));
    expect(found.slice(0, 8), `${String(found.length)} pixels differ`).toEqual([]);
  });
});
