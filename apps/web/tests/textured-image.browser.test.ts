import { expect, test } from "vitest";
import { createMapRenderer, terrariaMapPalette, type RenderableWorld, type SpriteAtlasSource, type SpriteSheetEntry } from "@studio/renderer";
import { texturedBands } from "../src/world/textured-image.js";
import type { ImageBand } from "../src/world/image-export.js";

const PAGE = 2048;
const SCALE = 16;
/** A synthetic work bench sheet (tile 18, drawn by the chunk pass): a different colour at every sheet pixel. */
const SHEETS: readonly SpriteSheetEntry[] = [{ kind: "tile", id: 18, page: 0, x: 0, y: 0, width: 36, height: 18, frameWidth: 16, frameHeight: 16 }];
const sheetPixel = (x: number, y: number): readonly number[] => [x * 7 % 256, y * 13 % 256, (x + y) * 5 % 256, 255];

function atlas(): SpriteAtlasSource {
  const page = new Uint8Array(PAGE * PAGE * 4);
  for (let y = 0; y < 18; y++) for (let x = 0; x < 36; x++) page.set(sheetPixel(x, y), (y * PAGE + x) * 4);
  return { pages: [page], index: { pageSize: PAGE, entries: SHEETS } };
}

/** Work benches (left and right halves) on every tile of a 12 × 5 world. */
function world(): RenderableWorld {
  const count = 12 * 5;
  return {
    width: 12, height: 5, surfaceY: 0,
    planes: {
      block: new Uint16Array(count), wall: new Uint16Array(count).fill(0xffff),
      frameX: Int16Array.from({ length: count }, (_, i) => (i % 2) * 18), frameY: new Int16Array(count),
      liquid: new Uint8Array(count), liquidAmount: new Uint8Array(count), paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
    },
    palette: [{ kind: "vanilla", id: 18 }],
  };
}

const LAYERS = { background: false, walls: false, blocks: true, liquids: false };

async function image(area: { x: number; y: number; width: number; height: number }, piece?: number): Promise<{ bands: ImageBand[]; pixels: Uint8ClampedArray }> {
  const bands: ImageBand[] = [];
  for await (const band of texturedBands(world(), area, SCALE, LAYERS, { atlas: atlas(), framing: null }, new AbortController().signal, piece)) bands.push(band);
  const pixels = new Uint8ClampedArray(bands.reduce((total, band) => total + band.pixels.length, 0));
  let offset = 0;
  for (const band of bands) { pixels.set(band.pixels, offset); offset += band.pixels.length; }
  return { bands, pixels };
}

test("a textured export has the pixels the map draws of the area at that zoom: sprites, not map colours", async () => {
  const area = { x: 1, y: 1, width: 4, height: 3 };
  const { pixels } = await image(area);
  const canvas = document.createElement("canvas");
  canvas.width = area.width * SCALE;
  canvas.height = area.height * SCALE;
  const renderer = createMapRenderer(canvas, { mapPalette: terrariaMapPalette });
  renderer.setWorld(world());
  renderer.setLayers(LAYERS);
  renderer.setAtlas(atlas());
  renderer.setSpriteMode(true);
  renderer.setCamera({ x: area.x, y: area.y, zoom: SCALE });
  renderer.render();
  const gl = canvas.getContext("webgl2");
  if (gl === null) throw new Error("no webgl2 context");
  const read = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, read);
  renderer.dispose();
  const expected = new Uint8ClampedArray(read.length);
  for (let y = 0; y < canvas.height; y++) expected.set(read.subarray((canvas.height - 1 - y) * canvas.width * 4, (canvas.height - y) * canvas.width * 4), y * canvas.width * 4);
  expect(pixels).toEqual(expected);
  // Every pixel comes from the synthetic sheet, whose colours are not the work bench's map colour.
  const sheet = new Set(Array.from({ length: 18 * 36 }, (_, i) => sheetPixel(i % 36, Math.floor(i / 36)).join()));
  const fromSheet = Array.from({ length: pixels.length / 4 }, (_, i) => [...pixels.subarray(i * 4, i * 4 + 4)].join()).filter((pixel) => sheet.has(pixel)).length;
  expect(fromSheet).toBe(pixels.length / 4);
});

test("drawing in small pieces gives the same image as drawing it at once", async () => {
  const area = { x: 0, y: 0, width: 12, height: 5 };
  const whole = await image(area);
  const pieces = await image(area, 3 * SCALE);
  expect(pieces.bands.map((band) => band.rows)).toEqual([48, 32]);
  expect(pieces.pixels).toEqual(whole.pixels);
});
