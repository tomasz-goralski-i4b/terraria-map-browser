// Waterfalls in sprite mode (docs/assets.md, "Waterfalls"): read-back pixels of a waterfall drawn from a synthetic
// Waterfall_0 by the object pass, mirrored when it flows right; hiding the liquids removes it.
import { afterEach, describe, expect, test } from "vitest";
import { createMapRenderer, waterfallSprites } from "../src/index.js";
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
const WIDTH = 6;
const HEIGHT = 5;
const ZOOM = 16;

/** A basin of stone at the left with water and its half block at (2, 0); the stream falls in column 3 to the floor. */
function basinWorld(rows: readonly string[] = ["#~h...", "###...", "......", "......", "######"]): RenderableWorld {
  const count = WIDTH * HEIGHT;
  const block = new Uint16Array(count).fill(ABSENT);
  const shape = new Uint8Array(count);
  const liquid = new Uint8Array(count);
  const liquidAmount = new Uint8Array(count);
  rows.forEach((row, y) => {
    Array.from(row).forEach((char, x) => {
      const i = x * HEIGHT + y;
      if (char === "#" || char === "h") block[i] = 0;
      if (char === "h") shape[i] = 1;
      if (char === "~") { liquid[i] = 1; liquidAmount[i] = 255; }
    });
  });
  return {
    width: WIDTH, height: HEIGHT, surfaceY: 4,
    planes: { block, wall: new Uint16Array(count).fill(ABSENT), liquid, liquidAmount, paint: new Uint8Array(count), wallPaint: new Uint8Array(count), shape },
    palette: [{ kind: "mod", mod: "Example", internalName: "Stone" }],
  };
}

const PAGE = 512;
const SHEET = { kind: "waterfall", id: 0, page: 0, x: 4, y: 2, width: 64, height: 40, frameWidth: 32, frameHeight: 40 } as const;

/** Opaque and distinct per sheet pixel. */
function sheetPixel(x: number, y: number): Rgba {
  return [(x * 7 + 11) % 256, (y * 5 + 3) % 256, (x * y + 90) % 256, 255];
}

function syntheticAtlas(): SpriteAtlasSource {
  const page = new Uint8Array(PAGE * PAGE * 4);
  for (let y = 0; y < SHEET.height; y++) for (let x = 0; x < SHEET.width; x++) page.set(sheetPixel(x, y), ((SHEET.y + y) * PAGE + SHEET.x + x) * 4);
  return { pages: [page], index: { pageSize: PAGE, entries: [SHEET] } };
}

const ALL: ChunkLayers = { background: true, walls: true, blocks: true, liquids: true };

function drawer(world: RenderableWorld): (layers: ChunkLayers) => Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * ZOOM;
  canvas.height = HEIGHT * ZOOM;
  const renderer = createMapRenderer(canvas);
  created.push(renderer);
  renderer.setWorld(world);
  renderer.setAtlas(syntheticAtlas());
  renderer.setCamera({ x: 0, y: 0, zoom: ZOOM });
  renderer.setSpriteMode(true);
  return (layers) => {
    renderer.setLayers(layers);
    renderer.render();
    expect(canvas.getContext("webgl2")?.getError()).toBe(0);
    return readCanvas(canvas);
  };
}

function at(pixels: Uint8Array, x: number, y: number): Rgba {
  const i = (y * WIDTH * ZOOM + x) * 4;
  return [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0, pixels[i + 3] ?? 0];
}

describe("waterfalls in sprite mode", () => {
  test("the stream's sprites show their sheet pixels, mirrored, at their places behind the blocks; hiding liquids removes them", () => {
    const world = basinWorld();
    const sprites = waterfallSprites(world, { left: 0, top: 0, right: WIDTH, bottom: HEIGHT });
    const draw = drawer(world);
    const shown = draw(ALL);
    // The last sprite of each kind wins where they overlap (drawn in order); check the pixels of the last one covering each.
    let checked = 0;
    for (let py = 0; py < HEIGHT * ZOOM; py++) {
      for (let px = 0; px < WIDTH * ZOOM; px++) {
        const covering = sprites.filter((s) => px >= s.dx && px < s.dx + s.width && py >= s.dy && py < s.dy + s.height).at(-1);
        // Waterfalls lie behind the blocks (G): the basin's map-coloured stone covers them.
        if (covering === undefined || world.planes.block[Math.floor(px / ZOOM) * HEIGHT + Math.floor(py / ZOOM)] !== ABSENT) continue;
        const ox = px - covering.dx;
        const sx = covering.sx + (covering.flip === true ? covering.width - 1 - ox : ox);
        const sy = covering.sy + py - covering.dy;
        expect(at(shown, px, py), `(${String(px)}, ${String(py)})`).toEqual(sheetPixel(sx, sy));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
    const hidden = draw({ ...ALL, liquids: false });
    const column = sprites[1];
    if (column === undefined) throw new Error("no column sprite");
    // A pixel of the column in the air beside the wall (its first 4 pixels lie behind the wall).
    expect(at(hidden, column.dx + 6, column.dy + 4)).not.toEqual(at(shown, column.dx + 6, column.dy + 4));
    // Waterfalls belong to the liquids layer: hiding the blocks keeps them.
    const blocksHidden = draw({ ...ALL, blocks: false });
    expect(at(blocksHidden, column.dx + 6, column.dy + 4)).toEqual(at(shown, column.dx + 6, column.dy + 4));
  });

  test("liquid covers the waterfall: the corner pouring off a ledge into a pool is hidden under the pool's water", () => {
    // The stream lands on the block at (3, 3), pours off it to the right into the pool at (4, 3); its corner hangs down
    // into the pool's tile.
    const rows = ["#~h...", "###...", "......", "...#~~", "######"];
    const sprites = waterfallSprites(basinWorld(rows), { left: 0, top: 0, right: WIDTH, bottom: HEIGHT });
    const pool = { left: 4 * ZOOM, top: 3 * ZOOM };
    const hanging = sprites.filter((s) => s.dx + s.width > pool.left && s.dy + s.height > pool.top && s.dx < pool.left + ZOOM);
    expect(hanging.length).toBeGreaterThan(0);
    // The same world without its source (a full block instead of the half block): no waterfall at all.
    const shown = drawer(basinWorld(rows))(ALL);
    const without = drawer(basinWorld(["#~#...", ...rows.slice(1)]))(ALL);
    for (let py = pool.top; py < pool.top + ZOOM; py++) {
      for (let px = pool.left; px < pool.left + ZOOM; px++) expect(at(shown, px, py), `(${String(px)}, ${String(py)})`).toEqual(at(without, px, py));
    }
  });
});
