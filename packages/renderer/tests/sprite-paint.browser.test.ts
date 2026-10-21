import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { createWorld, type CanonicalWorld, type Tile } from "@studio/world-model";
import {
  createBlockFraming, createMapRenderer, inactiveSpriteColor, loadFramingDatabase, paintGroup, paintGroupOf, spritePaintedColor,
  terrariaFramingData,
} from "../src/index.js";
import type { BlockFraming, ChunkLayers, MapRenderer, SpriteAtlasSource, SpriteSheetEntry } from "../src/index.js";

let framing: BlockFraming;
beforeAll(async () => {
  framing = createBlockFraming(await loadFramingDatabase(terrariaFramingData));
});

const created: MapRenderer[] = [];
afterEach(() => {
  for (const renderer of created.splice(0)) renderer.dispose();
});

const ZOOM = 16;
const WIDTH = 9;
const HEIGHT = 3;
const ALL: ChunkLayers = { background: true, walls: true, blocks: true, liquids: true };
/** Bottles (13): drawn by the chunk pass. A plant (3, frame (0, 0)): drawn by the object pass. Stone wall (1). */
const BOTTLE = { kind: "vanilla", id: 13 } as const;
const PLANT = { kind: "vanilla", id: 3 } as const;
const STONE_WALL = { kind: "vanilla", id: 1 } as const;
/** Grass (2), drawn by the chunk pass with the dirt and grass special group. */
const GRASS = { kind: "vanilla", id: 2 } as const;

/** Each sheet is one opaque colour, so a sprite pixel's colour is its sheet's whatever the cell. */
const COLORS = { bottle: [85, 170, 136], plant: [200, 120, 40], wall: [51, 102, 153], grass: [102, 68, 51] } as const;
const PAGE = 512;
const SHEETS: readonly SpriteSheetEntry[] = [
  { kind: "tile", id: 13, page: 0, x: 0, y: 0, width: 16, height: 16, frameWidth: 16, frameHeight: 16 },
  { kind: "tile", id: 3, page: 0, x: 20, y: 0, width: 16, height: 20, frameWidth: 16, frameHeight: 20 },
  { kind: "wall", id: 1, page: 0, x: 0, y: 24, width: 468, height: 180, frameWidth: 32, frameHeight: 32 },
  { kind: "tile", id: 2, page: 0, x: 40, y: 0, width: 16, height: 16, frameWidth: 16, frameHeight: 16 },
];

function atlas(): SpriteAtlasSource {
  const page = new Uint8Array(PAGE * PAGE * 4);
  [COLORS.bottle, COLORS.plant, COLORS.wall, COLORS.grass].forEach((color, index) => {
    const sheet = SHEETS[index];
    if (sheet === undefined) throw new Error("no sheet");
    for (let y = 0; y < sheet.height; y++) {
      for (let x = 0; x < sheet.width; x++) page.set([...color, 255], ((sheet.y + y) * PAGE + sheet.x + x) * 4);
    }
  });
  return { pages: [page], index: { pageSize: PAGE, entries: SHEETS } };
}

/**
 * The world: a bottle in column 1, grass in column 2 and a plant in column 4 (row 1, each over nothing), stone walls in
 * columns 6–8.
 */
function world(bottle: Partial<Tile>, plant: Partial<Tile>, wallPaint: number, grass: Partial<Tile> = {}): CanonicalWorld {
  const built = createWorld(WIDTH, HEIGHT);
  built.setTile(2, 1, { block: GRASS, frameX: 0, frameY: 0, wires: 0, actuator: false, ...grass });
  built.setTile(1, 1, { block: BOTTLE, frameX: 0, frameY: 0, wires: 0, actuator: false, ...bottle });
  built.setTile(4, 1, { block: PLANT, frameX: 0, frameY: 0, wires: 0, actuator: false, ...plant });
  for (let x = 6; x < WIDTH; x++) for (let y = 0; y < HEIGHT; y++) built.setTile(x, y, { wall: STONE_WALL, wallPaint, wires: 0, actuator: false });
  return built;
}

/** The colours at the centres of the tiles in `columns` of row 1: by default the bottle, the plant and a wall. */
function draw(source: CanonicalWorld, layers: ChunkLayers = ALL, columns: readonly number[] = [1, 4, 7]): readonly (readonly number[])[] {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * ZOOM;
  canvas.height = HEIGHT * ZOOM;
  const renderer = createMapRenderer(canvas);
  created.push(renderer);
  renderer.setWorld({ width: source.width, height: source.height, surfaceY: 1, planes: source.planes, palette: source.palette });
  renderer.setLayers(layers);
  renderer.setAtlas(atlas());
  renderer.setFraming(framing);
  renderer.setSpriteMode(true);
  renderer.setCamera({ x: 0, y: 0, zoom: ZOOM });
  renderer.render();
  const gl = canvas.getContext("webgl2");
  if (gl === null) throw new Error("no webgl2 context");
  return columns.map((x) => {
    const out = new Uint8Array(4);
    gl.readPixels(x * ZOOM + ZOOM / 2, (HEIGHT - 1 - 1) * ZOOM + ZOOM / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
  });
}

function expectColors(actual: readonly (readonly number[])[], expected: readonly (readonly number[])[]): void {
  actual.forEach((color, index) => {
    color.forEach((channel, at) => {
      expect(Math.abs(channel - (expected[index]?.[at] ?? -9)), `${String(index)}: ${color.join(",")} vs ${String(expected[index])}`).toBeLessThanOrEqual(1);
    });
  });
}

describe("paint and the inactive shade on sprites", () => {
  test.each([1, 14, 26, 28, 29, 30])("paint %i colours block, object and wall sprites as the game does", (paint) => {
    expectColors(draw(world({ paint }, { paint }, paint)), [
      spritePaintedColor(COLORS.bottle, paint, "block"), spritePaintedColor(COLORS.plant, paint, "block"),
      spritePaintedColor(COLORS.wall, paint, "wall"),
    ]);
  });

  test("grass and dirt keep their earthy pixels under paints 1–12 and take the others, as the game's special group says", () => {
    const dirt = paintGroup(paintGroupOf("tile", 2));
    expectColors(draw(world({}, {}, 0, { paint: 1 }), ALL, [2]), [COLORS.grass]);
    expectColors(draw(world({}, {}, 0, { paint: 14 }), ALL, [2]), [spritePaintedColor(COLORS.grass, 14, "block", dirt)]);
  });

  test("with the paint layer hidden, sprites keep their own colours", () => {
    expectColors(draw(world({ paint: 5 }, { paint: 5 }, 5), { ...ALL, paint: false }), [COLORS.bottle, COLORS.plant, COLORS.wall]);
  });

  test("inactive tiles' sprites are shaded, after their paint", () => {
    expectColors(draw(world({ inactive: true }, { inactive: true, paint: 9 }, 0)), [
      inactiveSpriteColor(COLORS.bottle), inactiveSpriteColor(spritePaintedColor(COLORS.plant, 9, "block")), COLORS.wall,
    ]);
  });
});
