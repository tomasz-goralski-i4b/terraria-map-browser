// Underground backgrounds in sprite mode (docs/assets.md, "Cave backgrounds"): read-back pixels of empty tiles across
// the dirt band, the rock edge and the rock band, against synthetic Background_<n> sheets.
import { afterEach, describe, expect, test } from "vitest";
import { createWorld } from "@studio/world-model";
import { CHUNK_SIZE, caveBackgroundBands, createMapRenderer, renderChunk } from "../src/index.js";
import type { CaveBackgroundSettings, ChunkLayers, MapRenderer, RenderableWorld, SpriteAtlasSource, SpriteSheetEntry } from "../src/index.js";

const created: MapRenderer[] = [];
afterEach(() => {
  for (const renderer of created.splice(0)) renderer.dispose();
});

type Rgba = readonly [number, number, number, number];

const ZOOM = 16;
const PAGE = 512;
const ALL: ChunkLayers = { background: true, walls: true, blocks: true, liquids: true };
// The last zone (past column 300) in style 1 + 3: dirt Background_71, rock edge 68, rock 72.
const CAVES: CaveBackgroundSettings = {
  caveBackX: [100, 200, 300], caveBackStyles: [0, 0, 0, 1], iceBackStyle: 0, jungleBackStyle: 0, hellBackStyle: 0, worldId: 0,
};
const SHEETS: readonly SpriteSheetEntry[] = [
  { kind: "background", id: 71, page: 0, x: 2, y: 2, width: 160, height: 96, frameWidth: 0, frameHeight: 0 },
  { kind: "background", id: 68, page: 0, x: 2, y: 102, width: 160, height: 16, frameWidth: 0, frameHeight: 0 },
  { kind: "background", id: 72, page: 0, x: 2, y: 122, width: 160, height: 96, frameWidth: 0, frameHeight: 0 },
];

/** Distinct opaque pixels per sheet. */
function sheetPixel(sheet: number, x: number, y: number): Rgba {
  return [(x * 3 + sheet * 80) % 256, (y * 5 + 10) % 256, (x + y + sheet * 60) % 256, 255];
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

// An empty world 600 × 1200, surface 300, rock 400, a stone wall at (403, 402); the view shows rows 401–405 of
// columns 400–403, away from the beaches.
const LEFT = 400;
const TOP = 401;
const COLUMNS = 4;
const ROWS = 5;

function caveWorld(caves: CaveBackgroundSettings | undefined): RenderableWorld {
  const world = createWorld(600, 1200);
  world.setTile(LEFT + 3, TOP + 1, { wall: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  return {
    width: world.width, height: world.height, surfaceY: 300, rockY: 400, planes: world.planes, palette: world.palette,
    ...(caves === undefined ? {} : { caves }),
  };
}

function draw(world: RenderableWorld): (x: number, y: number) => Rgba {
  const canvas = document.createElement("canvas");
  canvas.width = COLUMNS * ZOOM;
  canvas.height = ROWS * ZOOM;
  const renderer = createMapRenderer(canvas);
  created.push(renderer);
  renderer.setWorld(world);
  renderer.setLayers(ALL);
  renderer.setAtlas(syntheticAtlas());
  renderer.setSpriteMode(true);
  renderer.setCamera({ x: LEFT, y: TOP, zoom: ZOOM });
  renderer.render();
  const pixels = readCanvas(canvas);
  // The pixel at world pixel (x, y).
  return (x, y) => {
    const i = ((y - TOP * ZOOM) * canvas.width + x - LEFT * ZOOM) * 4;
    return [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0, pixels[i + 3] ?? 0];
  };
}

/** The background map colour of tile row `y`. */
function mapBackground(world: RenderableWorld, y: number): Rgba {
  const { pixels } = renderChunk(world as never, Math.floor(LEFT / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE), {
    surfaceY: world.surfaceY, rockY: 400, layers: { background: true, walls: false, blocks: false, liquids: false },
  });
  const i = (y % CHUNK_SIZE) * CHUNK_SIZE * 4;
  return [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0, 255];
}

/** The sheet pixel the game shows at world pixel (x, y), dimmed to 0.9. */
function expected(x: number, y: number): Rgba {
  const { bands } = caveBackgroundBands(300, 400, 1200);
  const rockEdge = bands[2] ?? 0;
  const rock = bands[3] ?? 0;
  const [sheet, v] = y < rockEdge ? [0, (y - (bands[1] ?? 0)) % 96] : y < rock ? [1, y - rockEdge] : [2, (y - rock) % 96];
  const color = sheetPixel(sheet, 16 + (x % 128), v);
  const dim = (value: number): number => Math.floor((value * 9 + 5) / 10);
  return [dim(color[0]), dim(color[1]), dim(color[2]), 255];
}

describe("underground backgrounds drawn as the game draws them", () => {
  test("empty tiles show their band's sheet of their zone's style", () => {
    const pixel = draw(caveWorld(CAVES));
    // Rows 401–402 lie in the dirt band, row 403 is the rock edge, rows 404–405 the rock band.
    for (const [x, y] of [[6400, 6416], [6417, 6431], [6430, 6447], [6401, 6448], [6431, 6463], [6402, 6464], [6420, 6490]] as const) {
      expect(pixel(x, y), `(${String(x)}, ${String(y)})`).toEqual(expected(x, y));
    }
  });

  test("a wall covers the background", () => {
    const pixel = draw(caveWorld(CAVES));
    expect(pixel((LEFT + 3) * 16 + 8, (TOP + 1) * 16 + 8)).not.toEqual(expected((LEFT + 3) * 16 + 8, (TOP + 1) * 16 + 8));
  });

  test("without the header's settings empty tiles keep the background's map colour", () => {
    const world = caveWorld(undefined);
    const pixel = draw(world);
    expect(pixel(6400, 6416)).toEqual(mapBackground(world, TOP));
  });
});
