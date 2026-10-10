import { expect, test } from "vitest";
import type { Tile, WorldPlanes } from "@studio/world-model";
import { readWorldTiles, writeWorld, SUPPORTED_VANILLA_FORMATS } from "@studio/world-codec";
import { brushMaterials } from "../src/world/brush-materials.js";
import { createWorldBrush } from "../src/world/brush-session.js";
import { canonicalWorldOf } from "../src/world/canonical-world.js";
import { verifyWrittenWorld } from "../src/world/verify-written.js";
import { brushSource } from "./support/brush-source.js";

const place = (id: number, paint = 0) => ({ kind: "place", id, paint }) as const;
const block = (id: number, extra: Partial<Tile> = {}): Tile => ({ block: { kind: "vanilla", id }, wires: 0, actuator: false, ...extra });
const emptyWorld = (width: number, height: number) =>
  readWorldTiles(brushSource(width, height, Array.from({ length: width }, () => [0x40, height - 1]).flat()));

test.each(SUPPORTED_VANILLA_FORMATS)("brush edits export current state and reload without other changes (format %i)", (version) => {
  const world = readWorldTiles(brushSource(2, 4, undefined, version));
  const original = (Object.keys(world.planes) as (keyof WorldPlanes)[]).map((name) => world.planes[name].slice());
  const history = createWorldBrush(world);
  expect(history).not.toBeNull();
  history?.begin({ wall: place(1), size: 1 });
  history?.move(1, 2);
  history?.commit();
  expect(canonicalWorldOf(world).tileAt(1, 2).wall).toEqual({ kind: "vanilla", id: 1 });
  const output = writeWorld(world);
  expect(verifyWrittenWorld(world, output)).toBeNull();
  expect(canonicalWorldOf(readWorldTiles(new Uint8Array(output))).tileAt(1, 2).wall).toEqual({ kind: "vanilla", id: 1 });
  history?.undo();
  expect(Object.values(world.planes)).toEqual(original);
  history?.begin({ block: place(38, 12), wall: place(4, 25), size: 1 });
  history?.move(1, 2);
  history?.commit();
  const both = writeWorld(world);
  expect(verifyWrittenWorld(world, both)).toBeNull();
  const reloaded = canonicalWorldOf(readWorldTiles(new Uint8Array(both))).tileAt(1, 2);
  expect(reloaded).toMatchObject({ block: { kind: "vanilla", id: 38 }, paint: 12, wall: { kind: "vanilla", id: 4 }, wallPaint: 25 });
});

test("ordinary blocks around a tile never protect it: stone paints beside grass, ores and sand, and erases them", () => {
  const world = emptyWorld(5, 3);
  const view = canonicalWorldOf(world);
  view.setTile(0, 1, block(2));
  view.setTile(1, 1, block(7));
  view.setTile(2, 1, block(53, { liquid: { kind: "water", amount: 255 } }));
  view.setTile(3, 1, block(0));
  const history = createWorldBrush(world);
  history?.begin({ block: place(1), size: 1 });
  history?.move(0, 1);
  history?.move(4, 1);
  expect(history?.commit().map(({ x }) => x)).toEqual([0, 1, 2, 3, 4]);
  expect(view.tileAt(2, 1)).toEqual(block(1));
  history?.undo();
  history?.begin({ wall: place(16), size: 3 });
  history?.move(2, 1);
  expect(history?.commit()).toHaveLength(9);
  history?.begin({ block: { kind: "erase" }, size: 1 });
  history?.move(0, 1);
  history?.move(2, 1);
  history?.commit();
  for (const x of [0, 1, 2]) expect(view.tileAt(x, 1).block).toBeUndefined();
});

test("objects are protected with both layers; their supports and attachments only from block edits", () => {
  const world = emptyWorld(5, 5);
  const view = canonicalWorldOf(world);
  view.setTile(2, 2, block(4, { frameX: 0, frameY: 0 }));
  for (const [x, y] of [[2, 3], [1, 2], [3, 2]] as const) view.setTile(x, y, block(1));
  const history = createWorldBrush(world);
  history?.begin({ block: { kind: "erase" }, size: 3 });
  history?.move(2, 2);
  expect(history?.commit()).toEqual([]);
  history?.begin({ wall: place(1), size: 3 });
  history?.move(2, 2);
  expect(history?.commit().map(({ x, y }) => `${String(x)},${String(y)}`).sort()).toEqual(
    ["1,1", "1,2", "1,3", "2,1", "2,3", "3,1", "3,2", "3,3"]);
  expect(view.tileAt(2, 2).wall).toBeUndefined();
  history?.begin({ block: place(0), size: 1 });
  history?.move(2, 4);
  expect(history?.commit()).toHaveLength(1);
});

test("protects chest footprints including air and refuses unknown content or undecoded entity sections", () => {
  const world = emptyWorld(6, 6);
  Object.assign(world.entities.Chests, { data: { entries: [{ x: 1, y: 1, name: "Underground supplies", slotCount: 40, items: [] }] } });
  const history = createWorldBrush(world);
  history?.begin({ block: place(1), size: 3 });
  history?.move(3, 3);
  expect(history?.commit()).toHaveLength(5);
  for (const x of [1, 2]) for (const y of [1, 2]) expect(canonicalWorldOf(world).tileAt(x, y).block).toBeUndefined();
  Object.assign(world.entities.Signs, { data: null });
  expect(createWorldBrush(world)).toBeNull();
  const modded = readWorldTiles(brushSource());
  Object.assign(modded, { palette: [{ kind: "unknown", runtimeId: 900 }] });
  expect(createWorldBrush(modded)).toBeNull();
});

test("tile entities protect a halo around their anchor, clipped at the world edges", () => {
  const world = emptyWorld(20, 20);
  Object.assign(world.entities.TileEntities, { data: { entries: [{ kind: 3, entityId: 17, x: 19, y: 0, items: [], dyes: [], misc: [], anchorItemId: null }] } });
  const history = createWorldBrush(world);
  history?.begin({ wall: place(1), size: 1 });
  history?.move(15, 4);
  expect(history?.commit()).toEqual([]);
  history?.begin({ wall: place(1), size: 1 });
  history?.move(14, 5);
  expect(history?.commit()).toHaveLength(1);
  history?.begin({ wall: place(1), size: 1 });
  history?.move(0, 19);
  expect(history?.commit()).toHaveLength(1);
});

test("signs and weighted pressure plates protect their attachments even when their block fragments are missing", () => {
  const world = emptyWorld(10, 10);
  Object.assign(world.entities.Signs, { data: { entries: [{ x: 1, y: 1, text: "Cavern entrance" }] } });
  Object.assign(world.entities.WeightedPressurePlates, { data: { entries: [{ x: 7, y: 7 }] } });
  const history = createWorldBrush(world);
  history?.begin({ wall: place(1), size: 1 });
  history?.move(1, 3);
  history?.move(7, 8);
  const changed = history?.commit();
  expect(changed?.some((tile) => tile.x === 1 && tile.y === 3)).toBe(false);
  expect(changed?.some((tile) => tile.x === 7 && tile.y === 8)).toBe(false);
  expect(changed?.length).toBeGreaterThan(0);
});

test("materials are the world format's self-framed blocks and walls; objects and later content cannot be placed", () => {
  const older = readWorldTiles(brushSource(2, 4, undefined, 279));
  const materials = brushMaterials(older);
  const blocks = materials.blocks.map((material) => material.id);
  expect(blocks).toEqual(expect.arrayContaining([0, 1, 2, 7, 53, 30, 38]));
  expect(blocks).not.toContain(4);
  expect(blocks).not.toContain(21);
  expect(Math.max(...blocks)).toBeLessThanOrEqual(692);
  expect(materials.walls.map((material) => material.id)).toEqual(expect.arrayContaining([1, 2, 16]));
  expect(Math.max(...materials.walls.map((material) => material.id))).toBeLessThanOrEqual(346);
  expect(materials.walls.find((material) => material.id === 2)?.name).toBe("Natural Dirt Wall");
  expect(materials.paints.map((paint) => paint.id)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
  const history = createWorldBrush(older);
  for (const options of [{ block: place(21) }, { block: place(700) }, { wall: place(360) }, { block: place(1, 31) }]) {
    expect(() => { history?.begin({ ...options, size: 1 }); }).toThrow(RangeError);
  }
});
