import { afterEach, expect, test } from "vitest";
import { createMapRenderer, wrappedFrame } from "../src/index.js";
import type { MapRenderer, RenderableWorld, SpriteAtlasSource, SpriteSheetEntry } from "../src/index.js";

const created: MapRenderer[] = [];
afterEach(() => {
  for (const renderer of created.splice(0)) renderer.dispose();
});

const PAGE = 2048;
/** Synthetic sheets the size of the install's `Tiles_187` (large piles 2) and `Tiles_93` (lamps). */
const SHEETS: readonly SpriteSheetEntry[] = [
  { kind: "tile", id: 187, page: 0, x: 0, y: 0, width: 1890, height: 72, frameWidth: 16, frameHeight: 16 },
  { kind: "tile", id: 93, page: 0, x: 1900, y: 0, width: 70, height: 2048, frameWidth: 16, frameHeight: 16 },
];

function sheetPixel(sheet: number, x: number, y: number): readonly [number, number, number, number] {
  return [(x * 7 + sheet * 90) % 256, (y * 5 + (x >> 8) * 31) % 256, ((x >> 4) * 13 + (y >> 4) * 17) % 256, 255];
}

function atlas(): SpriteAtlasSource {
  const page = new Uint8Array(PAGE * PAGE * 4);
  SHEETS.forEach((sheet, index) => {
    for (let y = 0; y < sheet.height; y++) {
      for (let x = 0; x < sheet.width; x++) page.set(sheetPixel(index, x, y), ((sheet.y + y) * PAGE + sheet.x + x) * 4);
    }
  });
  return { pages: [page], index: { pageSize: PAGE, entries: SHEETS } };
}

const ZOOM = 16;

test("frame-important tiles whose stored frame lies past the sheet's edge draw the wrapped cell", () => {
  // (block, frameX, frameY) per tile, left to right: piles inside the sheet and past its width, a lamp past its height.
  const tiles = [[0, 1872, 18], [0, 1890, 0], [0, 2952, 18], [1, 18, 2574], [1, 0, 36]] as const;
  const count = tiles.length;
  const world: RenderableWorld = {
    width: count, height: 1, surfaceY: 0,
    planes: {
      block: Uint16Array.from(tiles.map(([block]) => block)), wall: new Uint16Array(count).fill(0xffff),
      frameX: Int16Array.from(tiles.map(([, x]) => x)), frameY: Int16Array.from(tiles.map(([, , y]) => y)),
      liquid: new Uint8Array(count), liquidAmount: new Uint8Array(count), paint: new Uint8Array(count),
      wallPaint: new Uint8Array(count),
    },
    palette: [{ kind: "vanilla", id: 187 }, { kind: "vanilla", id: 93 }],
  };
  const canvas = document.createElement("canvas");
  canvas.width = count * ZOOM;
  canvas.height = ZOOM;
  const renderer = createMapRenderer(canvas);
  created.push(renderer);
  renderer.setWorld(world);
  renderer.setLayers({ background: false, walls: false, blocks: true, liquids: false });
  renderer.setAtlas(atlas());
  renderer.setSpriteMode(true);
  renderer.setCamera({ x: 0, y: 0, zoom: ZOOM });
  renderer.render();
  const gl = canvas.getContext("webgl2");
  if (gl === null) throw new Error("no webgl2 context");
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const mismatches: string[] = [];
  tiles.forEach(([block, frameX, frameY], tile) => {
    const [x, y] = wrappedFrame(SHEETS[block]?.id ?? -1, frameX, frameY);
    for (let sy = 0; sy < ZOOM; sy++) {
      for (let sx = 0; sx < ZOOM; sx++) {
        // readPixels rows are bottom-up.
        const at = ((ZOOM - 1 - sy) * canvas.width + tile * ZOOM + sx) * 4;
        const actual = [...pixels.subarray(at, at + 4)].join();
        const expected = sheetPixel(block, x + sx, y + sy).join();
        if (actual !== expected) mismatches.push(`tile ${String(tile)} (${String(sx)}, ${String(sy)}): ${actual} ≠ ${expected}`);
      }
    }
  });
  expect(mismatches.slice(0, 5), `${String(mismatches.length)} pixels differ`).toEqual([]);
});
