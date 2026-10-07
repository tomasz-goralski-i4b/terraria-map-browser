import { describe, expect, it, vi } from "vitest";
import { createWorld, type BlockShape, type ContentRef, type Tile, type WorldPlanes } from "./index.js";

const emptyTile: Tile = { wires: 0, actuator: false };
const planeOrder = [
  "block", "wall", "frameX", "frameY", "paint", "wallPaint", "liquid", "liquidAmount", "shape", "flags",
] as const satisfies readonly (keyof WorldPlanes)[];

describe("CWM allocation", () => {
  it("allocates exactly the contract widths and sentinels for a 2 by 4 world", () => {
    const world = createWorld(2, 4);
    expect([world.width, world.height]).toEqual([2, 4]);
    expect(world.palette).toEqual([]);
    const expectedPlanes = [
      [world.planes.block, Uint16Array, 0xffff],
      [world.planes.wall, Uint16Array, 0xffff],
      [world.planes.frameX, Int16Array, -1],
      [world.planes.frameY, Int16Array, -1],
      [world.planes.paint, Uint8Array, 0],
      [world.planes.wallPaint, Uint8Array, 0],
      [world.planes.liquid, Uint8Array, 0],
      [world.planes.liquidAmount, Uint8Array, 0],
      [world.planes.shape, Uint8Array, 0],
      [world.planes.flags, Uint16Array, 0],
    ] as const;
    expect(Object.keys(world.planes)).toEqual([
      "block", "wall", "frameX", "frameY", "paint", "wallPaint", "liquid", "liquidAmount", "shape", "flags",
    ]);
    for (const [plane, constructor, sentinel] of expectedPlanes) {
      expect(plane).toBeInstanceOf(constructor);
      expect(plane.length).toBe(8);
      expect(plane.byteLength).toBe(8 * constructor.BYTES_PER_ELEMENT);
      expect(Array.from(plane)).toEqual(Array<number>(8).fill(sentinel));
    }
    expect(expectedPlanes.reduce((bytes, [plane]) => bytes + plane.byteLength, 0)).toBe(120);
    expect(world).not.toHaveProperty("tiles");
  });

  it.each([
    [0, 4], [-2, 4], [2, 0], [2, -4], [2.5, 4], [2, 4.5],
    [NaN, 4], [2, NaN], [Infinity, 4], [2, Infinity],
    [Number.MAX_SAFE_INTEGER + 1, 4], [2, Number.MAX_SAFE_INTEGER + 1],
    [Number.MAX_SAFE_INTEGER, 2], [Number.MAX_SAFE_INTEGER, 1],
  ])("rejects invalid or unsafe dimensions %s by %s before allocating", (width, height) => {
    const uint16 = vi.spyOn(globalThis, "Uint16Array");
    const int16 = vi.spyOn(globalThis, "Int16Array");
    const uint8 = vi.spyOn(globalThis, "Uint8Array");
    try {
      expect(() => createWorld(width, height)).toThrow(RangeError);
      expect(uint16).not.toHaveBeenCalled();
      expect(int16).not.toHaveBeenCalled();
      expect(uint8).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("reports 120 requested bytes and dimensions before allocating beyond the budget", () => {
    const uint16 = vi.spyOn(globalThis, "Uint16Array");
    const int16 = vi.spyOn(globalThis, "Int16Array");
    const uint8 = vi.spyOn(globalThis, "Uint8Array");
    try {
      expect(() => createWorld(2, 4, { maxBytes: 119 })).toThrow(RangeError);
      expect(() => createWorld(2, 4, { maxBytes: 119 })).toThrow(/120/);
      expect(() => createWorld(2, 4, { maxBytes: 119 })).toThrow(/2\s*[x×,]\s*4|width\D*2\D+height\D*4/i);
      expect(uint16).not.toHaveBeenCalled();
      expect(int16).not.toHaveBeenCalled();
      expect(uint8).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("accepts exactly the complete plane byte budget", () => {
    expect(createWorld(2, 4, { maxBytes: 120 }).planes.flags.length).toBe(8);
  });
});

describe("CWM palette and coordinates", () => {
  it("shares first-appearance references across planes and coordinates in a 2 by 4 world", () => {
    const world = createWorld(2, 4);
    world.setTile(0, 0, { ...emptyTile, block: { kind: "vanilla", id: 1 }, wall: { kind: "unknown", runtimeId: 400 } });
    world.setTile(0, 1, { ...emptyTile, block: { kind: "vanilla", id: 2 }, wall: { kind: "vanilla", id: 1 } });
    world.setTile(0, 2, emptyTile);
    world.setTile(0, 3, { ...emptyTile, wall: { kind: "unknown", runtimeId: 400 } });
    world.setTile(1, 0, { ...emptyTile, block: { kind: "mod", mod: "Calamity", internalName: "AstralDirt", runtimeId: 900, modVersion: "2.0.4" } });
    world.setTile(1, 1, { ...emptyTile, wall: { modVersion: "2.0.4", runtimeId: 900, internalName: "AstralDirt", mod: "Calamity", kind: "mod" } });
    world.setTile(1, 2, { ...emptyTile, block: { kind: "unknown", runtimeId: 400 } });
    world.setTile(1, 3, { ...emptyTile, block: { kind: "vanilla", id: 1 }, wall: { kind: "vanilla", id: 2 } });
    expect(world.palette).toEqual([
      { kind: "vanilla", id: 1 }, { kind: "unknown", runtimeId: 400 }, { kind: "vanilla", id: 2 },
      { kind: "mod", mod: "Calamity", internalName: "AstralDirt", runtimeId: 900, modVersion: "2.0.4" },
    ]);
    expect(Array.from(world.planes.block)).toEqual([0, 2, 0xffff, 0xffff, 3, 0xffff, 1, 0]);
    expect(Array.from(world.planes.wall)).toEqual([1, 0, 0xffff, 1, 0xffff, 3, 0xffff, 2]);
    for (const [x, y, blockIndex, wallIndex] of [[0, 0, 0, 1], [0, 3, 0xffff, 1], [1, 0, 3, 0xffff], [1, 3, 0, 2]] as const) {
      const tile = world.tileAt(x, y);
      expect(tile.block).toBe(blockIndex === 0xffff ? undefined : world.palette[blockIndex]);
      expect(tile.wall).toBe(wallIndex === 0xffff ? undefined : world.palette[wallIndex]);
    }
    expect(world.tileAt(0, 1).wall).toBe(world.tileAt(1, 3).block);
    expect(world.tileAt(1, 0).block).toBe(world.tileAt(1, 1).wall);
    expect(world.tileAt(0, 2)).toEqual(emptyTile);
  });

  it("keeps distinct vanilla and unknown refs with the same numeric id", () => {
    const world = createWorld(1, 1);
    world.setTile(0, 0, { ...emptyTile, block: { kind: "vanilla", id: 400 }, wall: { kind: "unknown", runtimeId: 400 } });
    expect(world.palette).toEqual([{ kind: "vanilla", id: 400 }, { kind: "unknown", runtimeId: 400 }]);
    expect(world.planes.block[0]).toBe(0);
    expect(world.planes.wall[0]).toBe(1);
  });

  it("reads current plane values into a fresh requested view", () => {
    const world = createWorld(2, 4);
    const earlier = world.tileAt(1, 3);
    world.planes.flags[7] = 0x21;
    const later = world.tileAt(1, 3);
    expect(later).not.toBe(earlier);
    expect(earlier).toEqual(emptyTile);
    expect(later).toEqual({ wires: 1, actuator: false, inactive: true });
    expect(world.tileAt(0, 3)).toEqual(emptyTile);
    expect(world.tileAt(1, 0)).toEqual(emptyTile);
  });

  it.each([[-1, 0], [0, -1], [2, 0], [0, 4], [0.5, 0], [0, 1.5], [NaN, 0], [0, NaN], [Infinity, 0], [0, Infinity]])(
    "rejects reads and writes outside integer bounds at %s,%s", (x, y) => {
      const world = createWorld(2, 4);
      expect(() => world.tileAt(x, y)).toThrow(RangeError);
      expect(() => { world.setTile(x, y, emptyTile); }).toThrow(RangeError);
      expect(world.palette).toEqual([]);
    },
  );
});

describe("CWM semantic views", () => {
  it("omits absent and default fields, including a stray liquid amount without a kind", () => {
    const world = createWorld(2, 4);
    world.planes.liquidAmount[7] = 255;
    expect(world.tileAt(1, 3)).toEqual(emptyTile);
  });

  it("encodes and views every semantic field with signed frame extremes", () => {
    const world = createWorld(2, 4);
    const tile: Tile = {
      block: { kind: "vanilla", id: 21 }, wall: { kind: "unknown", runtimeId: 400 },
      frameX: -32768, frameY: 32767, paint: 31, wallPaint: 30,
      liquid: { kind: "shimmer", amount: 255 }, shape: "slopeBottomLeft",
      wires: 15, actuator: true, inactive: true, invisibleBlock: true, invisibleWall: true,
      fullBrightBlock: true, fullBrightWall: true,
    };
    world.setTile(1, 3, tile);
    expect(world.tileAt(1, 3)).toEqual(tile);
    expect(planeOrder.map((name) => world.planes[name][7])).toEqual([0, 1, -32768, 32767, 31, 30, 4, 255, 5, 0x3ff]);
    expect(world.tileAt(0, 3)).toEqual(emptyTile);
    world.setTile(1, 3, emptyTile);
    expect(planeOrder.map((name) => world.planes[name][7])).toEqual([0xffff, 0xffff, -1, -1, 0, 0, 0, 0, 0, 0]);
    expect(world.tileAt(1, 3)).toEqual(emptyTile);
  });

  it("omits sentinel frames and zero paints on a present block and wall", () => {
    const world = createWorld(1, 1);
    const block: ContentRef = { kind: "vanilla", id: 1 };
    world.setTile(0, 0, { ...emptyTile, block, wall: block, paint: 0, wallPaint: 0 });
    expect(world.tileAt(0, 0)).toEqual({ ...emptyTile, block, wall: block });
    world.planes.frameX[0] = 0;
    world.planes.frameY[0] = 0;
    expect(world.tileAt(0, 0)).toEqual({ ...emptyTile, block, wall: block, frameX: 0, frameY: 0 });
  });

  it.each(["water", "lava", "honey", "shimmer"] as const)("preserves %s even at amount zero", (kind) => {
    const world = createWorld(2, 4);
    const code = { water: 1, lava: 2, honey: 3, shimmer: 4 }[kind];
    for (const amount of [0, 1, 255]) {
      world.setTile(1, 3, { ...emptyTile, liquid: { kind, amount } });
      expect(world.planes.liquid[7]).toBe(code);
      expect(world.planes.liquidAmount[7]).toBe(amount);
      expect(world.tileAt(1, 3)).toEqual({ ...emptyTile, liquid: { kind, amount } });
    }
  });

  it.each([
    [0, "full"], [1, "half"], [2, "slopeTopRight"], [3, "slopeTopLeft"], [4, "slopeBottomRight"], [5, "slopeBottomLeft"],
  ] satisfies [number, BlockShape][])("maps shape code %s to %s", (code, shape) => {
    const world = createWorld(1, 1);
    world.setTile(0, 0, { ...emptyTile, block: { kind: "vanilla", id: 1 }, shape });
    expect(world.planes.shape[0]).toBe(code);
    expect(world.tileAt(0, 0)).toEqual({ ...emptyTile, block: { kind: "vanilla", id: 1 }, ...(code === 0 ? {} : { shape }) });
  });

  it.each([
    [0, { wires: 1, actuator: false }], [1, { wires: 2, actuator: false }],
    [2, { wires: 4, actuator: false }], [3, { wires: 8, actuator: false }],
    [4, { wires: 0, actuator: true }], [5, { ...emptyTile, inactive: true }],
    [6, { ...emptyTile, invisibleBlock: true }], [7, { ...emptyTile, invisibleWall: true }],
    [8, { ...emptyTile, fullBrightBlock: true }], [9, { ...emptyTile, fullBrightWall: true }],
  ] satisfies [number, Tile][])("maps flag bit %s independently", (bit, tile) => {
    const world = createWorld(1, 1);
    world.planes.flags[0] = 1 << bit;
    expect(world.tileAt(0, 0)).toEqual(tile);
    world.setTile(0, 0, tile);
    expect(world.planes.flags[0]).toBe(1 << bit);
  });
});
