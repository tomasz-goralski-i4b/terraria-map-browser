// Frame-important tiles with draw offsets lie behind the blocks (docs/assets.md, "Draw offsets"): where a plant reaches
// into the tile below it, that tile's opaque sprite pixels cover it and its transparent ones show it.
import { afterEach, expect, test } from "vitest";
import { LIQUID_SPRITE_ALPHA, createMapRenderer } from "../src/index.js";
import type { MapRenderer, RenderableWorld, SpriteAtlasSource, SpriteSheetEntry } from "../src/index.js";

const created: MapRenderer[] = [];
afterEach(() => {
  for (const renderer of created.splice(0)) renderer.dispose();
});

type Rgba = readonly [number, number, number, number];
const ABSENT = 0xffff;
const ZOOM = 16;

/** 3 × 3: a plant (3, frame (0, 0): 16 × 20, drawn from its tile's top) at (1, 0) over a bottle (13) at (1, 1). */
function world(water = false): RenderableWorld {
  const n = 3, count = n * n;
  const block = new Uint16Array(count).fill(ABSENT);
  const frameX = new Int16Array(count).fill(-1);
  const frameY = new Int16Array(count).fill(-1);
  for (const [x, y, palette] of [[1, 0, 0], [1, 1, 1]] as const) {
    block[x * n + y] = palette;
    frameX[x * n + y] = 0;
    frameY[x * n + y] = 0;
  }
  const liquid = new Uint8Array(count), liquidAmount = new Uint8Array(count);
  if (water) { liquid[1 * n + 0] = 1; liquidAmount[1 * n + 0] = 255; }
  return {
    width: n, height: n, surfaceY: 3,
    planes: {
      block, wall: new Uint16Array(count).fill(ABSENT), frameX, frameY, liquid,
      liquidAmount, paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
    },
    palette: [{ kind: "vanilla", id: 3 }, { kind: "vanilla", id: 13 }],
  };
}

const PAGE = 64;
const SHEETS: readonly SpriteSheetEntry[] = [
  { kind: "tile", id: 3, page: 0, x: 2, y: 2, width: 16, height: 20, frameWidth: 16, frameHeight: 20 },
  { kind: "tile", id: 13, page: 0, x: 22, y: 2, width: 16, height: 16, frameWidth: 16, frameHeight: 16 },
  { kind: "liquid", id: 0, page: 0, x: 2, y: 26, width: 34, height: 16, frameWidth: 16, frameHeight: 16 },
];
/** The water sheet: one opaque colour. */
const WATER: Rgba = [10, 60, 200, 255];

/** The plant: opaque, distinct per pixel. The bottle: its top 4 rows transparent on every other column. */
function sheetPixel(sheet: number, x: number, y: number): Rgba {
  if (sheet === 2) return WATER;
  if (sheet === 0) return [200, (x * 9) % 256, (y * 11) % 256, 255];
  return [(x * 13) % 256, 40, (y * 7) % 256, y < 4 && x % 2 === 0 ? 0 : 255];
}

function atlas(): SpriteAtlasSource {
  const page = new Uint8Array(PAGE * PAGE * 4);
  SHEETS.forEach((sheet, index) => {
    for (let y = 0; y < sheet.height; y++) for (let x = 0; x < sheet.width; x++) page.set(sheetPixel(index, x, y), ((sheet.y + y) * PAGE + sheet.x + x) * 4);
  });
  return { pages: [page], index: { pageSize: PAGE, entries: SHEETS } };
}

/** The canvas's pixels of `w` drawn at ZOOM in sprite mode with the synthetic atlas. */
function draw(w: RenderableWorld): (x: number, y: number) => Rgba {
  const canvas = document.createElement("canvas");
  canvas.width = 3 * ZOOM;
  canvas.height = 3 * ZOOM;
  const renderer = createMapRenderer(canvas);
  created.push(renderer);
  renderer.setWorld(w);
  renderer.setLayers({ background: true, walls: true, blocks: true, liquids: true });
  renderer.setAtlas(atlas());
  renderer.setSpriteMode(true);
  renderer.setCamera({ x: 0, y: 0, zoom: ZOOM });
  renderer.render();
  const gl = canvas.getContext("webgl2");
  if (gl === null) throw new Error("no webgl2 context");
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return (x, y) => {
    const i = ((canvas.height - 1 - y) * canvas.width + x) * 4;
    return [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0, pixels[i + 3] ?? 0];
  };
}

test("a plant reaching into the tile below lies behind that tile's opaque pixels and shows through its transparent ones", () => {
  const at = draw(world());
  const wrong: string[] = [];
  // The overlap: the bottle's top 4 rows, where the plant's rows 16–19 reach (x = 1 is odd: the plant is not mirrored).
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 16; sx++) {
      const bottle = sheetPixel(1, sx, sy);
      const expected = bottle[3] === 255 ? bottle : sheetPixel(0, sx, 16 + sy);
      const actual = at(ZOOM + sx, ZOOM + sy);
      if (actual.join() !== expected.join()) wrong.push(`(${String(sx)}, ${String(sy)}): ${actual.join()} ≠ ${expected.join()}`);
    }
  }
  expect(wrong.slice(0, 6), `${String(wrong.length)} pixels differ`).toEqual([]);
  // Above, the plant covers its own tile.
  expect(at(ZOOM + 5, 5)).toEqual(sheetPixel(0, 5, 5));
});

test("a plant under water lies under the water's front layer, as blocks do (water at 128 of 255)", () => {
  const at = draw(world(true));
  const plant = sheetPixel(0, 5, 5);
  const actual = at(ZOOM + 5, 5);
  for (let k = 0; k < 3; k++) {
    const [p, w, alpha] = [plant[k] ?? 0, WATER[k] ?? 0, LIQUID_SPRITE_ALPHA[0] ?? 0];
    const expected = p + ((w - p) * alpha) / 255;
    expect(Math.abs((actual[k] ?? 0) - expected), `channel ${String(k)}: ${actual.join()}`).toBeLessThanOrEqual(1.5);
  }
  expect(actual[3]).toBe(255);
});
