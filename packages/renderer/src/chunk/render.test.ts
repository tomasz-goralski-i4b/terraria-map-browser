import { describe, expect, test, vi } from "vitest";
import { createWorld } from "@studio/world-model";
import type { CanonicalWorld, Tile, WorldPlanes } from "@studio/world-model";
import { placeholderColor, renderChunk } from "../index.js";
import type { ChunkLayers, ChunkPixels, ChunkRenderOptions } from "../index.js";

const allLayers: ChunkLayers = { background: true, walls: true, blocks: true, liquids: true };
const options: ChunkRenderOptions = { surfaceY: 2, layers: allLayers };
const dirt = { kind: "vanilla", id: 0 } as const;
const stone = { kind: "vanilla", id: 1 } as const;

function mixedWorld(): CanonicalWorld {
  const world = createWorld(2, 4);
  const tiles: Tile[] = [
    { wires: 0, actuator: false },
    { wall: stone, wires: 0, actuator: false },
    { block: dirt, wall: stone, wires: 0, actuator: false },
    { block: stone, wall: dirt, liquid: { kind: "water", amount: 128 }, wires: 0, actuator: false },
    { liquid: { kind: "lava", amount: 255 }, wires: 0, actuator: false },
    { wall: stone, liquid: { kind: "honey", amount: 64 }, wires: 0, actuator: false },
    { block: dirt, liquid: { kind: "shimmer", amount: 192 }, wires: 0, actuator: false },
    { liquid: { kind: "water", amount: 0 }, wires: 0, actuator: false },
  ];
  tiles.forEach((tile, index) => { world.setTile(Math.floor(index / 4), index % 4, tile); });
  return world;
}

function pixel(chunk: ChunkPixels, x: number, y: number): number[] {
  const offset = (y * chunk.width + x) * 4;
  return Array.from(chunk.pixels.subarray(offset, offset + 4));
}

function chunks(world: CanonicalWorld): ChunkPixels[] {
  const result: ChunkPixels[] = [];
  for (let cx = 0; cx < Math.ceil(world.width / 128); cx++) {
    for (let cy = 0; cy < Math.ceil(world.height / 128); cy++) {
      result.push(renderChunk(world, cx, cy, options));
    }
  }
  return result;
}

describe("placeholder palette", () => {
  test.each([
    [0, [138, 171, 94, 255], [69, 85, 47, 255]],
    [1, [157, 173, 94, 255], [78, 86, 47, 255]],
    [2, [100, 168, 94, 255], [50, 84, 47, 255]],
    [25, [131, 92, 158, 255], [65, 46, 79, 255]],
  ] as const)("hashes vanilla id %i independently of palette position", (id, block, wall) => {
    expect(placeholderColor({ kind: "vanilla", id }, "block")).toEqual(block);
    expect(placeholderColor({ kind: "vanilla", id }, "wall")).toEqual(wall);
  });

  test("palette insertion order does not change a content colour", () => {
    const first = createWorld(2, 1);
    const second = createWorld(2, 1);
    first.setTile(0, 0, { block: dirt, wires: 0, actuator: false });
    first.setTile(1, 0, { block: stone, wires: 0, actuator: false });
    second.setTile(1, 0, { block: stone, wires: 0, actuator: false });
    second.setTile(0, 0, { block: dirt, wires: 0, actuator: false });
    expect(first.palette).not.toEqual(second.palette);
    const expected = new Uint8ClampedArray([138, 171, 94, 255, 157, 173, 94, 255]);
    expect(renderChunk(first, 0, 0, options).pixels).toEqual(expected);
    expect(renderChunk(second, 0, 0, options).pixels).toEqual(expected);
  });
});

test("renders every 2 × 4 pixel in background, wall, block, liquid order", () => {
  const chunk = renderChunk(mixedWorld(), 0, 0, options);
  expect(chunk.width).toBe(2);
  expect(chunk.height).toBe(4);
  expect(chunk.pixels).toBeInstanceOf(Uint8ClampedArray);
  expect(chunk.pixels).toEqual(new Uint8ClampedArray([
    100, 160, 220, 255, 255, 80, 20, 255,
    78, 86, 47, 255, 119, 110, 45, 255,
    138, 171, 94, 255, 170, 118, 204, 255,
    98, 141, 162, 255, 40, 30, 20, 255,
  ]));
});

test("repeats byte-identically, leaves planes and palette unchanged, and reads no tile views", () => {
  const world = mixedWorld();
  const planeNames = Object.keys(world.planes) as (keyof WorldPlanes)[];
  const planesBefore = Object.fromEntries(planeNames.map((name) => [name, world.planes[name].slice()]));
  const paletteBefore = world.palette.map((ref) => ({ ...ref }));
  const tileAt = vi.spyOn(world, "tileAt").mockImplementation(() => {
    throw new Error("Chunk rendering must read planes directly");
  });
  const first = renderChunk(world, 0, 0, options);
  for (let run = 0; run < 3; run++) {
    expect(renderChunk(world, 0, 0, options)).toEqual(first);
  }
  expect(world.planes).toEqual(planesBefore);
  expect(world.palette).toEqual(paletteBefore);
  expect(tileAt).not.toHaveBeenCalled();
});

test("renders all partial edge dimensions and contents of a 130 × 129 world", () => {
  const world = createWorld(130, 129);
  world.setTile(0, 0, { block: dirt, wires: 0, actuator: false });
  world.setTile(1, 0, { block: stone, wires: 0, actuator: false });
  for (let x = 0; x < world.width; x++) {
    for (let y = 0; y < world.height; y++) {
      world.planes.block[x * world.height + y] = (x + y) % 2;
    }
  }
  const rendered = chunks(world);
  expect(rendered.map(({ width, height }) => [width, height])).toEqual([
    [128, 128], [128, 1], [2, 128], [2, 1],
  ]);
  let covered = 0;
  rendered.forEach((chunk, index) => {
    expect(chunk.pixels.length).toBe(chunk.width * chunk.height * 4);
    const originX = Math.floor(index / 2) * 128;
    const originY = (index % 2) * 128;
    for (let x = 0; x < chunk.width; x++) {
      for (let y = 0; y < chunk.height; y++) {
        expect(pixel(chunk, x, y)).toEqual((originX + x + originY + y) % 2 === 0
          ? [138, 171, 94, 255] : [157, 173, 94, 255]);
        covered++;
      }
    }
  });
  expect(covered).toBe(130 * 129);
});

test.each([[127, 127], [128, 0], [0, 128], [129, 128]] as const)(
  "changing tile (%i, %i) changes one pixel of one chunk",
  (x, y) => {
    const world = createWorld(130, 129);
    const before = chunks(world);
    world.setTile(x, y, { block: stone, wires: 0, actuator: false });
    const after = chunks(world);
    const changed: { chunk: number; x: number; y: number }[] = [];
    after.forEach((chunk, index) => {
      const previous = before[index];
      if (previous === undefined) throw new Error("Missing baseline chunk");
      for (let px = 0; px < chunk.width; px++) {
        for (let py = 0; py < chunk.height; py++) {
          if (pixel(chunk, px, py).some((channel, i) => channel !== pixel(previous, px, py)[i])) {
            changed.push({ chunk: index, x: px, y: py });
          }
        }
      }
    });
    expect(changed).toEqual([{ chunk: Math.floor(x / 128) * 2 + Math.floor(y / 128), x: x % 128, y: y % 128 }]);
  },
);

test.each([
  ["background", [0, 0, 0, 0, 78, 86, 47, 255, 98, 141, 162, 255]],
  ["walls", [100, 160, 220, 255, 100, 160, 220, 255, 98, 141, 162, 255]],
  ["blocks", [100, 160, 220, 255, 78, 86, 47, 255, 59, 98, 139, 255]],
  ["liquids", [100, 160, 220, 255, 78, 86, 47, 255, 157, 173, 94, 255]],
] as const)("disabling %s removes exactly its contribution", (layer, expected) => {
  const world = createWorld(3, 1);
  world.setTile(1, 0, { wall: stone, wires: 0, actuator: false });
  world.setTile(2, 0, { wall: stone, block: stone, liquid: { kind: "water", amount: 128 }, wires: 0, actuator: false });
  expect(renderChunk(world, 0, 0, options).pixels).toEqual(new Uint8ClampedArray([
    100, 160, 220, 255, 78, 86, 47, 255, 98, 141, 162, 255,
  ]));
  expect(renderChunk(world, 0, 0, { ...options, layers: { ...allLayers, [layer]: false } }).pixels)
    .toEqual(new Uint8ClampedArray(expected));
});

test("all disabled layers are transparent and liquid alone retains straight alpha", () => {
  const world = mixedWorld();
  const disabled: ChunkLayers = { background: false, walls: false, blocks: false, liquids: false };
  expect(renderChunk(world, 0, 0, { ...options, layers: disabled }).pixels).toEqual(new Uint8ClampedArray(32));
  expect(renderChunk(world, 0, 0, { ...options, layers: { ...disabled, liquids: true } }).pixels)
    .toEqual(new Uint8ClampedArray([
      0, 0, 0, 0, 255, 80, 20, 255,
      0, 0, 0, 0, 240, 180, 40, 64,
      0, 0, 0, 0, 180, 100, 240, 192,
      40, 110, 230, 128, 0, 0, 0, 0,
    ]));
});

test("unknown and mod block and wall refs use the marker colour", () => {
  const world = createWorld(4, 1);
  const unknown = { kind: "unknown", runtimeId: 900 } as const;
  const mod = { kind: "mod", mod: "CalamityMod", internalName: "AstralStone", runtimeId: 1200, modVersion: "2.0.4" } as const;
  [
    { block: unknown, wall: stone }, { wall: unknown },
    { block: mod, wall: stone }, { wall: mod },
  ].forEach((content, x) => { world.setTile(x, 0, { ...content, wires: 0, actuator: false }); });
  expect(renderChunk(world, 0, 0, options).pixels).toEqual(new Uint8ClampedArray([
    255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255,
  ]));
  for (const ref of [unknown, mod]) {
    expect(placeholderColor(ref, "block")).toEqual([255, 0, 255, 255]);
    expect(placeholderColor(ref, "wall")).toEqual([255, 0, 255, 255]);
  }
});

test.each([
  [-1, 0], [0, -1], [2, 0], [0, 2], [0.5, 0], [0, Number.NaN], [Number.POSITIVE_INFINITY, 0],
] as const)("rejects chunk (%s, %s) outside a 130 × 129 world", (chunkX, chunkY) => {
  const world = createWorld(130, 129);
  expect(() => renderChunk(world, chunkX, chunkY, options)).toThrow(
    new RangeError(`Chunk (${String(chunkX)}, ${String(chunkY)}) is outside the 2 × 2 chunk grid of a 130 × 129 world`),
  );
});

test("hashes each palette entry once across chunks and colours entries added later", () => {
  const world = createWorld(130, 1);
  world.setTile(0, 0, { block: dirt, wall: stone, wires: 0, actuator: false });
  const imul = vi.spyOn(Math, "imul");
  try {
    renderChunk(world, 0, 0, options);
    const firstRender = imul.mock.calls.length;
    expect(firstRender).toBeGreaterThan(0);
    renderChunk(world, 1, 0, options);
    renderChunk(world, 0, 0, options);
    expect(imul.mock.calls.length).toBe(firstRender);
  } finally {
    imul.mockRestore();
  }
  world.setTile(129, 0, { block: { kind: "vanilla", id: 25 }, wires: 0, actuator: false });
  expect(pixel(renderChunk(world, 1, 0, options), 1, 0)).toEqual([131, 92, 158, 255]);
});
