// Wires and actuators in sprite mode (docs/assets.md, "Wires"): read-back pixels of crossing red and blue wires and of
// actuators against a synthetic WiresNew and Actuator; hiding one colour removes exactly its pixels.
import { afterEach, describe, expect, test } from "vitest";
import { SPRITE_MIN_ZOOM, WIRE_LAYER, createMapRenderer, renderChunk } from "../src/index.js";
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
const WIDTH = 9;
const HEIGHT = 6;
const RED = WIRE_LAYER.red;
const BLUE = WIRE_LAYER.blue;
const ACTUATOR = WIRE_LAYER.actuator;

/** A red wire along row 2 (x 1–7) over a modded block at (2, 2), a blue one down column 4 crossing it, two actuators. */
function wireWorld(): RenderableWorld {
  const count = WIDTH * HEIGHT;
  const block = new Uint16Array(count).fill(ABSENT);
  const flags = new Uint16Array(count);
  const at = (x: number, y: number): number => x * HEIGHT + y;
  for (let x = 1; x <= 7; x++) flags[at(x, 2)] = RED;
  for (let y = 0; y < HEIGHT; y++) flags[at(4, y)] = (flags[at(4, y)] ?? 0) | BLUE;
  flags[at(5, 2)] = RED | ACTUATOR;
  flags[at(6, 4)] = ACTUATOR;
  block[at(2, 2)] = 0;
  return {
    width: WIDTH, height: HEIGHT, surfaceY: 3,
    planes: {
      block, wall: new Uint16Array(count).fill(ABSENT), flags, liquid: new Uint8Array(count), liquidAmount: new Uint8Array(count),
      paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
    },
    palette: [{ kind: "mod", mod: "Example", internalName: "Crate" }],
  };
}

const PAGE = 512;
const WIRES = { kind: "wire", id: 0, page: 0, x: 4, y: 2, width: 288, height: 288, frameWidth: 16, frameHeight: 16, gapX: 2, gapY: 2 } as const;
const ACTUATOR_SHEET = { kind: "actuator", id: 0, page: 0, x: 300, y: 2, width: 16, height: 16, frameWidth: 16, frameHeight: 16, gapX: 0, gapY: 0 } as const;

/** Distinct per sheet pixel; every fourth diagonal transparent, shifted per row of cells, so a wire drawn over another shows the one below. */
function sheetPixel(sheet: number, x: number, y: number): Rgba {
  return [(x * 3 + sheet * 101) % 256, (y * 7 + 13) % 256, (x * y + sheet * 50) % 256, (x + y + Math.floor(y / 18) + sheet) % 4 === 0 ? 0 : 255];
}

function syntheticAtlas(): SpriteAtlasSource {
  const page = new Uint8Array(PAGE * PAGE * 4);
  [WIRES, ACTUATOR_SHEET].forEach((sheet, index) => {
    for (let y = 0; y < sheet.height; y++) {
      for (let x = 0; x < sheet.width; x++) page.set(sheetPixel(index, x, y), ((sheet.y + y) * PAGE + sheet.x + x) * 4);
    }
  });
  return { pages: [page], index: { pageSize: PAGE, entries: [WIRES, ACTUATOR_SHEET] } };
}

function over(top: Rgba, below: Rgba): Rgba {
  return top[3] === 0 ? below : top;
}

const ZOOM = 16;
const BASE: ChunkLayers = { background: true, walls: true, blocks: true, liquids: true };

/**
 * The expected canvas: map colours (no wire overlay), then per shown colour, red to yellow, the WiresNew cell of the
 * colour's row and the column its same-colour side neighbours give (up 1, right 2, down 4, left 8), then the actuator.
 */
function expectedCanvas(world: RenderableWorld, shown: number): Uint8Array {
  const { pixels } = renderChunk(world as never, 0, 0, { surfaceY: world.surfaceY, layers: BASE });
  const flags = world.planes.flags ?? new Uint16Array(0);
  const flagsAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT ? 0 : flags[x * HEIGHT + y] ?? 0);
  const out = new Uint8Array(WIDTH * ZOOM * HEIGHT * ZOOM * 4);
  for (let py = 0; py < HEIGHT * ZOOM; py++) {
    for (let px = 0; px < WIDTH * ZOOM; px++) {
      const tx = Math.floor(px / ZOOM);
      const ty = Math.floor(py / ZOOM);
      const sx = px % ZOOM;
      const sy = py % ZOOM;
      const base = (ty * WIDTH + tx) * 4;
      let color: Rgba = [pixels[base] ?? 0, pixels[base + 1] ?? 0, pixels[base + 2] ?? 0, pixels[base + 3] ?? 0];
      const own = flagsAt(tx, ty) & shown;
      [WIRE_LAYER.red, WIRE_LAYER.blue, WIRE_LAYER.green, WIRE_LAYER.yellow].forEach((bit, row) => {
        if ((own & bit) === 0) return;
        const column = ((flagsAt(tx, ty - 1) & bit) !== 0 ? 1 : 0) | ((flagsAt(tx + 1, ty) & bit) !== 0 ? 2 : 0)
          | ((flagsAt(tx, ty + 1) & bit) !== 0 ? 4 : 0) | ((flagsAt(tx - 1, ty) & bit) !== 0 ? 8 : 0);
        color = over(sheetPixel(0, column * 18 + sx, row * 18 + sy), color);
      });
      if ((own & ACTUATOR) !== 0) color = over(sheetPixel(1, sx, sy), color);
      out.set(color, (py * WIDTH * ZOOM + px) * 4);
    }
  }
  return out;
}

/**
 * A renderer of `world` at `zoom` with the synthetic atlas; the returned function draws it with the wire mask `shown`,
 * in sprite mode or not. One renderer per test: each links its own programs, which is slow on software GL.
 */
function drawer(world: RenderableWorld, zoom = ZOOM): (shown: number, sprites?: boolean) => Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * zoom;
  canvas.height = HEIGHT * zoom;
  const renderer = createMapRenderer(canvas);
  created.push(renderer);
  renderer.setWorld(world);
  renderer.setAtlas(syntheticAtlas());
  renderer.setCamera({ x: 0, y: 0, zoom });
  return (shown, sprites = true) => {
    renderer.setLayers({ ...BASE, wires: shown });
    renderer.setSpriteMode(sprites);
    renderer.render();
    expect(canvas.getContext("webgl2")?.getError()).toBe(0);
    return readCanvas(canvas);
  };
}

function differing(actual: Uint8Array, expected: Uint8Array): string[] {
  const out: string[] = [];
  for (let i = 0; i < expected.length; i += 4) {
    if ([0, 1, 2, 3].some((k) => actual[i + k] !== expected[i + k])) {
      out.push(`(${String((i / 4) % (WIDTH * ZOOM))}, ${String(Math.floor(i / 4 / (WIDTH * ZOOM)))})`);
    }
  }
  return out;
}

describe("wires in sprite mode", () => {
  test("crossing red and blue wires take the pieces their neighbours give, over blocks, with actuators on top", () => {
    const world = wireWorld();
    const found = differing(drawer(world)(WIRE_LAYER.all), expectedCanvas(world, WIRE_LAYER.all));
    expect(found.slice(0, 8), `${String(found.length)} pixels differ`).toEqual([]);
  });

  test("hiding one colour removes exactly its pixels", () => {
    const world = wireWorld();
    const draw = drawer(world);
    const all = draw(WIRE_LAYER.all);
    const withoutRed = draw(WIRE_LAYER.all & ~RED);
    const found = differing(withoutRed, expectedCanvas(world, WIRE_LAYER.all & ~RED));
    expect(found.slice(0, 8), `${String(found.length)} pixels differ`).toEqual([]);
    // Every changed pixel lies on a red wire's tile; the blue wire's own tiles keep their blue pixels.
    const changed = differing(all, withoutRed).map((pixel) => {
      const [x, y] = pixel.slice(1, -1).split(", ").map(Number);
      return `${String(Math.floor((x ?? 0) / ZOOM))},${String(Math.floor((y ?? 0) / ZOOM))}`;
    });
    expect(changed.length).toBeGreaterThan(0);
    expect(new Set(changed)).toEqual(new Set(["1,2", "2,2", "3,2", "4,2", "5,2", "6,2", "7,2"]));
  });

  test(`below ${String(SPRITE_MIN_ZOOM)} pixels per tile the wires keep their colour overlay`, () => {
    const world = wireWorld();
    const draw = drawer(world, SPRITE_MIN_ZOOM - 1);
    const overlay = draw(WIRE_LAYER.all, false);
    expect(draw(WIRE_LAYER.all)).toEqual(overlay);
    // The overlay really shows: a red wire's tile differs from the same world without wires.
    expect(draw(0, false)).not.toEqual(overlay);
  });
});
