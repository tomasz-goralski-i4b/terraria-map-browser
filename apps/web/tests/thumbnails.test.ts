import { beforeAll, expect, test, vi } from "vitest";
import { packSheets } from "@studio/assets";
import { createBlockFraming, loadFramingDatabase, terrariaFramingData, wallSourceRect, WALL_OVERHANG, type BlockFraming } from "@studio/renderer";
import { ThumbnailSource, thumbnailPixels } from "../src/assets/thumbnails.js";
import { createWorld } from "@studio/world-model";

let framing: BlockFraming;
beforeAll(async () => { framing = createBlockFraming(await loadFramingDatabase(terrariaFramingData)); });

function sheetPixels(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([x % 256, y % 256, (x + y) % 256, 255], (y * width + x) * 4);
  return pixels;
}

function expectedPixels(x: number, y: number, width = 16, height = 16): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    pixels.set([(x + column) % 256, (y + row) % 256, (x + column + y + row) % 256, 255], (row * width + column) * 4);
  }
  return pixels;
}

function atlas() {
  return packSheets([
    { kind: "tile", id: 0, width: 288, height: 270, rgba: sheetPixels(288, 270) },
    { kind: "tile", id: 38, width: 288, height: 270, rgba: sheetPixels(288, 270) },
    { kind: "tile", id: 21, width: 288, height: 270, rgba: sheetPixels(288, 270) },
    { kind: "tile", id: 3, width: 72, height: 88, rgba: sheetPixels(72, 88) },
    { kind: "wall", id: 1, width: 468, height: 468, rgba: sheetPixels(468, 468) },
  ], { pageSize: 1024 });
}

test.each([0, 38])("interior block %i reads its framing cell and is built once", (id) => {
  const frameBlock = vi.fn(framing.frameBlock);
  const source = new ThumbnailSource(atlas(), { ...framing, frameBlock });
  const ref = { kind: "vanilla", id } as const;
  const cell = framing.frameBlock({ type: id, shape: 0, x: 0, y: 0, neighbours: new Int32Array(8).fill(id) });
  expect(cell).not.toBeNull();
  const thumbnail = source.material("block", ref);
  expect(thumbnail?.pixels).toEqual(expectedPixels((cell?.column ?? 0) * 18, (cell?.row ?? 0) * 18));
  expect(source.material("block", ref)).toBe(thumbnail);
  expect(frameBlock).toHaveBeenCalledTimes(1);
});

test("wall crops the 16 pixel centre without its overhang or gutter", () => {
  const source = new ThumbnailSource(atlas(), framing);
  const rect = wallSourceRect(framing.walls.wallCell(1, 15, 0, 0));
  expect(rect).not.toBeNull();
  const x = (rect?.x ?? 0) + WALL_OVERHANG;
  const y = (rect?.y ?? 0) + WALL_OVERHANG;
  const thumbnail = source.material("wall", { kind: "vanilla", id: 1 });
  expect(thumbnail?.pixels.slice(0, 4)).toEqual(new Uint8ClampedArray([x, y, (x + y) % 256, 255]));
  expect(thumbnail?.pixels.slice(-4)).toEqual(new Uint8ClampedArray([x + 15, y + 15, (x + y + 30) % 256, 255]));
  expect(thumbnail?.pixels).toEqual(expectedPixels(x, y));
});

test("Inspector uses stored chest frames, real block neighbours and real wall neighbours", () => {
  const world = createWorld(4, 4);
  world.setTile(1, 1, { block: { kind: "vanilla", id: 21 }, frameX: 36, frameY: 18, wires: 0, actuator: false });
  world.setTile(2, 2, { block: { kind: "vanilla", id: 38 }, wall: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  world.setTile(3, 2, { block: { kind: "vanilla", id: 38 }, wall: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  const source = new ThumbnailSource(atlas(), framing);
  const chest = world.tileAt(1, 1);
  expect(source.tile("block", { kind: "vanilla", id: 21 }, { world, x: 1, y: 1, tile: chest })?.pixels).toEqual(expectedPixels(36, 18));
  const cells = new Uint16Array(1);
  framing.frameRegion(world, { left: 2, top: 2, width: 1, height: 1 }, cells);
  const cell = cells[0] ?? 0;
  const tile = world.tileAt(2, 2);
  expect(source.tile("block", { kind: "vanilla", id: 38 }, { world, x: 2, y: 2, tile })?.pixels).toEqual(expectedPixels((cell >> 6) * 18, (cell & 63) * 18));
  const rect = wallSourceRect(framing.walls.cellAt(world, 2, 2));
  expect(rect).not.toBeNull();
  expect(source.tile("wall", { kind: "vanilla", id: 1 }, { world, x: 2, y: 2, tile })?.pixels).toEqual(expectedPixels((rect?.x ?? 0) + 8, (rect?.y ?? 0) + 8));
});

test("missing, unknown and out of sheet content has no thumbnail", () => {
  const packed = atlas();
  const source = new ThumbnailSource(packed, framing);
  expect(source.material("block", { kind: "vanilla", id: 1 })).toBeNull();
  expect(source.material("wall", { kind: "vanilla", id: 2 })).toBeNull();
  expect(source.material("block", { kind: "unknown", runtimeId: 900 })).toBeNull();
  expect(thumbnailPixels(packed, "block", 0, 280, 0)).toBeNull();
  expect(thumbnailPixels(packed, "block", 0, 0, 260)).toBeNull();
  expect(thumbnailPixels(packed, "wall", 1, -1, 0)).toBeNull();
  expect(new ThumbnailSource(packed, { ...framing, frameBlock: () => null }).material("block", { kind: "vanilla", id: 0 })).toBeNull();
});

test("stored non-square object frames retain the atlas cell dimensions", () => {
  const world = createWorld(2, 2);
  world.setTile(1, 1, { block: { kind: "vanilla", id: 3 }, frameX: 18, frameY: 22, wires: 0, actuator: false });
  const thumbnail = new ThumbnailSource(atlas(), framing).tile("block", { kind: "vanilla", id: 3 }, { world, x: 1, y: 1, tile: world.tileAt(1, 1) });
  expect(thumbnail?.width).toBe(16);
  expect(thumbnail?.height).toBe(20);
  expect(thumbnail?.pixels).toEqual(expectedPixels(18, 22, 16, 20));
});
