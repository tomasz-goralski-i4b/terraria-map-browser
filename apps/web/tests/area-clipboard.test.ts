import { expect, test } from "vitest";
import { readWorldTiles, writeWorld } from "@studio/world-codec";
import { copyArea, planAreaPaste, DEFAULT_COPY_LAYERS } from "../src/world/area-clipboard.js";
import { canonicalWorldOf } from "../src/world/canonical-world.js";
import { verifyWrittenWorld } from "../src/world/verify-written.js";
import { brushSource } from "./support/brush-source.js";
import { beginBrush, moveBrush, finishBrush, setBrushWorld, undoBrush, redoBrush, commitAreaEdit, useBrushStore } from "../src/world/brush-session.js";
import { useAppStore } from "../src/store.js";

const meadow = () => readWorldTiles(brushSource(8, 8, Array.from({ length: 8 }, () => [0x40, 7]).flat()));
const area = { x: 1, y: 1, width: 2, height: 2 };

test("clipboard is an independent plane snapshot; preview is read-only and overlapping placement undoes exactly", () => {
  const world = meadow(); const view = canonicalWorldOf(world);
  view.setTile(1, 1, { block: { kind: "vanilla", id: 1 }, wall: { kind: "vanilla", id: 1 }, paint: 3, wallPaint: 7, shape: "half", wires: 15, actuator: true, liquid: { kind: "honey", amount: 180 } });
  const clipboard = copyArea(world, area);
  const original = structuredClone(world.planes);
  const paste = planAreaPaste(world, clipboard, 2, 1);
  expect(world.planes).toEqual(original);
  paste.apply("after");
  expect(view.tileAt(2, 1)).toEqual(clipboard.world.tileAt(0, 0));
  expect(verifyWrittenWorld(world, writeWorld(world))).toBeNull();
  paste.apply("before"); expect(world.planes).toEqual(original);
  view.setTile(1, 1, { wires: 0, actuator: false });
  expect(clipboard.world.tileAt(0, 0).paint).toBe(3);
});

test("transparent air, transparent walls and merged liquids preserve destination layers and clamp matching liquid", () => {
  const world = meadow(); const view = canonicalWorldOf(world);
  view.setTile(1, 1, { wires: 0, actuator: false, liquid: { kind: "water", amount: 120 } });
  view.setTile(4, 4, { block: { kind: "vanilla", id: 1 }, wall: { kind: "vanilla", id: 2 }, paint: 9, wires: 0, actuator: false, liquid: { kind: "water", amount: 200 } });
  const paste = planAreaPaste(world, copyArea(world, area), 4, 4, { air: "transparent", walls: "transparent", liquids: "merge" });
  paste.apply("after");
  expect(view.tileAt(4, 4)).toMatchObject({ block: { id: 1 }, wall: { id: 2 }, paint: 9, liquid: { kind: "water", amount: 255 } });
});

test("transparent walls paste the copied walls and keep the destination wall only where the copy has none", () => {
  const world = meadow(); const view = canonicalWorldOf(world);
  view.setTile(1, 1, { wall: { kind: "vanilla", id: 5 }, wallPaint: 4, wires: 0, actuator: false });
  for (const [x, y] of [[4, 4], [4, 5]] as const) view.setTile(x, y, { wall: { kind: "vanilla", id: 2 }, wires: 0, actuator: false });
  planAreaPaste(world, copyArea(world, area), 4, 4, { air: "replace", walls: "transparent", liquids: "replace" }).apply("after");
  expect(view.tileAt(4, 4)).toMatchObject({ wall: { id: 5 }, wallPaint: 4 });
  expect(view.tileAt(4, 5)).toMatchObject({ wall: { id: 2 } });
});

test("copy masks preserve every unselected plane and different liquid kinds never mix", () => {
  const world = meadow(); const view = canonicalWorldOf(world);
  view.setTile(1, 1, { block: { kind: "vanilla", id: 1 }, wires: 15, actuator: true, liquid: { kind: "lava", amount: 90 } });
  view.setTile(4, 4, { block: { kind: "vanilla", id: 2 }, paint: 8, wires: 1, actuator: false, liquid: { kind: "water", amount: 210 } });
  const paste = planAreaPaste(world, copyArea(world, area, { ...DEFAULT_COPY_LAYERS, blocks: false, walls: false, wires: false, paint: false, objects: false }), 4, 4, { air: "replace", walls: "replace", liquids: "merge" });
  paste.apply("after");
  expect(view.tileAt(4, 4)).toMatchObject({ block: { id: 2 }, paint: 8, wires: 1, actuator: false, liquid: { kind: "water", amount: 210 } });
});

test("clipping retains source offsets and rejects invalid rectangles before allocation", () => {
  const world = meadow(); const view = canonicalWorldOf(world);
  view.setTile(2, 2, { block: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  const paste = planAreaPaste(world, copyArea(world, area), -1, -1); paste.apply("after");
  expect(view.tileAt(0, 0).block).toEqual({ kind: "vanilla", id: 1 });
  expect(planAreaPaste(world, copyArea(world, area), 8, 8).tiles).toHaveLength(0);
  for (const invalid of [{ ...area, width: 0 }, { ...area, x: -1 }, { ...area, width: 8 }, { ...area, y: NaN }]) expect(() => copyArea(world, invalid)).toThrow(RangeError);
  expect(() => planAreaPaste(world, copyArea(world, area), 1.5, 0)).toThrow(RangeError);
});

function chestWorld() {
  const bytes = brushSource(8, 8, Array.from({ length: 8 }, () => [0x40, 7]).flat());
  bytes[72 + (21 >> 3)] = (bytes[72 + (21 >> 3)] ?? 0) | (1 << (21 & 7));
  const world = readWorldTiles(bytes); const view = canonicalWorldOf(world);
  for (let x = 1; x <= 2; x++) for (let y = 1; y <= 2; y++) view.setTile(x, y, { block: { kind: "vanilla", id: 21 }, frameX: (x - 1) * 18, frameY: (y - 1) * 18, wires: 0, actuator: false });
  Object.assign(world.entities.Chests, { data: { entries: [{ x: 1, y: 1, name: "Mining supplies", slotCount: 40, items: [{ slot: 0, itemId: 8, stack: 27, prefix: 0 }] }] } });
  return world;
}

test("a different framed neighbor does not exclude a complete chest; identical neighbors remain conservative", () => {
  const world = chestWorld(), view = canonicalWorldOf(world);
  world.envelope.frameImportantBits[0] = (world.envelope.frameImportantBits[0] ?? 0) | 8;
  view.setTile(0, 1, { block: { kind: "vanilla", id: 3 }, wires: 0, actuator: false });
  expect(copyArea(world, area).records.Chests.data?.entries).toHaveLength(1);
  view.setTile(0, 1, { block: { kind: "vanilla", id: 21 }, wires: 0, actuator: false });
  expect(copyArea(world, area).records.Chests.data?.entries).toHaveLength(0);
});

test.each([1, 2])("paint-only copy from a %i-column chest selection preserves destination structure and records", (width) => {
  const world = chestWorld(), view = canonicalWorldOf(world);
  view.setTile(1, 1, { ...view.tileAt(1, 1), paint: 9 });
  view.setTile(4, 4, { block: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  const before = world.entities.Chests.data;
  planAreaPaste(world, copyArea(world, { ...area, width }, { blocks: false, walls: false, liquids: false, wires: false, paint: true, objects: false }), 4, 4).apply("after");
  expect(view.tileAt(4, 4)).toMatchObject({ block: { id: 1 }, paint: 9 });
  expect(world.entities.Chests.data).toBe(before);
});

test("whole chests retain independent contents; partial selections, object exclusions and edge clipping copy no chest fragment", () => {
  for (const scenario of ["whole", "partial", "excluded", "clipped"] as const) {
    const world = chestWorld(); const view = canonicalWorldOf(world);
    const clipboard = copyArea(world, { ...area, width: scenario === "partial" ? 1 : 2 }, { ...DEFAULT_COPY_LAYERS, objects: scenario !== "excluded" });
    const paste = planAreaPaste(world, clipboard, scenario === "clipped" ? 7 : 4, 4); paste.apply("after");
    expect(view.tileAt(scenario === "clipped" ? 7 : 4, 4).block).toEqual(scenario === "whole" ? { kind: "vanilla", id: 21 } : undefined);
    expect(world.entities.Chests.data?.entries).toHaveLength(scenario === "whole" ? 2 : 1);
    expect(verifyWrittenWorld(world, writeWorld(world))).toBeNull();
    paste.apply("before"); expect(world.entities.Chests.data?.entries).toHaveLength(1);
  }
});

test("paste replaces a destination chest whole, with its record and items, and undo restores both", () => {
  const world = chestWorld(); const view = canonicalWorldOf(world);
  const before = structuredClone(world.planes), records = world.entities.Chests.data;
  const paste = planAreaPaste(world, copyArea(world, { x: 4, y: 4, width: 1, height: 1 }), 1, 1);
  expect(paste.replaced).toEqual({ objects: 1, chests: 1 });
  paste.apply("after");
  for (let x = 1; x <= 2; x++) for (let y = 1; y <= 2; y++) expect(view.tileAt(x, y).block).toBeUndefined();
  expect(world.entities.Chests.data?.entries).toEqual([]);
  paste.apply("before");
  expect(world.planes).toEqual(before); expect(world.entities.Chests.data).toBe(records);
});

test("paste still refuses to break the supports of an object it does not replace", () => {
  const world = chestWorld(); const view = canonicalWorldOf(world);
  for (let x = 1; x <= 2; x++) view.setTile(x, 3, { block: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  const before = structuredClone(world.planes);
  expect(() => planAreaPaste(world, copyArea(world, { x: 5, y: 5, width: 1, height: 1 }), 1, 3)).toThrow(/object/);
  expect(world.planes).toEqual(before);
});

test("paste and brush share chronological undo, redo and a saved position", () => {
  const world = meadow(); const view = canonicalWorldOf(world);
  view.setTile(1, 1, { block: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  setBrushWorld(world); useAppStore.setState({ phase: "loaded", unsavedChanges: false });
  useBrushStore.setState({ blockId: 1, layer: "block", size: 1, smooth: false, paintOnly: false });
  const paste = planAreaPaste(world, copyArea(world, area), 4, 4);
  expect(commitAreaEdit(world, paste.tiles, paste.apply)).toBe(true);
  beginBrush(false); moveBrush(6, 6); finishBrush();
  undoBrush(); expect(view.tileAt(6, 6).block).toBeUndefined(); expect(view.tileAt(4, 4).block).toEqual({ kind: "vanilla", id: 1 });
  undoBrush(); expect(view.tileAt(4, 4).block).toBeUndefined(); expect(useAppStore.getState().unsavedChanges).toBe(false);
  redoBrush(); expect(view.tileAt(4, 4).block).toEqual({ kind: "vanilla", id: 1 });
  redoBrush(); expect(view.tileAt(6, 6).block).toEqual({ kind: "vanilla", id: 1 });
  setBrushWorld(null);
});

test("each layer mask changes only its owned planes, including independent block and wall coatings", () => {
  for (const layer of ["blocks", "walls", "paint", "wires", "liquids"] as const) {
    const world = meadow(), view = canonicalWorldOf(world);
    view.setTile(1, 1, { block: { kind: "vanilla", id: 1 }, wall: { kind: "vanilla", id: 1 }, frameX: 36, frameY: 18, paint: 3, wallPaint: 7, shape: "half", inactive: true, invisibleBlock: true, fullBrightWall: true, wires: 15, actuator: true, liquid: { kind: "shimmer", amount: 100 } });
    view.setTile(4, 4, { block: { kind: "vanilla", id: 2 }, wall: { kind: "vanilla", id: 2 }, paint: 9, wallPaint: 10, invisibleWall: true, fullBrightBlock: true, wires: 1, actuator: false, liquid: { kind: "lava", amount: 200 } });
    const before = view.tileAt(4, 4);
    const layers = { blocks: false, walls: false, paint: false, wires: false, liquids: false, objects: false, [layer]: true };
    planAreaPaste(world, copyArea(world, { ...area, width: 1, height: 1 }, layers), 4, 4).apply("after");
    const after = view.tileAt(4, 4);
    if (layer === "blocks") expect(after).toEqual({ ...before, block: { kind: "vanilla", id: 1 }, frameX: 36, frameY: 18, shape: "half", inactive: true, invisibleBlock: true, fullBrightBlock: undefined });
    if (layer === "walls") expect(after).toEqual({ ...before, wall: { kind: "vanilla", id: 1 }, invisibleWall: undefined, fullBrightWall: true });
    if (layer === "paint") expect(after).toEqual({ ...before, paint: 3, wallPaint: 7 });
    if (layer === "wires") expect(after).toEqual({ ...before, wires: 15, actuator: true });
    if (layer === "liquids") expect(after).toEqual({ ...before, liquid: { kind: "shimmer", amount: 100 } });
  }
});

test("clipboard palette remaps by content and future writes reuse new indices without aliasing", () => {
  const source = meadow(), destination = meadow();
  canonicalWorldOf(source).setTile(1, 1, { block: { kind: "vanilla", id: 1 }, wall: { kind: "vanilla", id: 2 }, wires: 0, actuator: false });
  const view = canonicalWorldOf(destination);
  view.setTile(0, 0, { block: { kind: "vanilla", id: 2 }, wires: 0, actuator: false });
  const originalPalette = [...destination.palette];
  const paste = planAreaPaste(destination, copyArea(source, area), 4, 4);
  expect(destination.palette).toEqual(originalPalette);
  paste.apply("after"); expect(view.tileAt(4, 4)).toMatchObject({ block: { id: 1 }, wall: { id: 2 } });
  const length = destination.palette.length;
  view.setTile(6, 6, { block: { kind: "vanilla", id: 1 }, wires: 0, actuator: false }); expect(destination.palette).toHaveLength(length);
});

test("paint and wires can be pasted over protected furniture without changing its frames or records", () => {
  const world = chestWorld(); const view = canonicalWorldOf(world);
  view.setTile(4, 4, { block: { kind: "vanilla", id: 1 }, paint: 9, wires: 3, actuator: true });
  const clipboard = copyArea(world, { x: 4, y: 4, width: 1, height: 1 }, { ...DEFAULT_COPY_LAYERS, blocks: false, walls: false, liquids: false, objects: false });
  planAreaPaste(world, clipboard, 2, 1).apply("after");
  expect(view.tileAt(2, 1)).toMatchObject({ block: { id: 21 }, frameX: 18, frameY: 0, paint: 9, wires: 3, actuator: true });
  expect(world.entities.Chests.data?.entries).toHaveLength(1);
});
