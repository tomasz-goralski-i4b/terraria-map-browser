// Trees in sprite mode (docs/assets.md, "Trees"): read-back pixels of a forest tree (trunk, branches, top), a palm and a
// gem tree against a synthetic atlas, drawn by the object pass over a wall and next to a block.
import { afterEach, describe, expect, test } from "vitest";
import { createMapRenderer, renderChunk } from "../src/index.js";
import type { ChunkLayers, MapRenderer, RenderableWorld, SpriteAtlasSource, SpriteSheetEntry } from "../src/index.js";

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
const WIDTH = 20;
const HEIGHT = 12;
const GROUND = 10;
const palette = [
  { kind: "vanilla", id: 5 }, { kind: "vanilla", id: 323 }, { kind: "vanilla", id: 583 }, { kind: "vanilla", id: 2 },
  { kind: "vanilla", id: 1 }, { kind: "vanilla", id: 53 }, { kind: "vanilla", id: 4 }, { kind: "mod", mod: "Example", internalName: "Crate" },
] as const;
const [TREE, PALM, GEM, GRASS, STONE, SAND, WALL, CRATE] = [0, 1, 2, 3, 4, 5, 6, 7] as const;

/** (x, y, palette index, frameX, frameY). */
const TILES: readonly (readonly [number, number, number, number, number])[] = [
  // A gem tree on stone at x = 3, a forest tree on grass at x = 9 (a crate beside its trunk), a palm on sand at x = 15.
  ...[1, 2, 3, 4, 5].map((x) => [x, GROUND, STONE, -1, -1] as const),
  ...[7, 8, 9, 10, 11].map((x) => [x, GROUND, GRASS, -1, -1] as const),
  ...[13, 14, 15, 16, 17].map((x) => [x, GROUND, SAND, -1, -1] as const),
  ...[6, 7, 8, 9].map((y) => [3, y, GEM, 0, y === 6 ? 22 : 0] as const),
  [2, 7, GEM, 44, 198], [4, 7, GEM, 66, 198], [3, 5, GEM, 22, 198],
  ...[6, 7, 8, 9].map((y) => [9, y, TREE, 0, 22 * (y - 6)] as const),
  [8, 7, TREE, 44, 220], [10, 7, TREE, 66, 220], [9, 5, TREE, 22, 220],
  [10, 9, CRATE, -1, -1],
  [15, 9, PALM, 66, 0], [15, 8, PALM, 22, 2], [15, 7, PALM, 0, 4], [15, 6, PALM, 88, 6],
];

function treeWorld(): RenderableWorld {
  const count = WIDTH * HEIGHT;
  const block = new Uint16Array(count).fill(ABSENT);
  const wall = new Uint16Array(count).fill(ABSENT);
  const frameX = new Int16Array(count).fill(-1);
  const frameY = new Int16Array(count).fill(-1);
  // A wall behind the forest tree.
  for (let x = 7; x <= 11; x++) for (let y = 3; y < GROUND; y++) wall[x * HEIGHT + y] = WALL;
  for (const [x, y, index, fx, fy] of TILES) {
    block[x * HEIGHT + y] = index;
    frameX[x * HEIGHT + y] = fx;
    frameY[x * HEIGHT + y] = fy;
  }
  return {
    width: WIDTH, height: HEIGHT, surfaceY: 3,
    planes: {
      block, wall, frameX, frameY, liquid: new Uint8Array(count), liquidAmount: new Uint8Array(count),
      paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
    },
    palette,
  };
}

const PAGE = 2048;
const SHEET_SIZES: readonly (readonly [SpriteSheetEntry["kind"], number, number, number])[] = [
  ["tile", 5, 1408, 264], ["tile", 323, 242, 176], ["tile", 583, 176, 264], ["treeTop", 0, 246, 82], ["treeTop", 15, 246, 328],
  ["treeTop", 22, 354, 98], ["treeBranch", 0, 84, 126], ["treeBranch", 22, 84, 126],
];
/** The sheets stacked down the page, 2 pixels apart. */
const SHEETS: readonly SpriteSheetEntry[] = SHEET_SIZES.reduce<SpriteSheetEntry[]>((sheets, [kind, id, width, height]) => {
  const last = sheets.at(-1);
  const y = last === undefined ? 2 : last.y + last.height + 2 + ((last.y + last.height) % 2);
  return [...sheets, { kind, id, page: 0, x: 2, y, width, height, frameWidth: 16, frameHeight: 16 }];
}, []);

/** Distinct per sheet and pixel; transparent on every third diagonal, so overlapping sprites show their order. */
function sheetPixel(sheet: number, x: number, y: number): Rgba {
  return [(x * 5 + sheet * 31) % 256, (y * 3 + sheet * 57) % 256, (x + y * 7) % 256, (x + y + sheet) % 3 === 0 ? 0 : 255];
}

function syntheticAtlas(): SpriteAtlasSource {
  const page = new Uint8Array(PAGE * PAGE * 4);
  SHEETS.forEach((sheet, index) => {
    for (let y = 0; y < sheet.height; y++) {
      for (let x = 0; x < sheet.width; x++) page.set(sheetPixel(index, x, y), ((sheet.y + y) * PAGE + sheet.x + x) * 4);
    }
  });
  return { pages: [page], index: { pageSize: PAGE, entries: SHEETS } };
}

/** A sprite as documented: a source rectangle on a sheet and the world sprite pixel of its top-left. */
interface Expected {
  readonly kind: SpriteSheetEntry["kind"];
  readonly id: number;
  readonly sx: number;
  readonly sy: number;
  readonly width: number;
  readonly height: number;
  readonly dx: number;
  readonly dy: number;
}

/**
 * The documented sprites (docs/assets.md, "Trees"), in drawing order: trunk cells column by column, each from the top
 * (20 × 20, 2 pixels left of the tile; a palm's shifted by its stored lean, its row by the sand), then the branches
 * (40 × 40 against the trunk, 12 pixels above the tile), then the tops (centred, bottom on the tile's bottom).
 */
function expectedSprites(): Expected[] {
  const trunk = (id: number, x: number, y: number, sx: number, sy: number, lean = 0): Expected =>
    ({ kind: "tile", id, sx, sy, width: 20, height: 20, dx: 16 * x - 2 + lean, dy: 16 * y });
  return [
    trunk(583, 2, 7, 44, 198), trunk(583, 3, 5, 22, 198), ...[6, 7, 8, 9].map((y) => trunk(583, 3, y, 0, y === 6 ? 22 : 0)),
    trunk(583, 4, 7, 66, 198),
    trunk(5, 8, 7, 44, 220), trunk(5, 9, 5, 22, 220), ...[6, 7, 8, 9].map((y) => trunk(5, 9, y, 0, 22 * (y - 6))),
    trunk(5, 10, 7, 66, 220),
    // Sand: palm row 0.
    trunk(323, 15, 6, 88, 0, 6), trunk(323, 15, 7, 0, 0, 4), trunk(323, 15, 8, 22, 0, 2), trunk(323, 15, 9, 66, 0, 0),
    // Gem tree (Tree_Branches_22, frame 0) and forest tree (Tree_Branches_0, variant 1: frame 1).
    { kind: "treeBranch", id: 22, sx: 0, sy: 0, width: 40, height: 40, dx: 16 * 2 + 16 - 40, dy: 16 * 7 - 12 },
    { kind: "treeBranch", id: 22, sx: 42, sy: 0, width: 40, height: 40, dx: 16 * 4, dy: 16 * 7 - 12 },
    { kind: "treeBranch", id: 0, sx: 0, sy: 42, width: 40, height: 40, dx: 16 * 8 + 16 - 40, dy: 16 * 7 - 12 },
    { kind: "treeBranch", id: 0, sx: 42, sy: 42, width: 40, height: 40, dx: 16 * 10, dy: 16 * 7 - 12 },
    { kind: "treeTop", id: 22, sx: 0, sy: 0, width: 116, height: 96, dx: 16 * 3 + 8 - 58, dy: 16 * 5 + 16 - 96 },
    { kind: "treeTop", id: 0, sx: 82, sy: 0, width: 80, height: 80, dx: 16 * 9 + 8 - 40, dy: 16 * 5 + 16 - 80 },
    { kind: "treeTop", id: 15, sx: 0, sy: 0, width: 80, height: 80, dx: 16 * 15 + 8 - 40 + 6, dy: 16 * 6 + 16 - 80 },
  ];
}

const LAYERS: ChunkLayers = { background: true, walls: true, blocks: true, liquids: true };
const ZOOM = 16;

/** The chunk pass's colours (a tree tile shows what lies behind it) with the documented sprites over them. */
function expectedCanvas(world: RenderableWorld): Uint8Array {
  const colors = (layers: ChunkLayers): Uint8ClampedArray => renderChunk(world as never, 0, 0, { surfaceY: world.surfaceY, layers }).pixels;
  const blocks = colors(LAYERS);
  const behind = colors({ ...LAYERS, blocks: false });
  const out = new Uint8Array(WIDTH * ZOOM * HEIGHT * ZOOM * 4);
  const sprites = expectedSprites();
  for (let py = 0; py < HEIGHT * ZOOM; py++) {
    for (let px = 0; px < WIDTH * ZOOM; px++) {
      const tx = Math.floor(px / ZOOM);
      const ty = Math.floor(py / ZOOM);
      const tile = TILES.find(([x, y]) => x === tx && y === ty);
      const pixels = tile !== undefined && [TREE, PALM, GEM].includes(tile[2] as never) ? behind : blocks;
      const at = (ty * WIDTH + tx) * 4;
      let color: Rgba = [pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0, pixels[at + 3] ?? 0];
      for (const sprite of sprites) {
        const lx = px - sprite.dx;
        const ly = py - sprite.dy;
        if (lx < 0 || ly < 0 || lx >= sprite.width || ly >= sprite.height) continue;
        const sheet = SHEETS.findIndex((entry) => entry.kind === sprite.kind && entry.id === sprite.id);
        const pixel = sheetPixel(sheet, sprite.sx + lx, sprite.sy + ly);
        if (pixel[3] !== 0) color = pixel;
      }
      out.set(color, (py * WIDTH * ZOOM + px) * 4);
    }
  }
  return out;
}

describe("trees in sprite mode", () => {
  test("a forest tree, a gem tree and a palm draw their documented cells and offsets over the wall; the block beside keeps its pixels", () => {
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH * ZOOM;
    canvas.height = HEIGHT * ZOOM;
    const renderer = createMapRenderer(canvas);
    created.push(renderer);
    const world = treeWorld();
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
        differing.push(`(${String((i / 4) % (WIDTH * ZOOM))}, ${String(Math.floor(i / 4 / (WIDTH * ZOOM)))})`);
      }
    }
    expect(differing.slice(0, 8), `${String(differing.length)} pixels differ`).toEqual([]);
  });
});
