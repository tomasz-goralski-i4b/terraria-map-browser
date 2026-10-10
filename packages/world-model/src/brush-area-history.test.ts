import { expect, test } from "vitest";
import { createBrushHistory, createWorld, type TileDiff } from "./index.js";

test("external plane edits share chronological brush history and branch redo only for actual changes", () => {
  const world = createWorld(8, 8), history = createBrushHistory(world);
  world.setTile(2, 2, { block: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  const tiles: readonly TileDiff[] = [{ x: 2, y: 2, changes: [{ plane: "block", before: 0xffff, after: 0 }] }];
  history.record(tiles); expect(history.position()).toBe(tiles);
  history.begin({ size: 1, block: { kind: "place", id: 1, paint: 0 } }); history.move(4, 4); history.commit();
  history.undo(); expect(world.tileAt(4, 4).block).toBeUndefined(); expect(world.tileAt(2, 2).block).toEqual({ kind: "vanilla", id: 1 });
  history.undo(); expect(world.tileAt(2, 2).block).toBeUndefined();
  history.record([]); expect(history.canRedo()).toBe(true);
  history.redo(); expect(history.position()).toBe(tiles);
  history.begin({ size: 1, block: { kind: "place", id: 1, paint: 0 } }); expect(() => { history.record(tiles); }).toThrow(/stroke/); history.cancel();
  history.record([{ x: 2, y: 2, changes: [{ plane: "paint", before: 0, after: 3 }] }]); expect(history.canRedo()).toBe(false);
});

test("interning clipboard content leaves planes untouched and future tile writes reuse its palette index", () => {
  const world = createWorld(8, 8), original = Object.fromEntries(Object.entries(world.planes).map(([name, plane]) => [name, plane.slice()]));
  const stone = { kind: "vanilla", id: 1 } as const;
  expect(world.internContent(stone)).toBe(0); expect(world.internContent(stone)).toBe(0);
  expect(world.planes).toEqual(original);
  world.setTile(2, 2, { block: stone, wires: 0, actuator: false });
  expect(world.palette).toEqual([stone]); expect(world.planes.block[18]).toBe(0);
});
