import { afterEach, expect, test } from "vitest";
import { readWorldTiles, writeWorld } from "@studio/world-codec";
import { beginBrush, finishBrush, moveBrush, redoBrush, setBrushWorld, undoBrush, useBrushStore } from "../src/world/brush-session.js";
import { canonicalWorldOf } from "../src/world/canonical-world.js";
import { chestLookupOf } from "../src/world/chests.js";
import { useAppStore } from "../src/store.js";
import { verifyWrittenWorld } from "../src/world/verify-written.js";
import { brushSource } from "./support/brush-source.js";

function miningChest(width = 2) {
  const bytes = brushSource(12, 8, Array.from({ length: 12 }, () => [0x40, 7]).flat());
  // The synthetic header has room for the full vanilla frame-important bitset before metadata.
  const id = width === 3 ? 88 : 21;
  bytes[72 + (id >> 3)] = (bytes[72 + (id >> 3)] ?? 0) | (1 << (id & 7));
  const world = readWorldTiles(bytes), view = canonicalWorldOf(world);
  for (let x = 2; x < 2 + width; x++) for (let y = 2; y < 4; y++) view.setTile(x, y, { block: { kind: "vanilla", id }, frameX: (x - 2) * 18, frameY: (y - 2) * 18, wall: { kind: "vanilla", id: 1 }, paint: 3, wires: 5, actuator: true, liquid: { kind: "water", amount: 50 } });
  Object.assign(world.entities.Chests, { data: { entries: [{ x: 2, y: 2, name: "Mining supplies", slotCount: 40, items: [{ slot: 0, itemId: 8, stack: 27, prefix: 0 }] }] } });
  setBrushWorld(world); useAppStore.setState({ phase: "loaded", unsavedChanges: false });
  useBrushStore.setState({ size: 1, shape: "square", layer: "block", smooth: false, paintOnly: false });
  return world;
}
afterEach(() => { setBrushWorld(null); });

test.each([2, 3])("Eraser deletes the whole %i-wide chest body and record and restores both through undo/redo and save", (width) => {
  const world = miningChest(width), view = canonicalWorldOf(world), lookup = chestLookupOf(world), before = structuredClone(world.planes), record = structuredClone(world.entities.Chests.data);
  expect(lookup(2, 2)?.name).toBe("Mining supplies");
  expect(beginBrush(true)).toBe(true); moveBrush(2 + width - 1, 3); finishBrush();
  for (let x = 2; x < 2 + width; x++) for (let y = 2; y < 4; y++) expect(view.tileAt(x, y)).toEqual({ wall: { kind: "vanilla", id: 1 }, wires: 5, actuator: true, liquid: { kind: "water", amount: 50 } });
  expect(world.entities.Chests.data?.entries).toEqual([]); expect(lookup(2, 2)).toBeNull();
  expect(verifyWrittenWorld(world, writeWorld(world))).toBeNull();
  undoBrush(); expect(world.planes).toEqual(before); expect(world.entities.Chests.data).toEqual(record); expect(lookup(2, 2)?.name).toBe("Mining supplies");
  expect(useAppStore.getState().unsavedChanges).toBe(false);
  redoBrush(); expect(world.entities.Chests.data?.entries).toEqual([]); expect(verifyWrittenWorld(world, writeWorld(world))).toBeNull();
});

test("wall-only Eraser and chest-support tiles preserve the chest; cancelling a body erase restores its contents", () => {
  const world = miningChest(), before = structuredClone(world.planes), records = structuredClone(world.entities.Chests.data);
  useBrushStore.setState({ layer: "wall" }); beginBrush(true); moveBrush(2, 2); finishBrush();
  expect(world.entities.Chests.data).toEqual(records); expect(world.planes).toEqual(before);
  useBrushStore.setState({ layer: "block" }); beginBrush(true); moveBrush(2, 4); finishBrush(); expect(world.entities.Chests.data).toEqual(records);
  beginBrush(true); moveBrush(3, 3); expect(world.entities.Chests.data?.entries).toEqual([]); finishBrush(true);
  expect(world.entities.Chests.data).toEqual(records); expect(world.planes).toEqual(before);
});

test("an interpolated eraser stroke removes crossed chests as one entry", () => {
  const world = miningChest(); beginBrush(true); moveBrush(0, 2); moveBrush(8, 2); finishBrush();
  expect(world.entities.Chests.data?.entries).toEqual([]); undoBrush(); expect(world.entities.Chests.data?.entries).toHaveLength(1);
});
