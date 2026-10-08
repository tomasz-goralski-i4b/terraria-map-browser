import { describe, expect, it } from "vitest";
import {
  createWorld, CwmViewError, viewWorld, type CanonicalWorld, type Tile, type WorldPlanes,
} from "./index.js";

const W = 3;
const H = 4;

function sampleTile(x: number, y: number): Tile {
  const n = x * H + y;
  const tile: Tile = { wires: n % 16, actuator: n % 2 === 0 };
  if (n % 3 !== 0) tile.block = { kind: "vanilla", id: n % 5 };
  if (n % 4 !== 0) tile.wall = { kind: "unknown", runtimeId: 900 + (n % 2) };
  if (n % 5 === 0) { tile.frameX = n; tile.frameY = -n; }
  if (n % 6 === 0) { tile.paint = 7; tile.wallPaint = 9; }
  if (n % 7 === 0) tile.liquid = { kind: "lava", amount: 200 };
  if (n % 8 === 0) tile.shape = "half";
  if (n % 9 === 0) tile.inactive = true;
  return tile;
}

function filled(): CanonicalWorld {
  const world = createWorld(W, H);
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) world.setTile(x, y, sampleTile(x, y));
  return world;
}

function clonePlanes(planes: WorldPlanes): WorldPlanes {
  return {
    block: planes.block.slice(), wall: planes.wall.slice(), frameX: planes.frameX.slice(),
    frameY: planes.frameY.slice(), paint: planes.paint.slice(), wallPaint: planes.wallPaint.slice(),
    liquid: planes.liquid.slice(), liquidAmount: planes.liquidAmount.slice(),
    shape: planes.shape.slice(), flags: planes.flags.slice(),
  };
}

function codeOf(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(CwmViewError);
    return (error as CwmViewError).code;
  }
  return "no error";
}

describe("viewWorld", () => {
  it("tileAt_overDecodedPlanes_matchesWorldBuiltWithSetTile", () => {
    const expected = filled();
    const view = viewWorld(W, H, clonePlanes(expected.planes), [...expected.palette]);
    expect([view.width, view.height]).toEqual([W, H]);
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
      expect(view.tileAt(x, y)).toEqual(expected.tileAt(x, y));
    }
  });

  it("setTile_throughView_changesTheOriginalArraysInPlace", () => {
    const source = filled();
    const planes = clonePlanes(source.planes);
    const buffers = Object.values(planes).map((plane) => plane.buffer);
    const view = viewWorld(W, H, planes, [...source.palette]);

    view.setTile(1, 2, { block: { kind: "vanilla", id: 4 }, paint: 3, wires: 5, actuator: true });

    expect(view.planes.block).toBe(planes.block);
    expect(Object.values(view.planes).map((plane) => plane.buffer)).toEqual(buffers);
    expect(Object.values(planes).map((plane) => plane.buffer)).toEqual(buffers);
    expect(planes.paint[1 * H + 2]).toBe(3);
    expect(view.tileAt(1, 2)).toMatchObject({ block: { kind: "vanilla", id: 4 }, paint: 3, wires: 5, actuator: true });
  });

  it("setTile_newContent_internsIntoThePaletteAndWritesItsIndex", () => {
    const source = filled();
    const planes = clonePlanes(source.planes);
    const view = viewWorld(W, H, planes, [...source.palette]);
    const before = view.palette.length;
    view.setTile(0, 0, { block: { kind: "mod", mod: "M", internalName: "N" }, wires: 0, actuator: false });
    expect(view.palette).toHaveLength(before + 1);
    expect(planes.block[0]).toBe(before);
  });

  it("viewWorld_planeWithWrongLength_throwsCwmViewError", () => {
    const bad = { ...clonePlanes(filled().planes), wall: new Uint16Array(W * H - 1) };
    expect(codeOf(() => viewWorld(W, H, bad, []))).toBe("planeLength");
  });

  it("viewWorld_planeOfWrongTypedArrayType_throwsCwmViewError", () => {
    const bad = { ...clonePlanes(filled().planes), frameX: new Uint16Array(W * H) } as unknown as WorldPlanes;
    expect(codeOf(() => viewWorld(W, H, bad, []))).toBe("planeType");
  });

  it("viewWorld_blockIndexOutsidePalette_throwsCwmViewError", () => {
    const source = filled();
    const planes = clonePlanes(source.planes);
    planes.block[2] = source.palette.length;
    expect(codeOf(() => viewWorld(W, H, planes, [...source.palette]))).toBe("paletteIndex");
  });

  it("viewWorld_wallIndexOutsidePalette_throwsCwmViewError", () => {
    const source = filled();
    const planes = clonePlanes(source.planes);
    planes.wall[5] = 60000;
    expect(codeOf(() => viewWorld(W, H, planes, [...source.palette]))).toBe("paletteIndex");
  });

  it("viewWorld_invalidDimensions_throwsCwmViewError", () => {
    expect(codeOf(() => viewWorld(0, H, clonePlanes(filled().planes), []))).toBe("dimensions");
  });
});
