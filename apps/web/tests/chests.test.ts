import { expect, test } from "vitest";
import type { WorldChest } from "@studio/world-codec";
import { createWorld } from "@studio/world-model";
import { chestProperties, chestTitle, slotLabel } from "../src/panels/chest-fields.js";
import { createChestLookup } from "../src/world/chests.js";
import { itemLabel } from "../src/world/items.js";

const chest: WorldChest = {
  x: 1, y: 1, name: "", slotCount: 40,
  items: [{ slot: 0, itemId: 22, stack: 12, prefix: 0 }, { slot: 39, itemId: 3507, stack: 1, prefix: 81 }],
};
const dresser: WorldChest = { x: 5, y: 1, name: "Loot", slotCount: 40, items: [] };

function world(): ReturnType<typeof createWorld> {
  const tiles = createWorld(10, 4);
  for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]] as const) tiles.setTile(x, y, { block: { kind: "vanilla", id: 21 }, frameX: (x - 1) * 18, frameY: (y - 1) * 18, wires: 0, actuator: false });
  for (let x = 5; x < 8; x++) for (let y = 1; y < 3; y++) tiles.setTile(x, y, { block: { kind: "vanilla", id: 88 }, frameX: (x - 5) * 18, frameY: (y - 1) * 18, wires: 0, actuator: false });
  return tiles;
}

test("every tile of a chest's 2 × 2 footprint and a dresser's 3 × 2 footprint resolves to its record", () => {
  const tiles = world();
  const chestAt = createChestLookup([chest, dresser], tiles.width, tiles.height, (x, y) => tiles.tileAt(x, y));
  for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]] as const) expect(chestAt(x, y)).toBe(chest);
  for (let x = 5; x < 8; x++) for (let y = 1; y < 3; y++) expect(chestAt(x, y)).toBe(dresser);
  for (const [x, y] of [[0, 1], [3, 1], [1, 0], [1, 3], [4, 2], [8, 1], [5, 3]] as const) expect(chestAt(x, y)).toBeNull();
});

test("an incomplete footprint reaching past the world edge is retained as data but cannot be clicked", () => {
  const tiles = createWorld(2, 2);
  const chestAt = createChestLookup([{ ...chest, x: 1, y: 1 }], tiles.width, tiles.height, (x, y) => tiles.tileAt(x, y));
  expect(chestAt(1, 1)).toBeNull();
  expect(chestAt(0, 0)).toBeNull();
});

test("overlapping records remain visible as data but ambiguous footprint tiles resolve to no chest", () => {
  const tiles = world();
  const overlapping = { ...chest, name: "Duplicate chest anchor" };
  const lookup = createChestLookup([chest, overlapping], tiles.width, tiles.height, (x, y) => tiles.tileAt(x, y));
  expect(lookup(1, 1)).toBeNull();
  expect(lookup(2, 1)).toBeNull();
});

test.each(["absent anchor", "unknown anchor", "missing part", "wrong frame", "out of bounds"])("a %s never invents a clickable footprint", (condition) => {
  const tiles = world();
  const record = condition === "out of bounds" ? { ...chest, x: -1 } : chest;
  if (condition === "absent anchor") tiles.setTile(1, 1, { wires: 0, actuator: false });
  if (condition === "unknown anchor") tiles.setTile(1, 1, { block: { kind: "unknown", runtimeId: 920 }, frameX: 0, frameY: 0, wires: 0, actuator: false });
  if (condition === "missing part") tiles.setTile(2, 2, { wires: 0, actuator: false });
  if (condition === "wrong frame") tiles.setTile(2, 2, { block: { kind: "vanilla", id: 21 }, frameX: 0, frameY: 0, wires: 0, actuator: false });
  const lookup = createChestLookup([record], tiles.width, tiles.height, (x, y) => tiles.tileAt(x, y));
  expect(lookup(1, 1)).toBeNull();
  expect(lookup(2, 2)).toBeNull();
});

test("item ids resolve catalog names and unknown items retain their numeric identity", () => {
  expect(itemLabel(22)).toBe("Iron Bar");
  expect(itemLabel(9001)).toBe("Item 9001");
});

test("a chest lists its name, position, style and filled slots; an unnamed chest hides its name unless every field is shown", () => {
  const tiles = world();
  // Frame X 432 on tile 21: 12 chest styles of 36 px (2 tiles × 18 px) to its left, so style 12.
  tiles.setTile(1, 1, { block: { kind: "vanilla", id: 21 }, frameX: 432, frameY: 0, wires: 0, actuator: false });
  expect(chestProperties(chest, tiles.tileAt(1, 1))).toEqual([
    { kind: "text", label: "Name", value: "Unnamed" },
    { kind: "text", label: "Chest position", value: "1, 1" },
    { kind: "text", label: "Style", value: "12" },
    { kind: "text", label: "Filled slots", value: "2 of 40" },
  ]);
  expect(chestProperties(chest, tiles.tileAt(1, 1))[0]).toEqual({ kind: "text", label: "Name", value: "Unnamed" });
  // A dresser's styles are 54 px (3 tiles) wide.
  tiles.setTile(5, 1, { block: { kind: "vanilla", id: 88 }, frameX: 108, frameY: 0, wires: 0, actuator: false });
  expect(chestProperties(dresser, tiles.tileAt(5, 1))).toEqual([
    { kind: "text", label: "Name", value: "Loot" },
    { kind: "text", label: "Chest position", value: "5, 1" },
    { kind: "text", label: "Style", value: "2" },
    { kind: "text", label: "Filled slots", value: "0 of 40" },
  ]);
});

test("the section is titled by the object at the chest's position", () => {
  const tiles = world();
  expect(chestTitle(tiles.tileAt(1, 1))).toBe("Chest");
  expect(chestTitle(tiles.tileAt(5, 1))).toBe("Dresser");
  expect(chestTitle(tiles.tileAt(0, 0))).toBe("Chest");
});

test("a slot reads as item, stack and prefix", () => {
  expect(slotLabel({ slot: 0, itemId: 22, stack: 12, prefix: 0 })).toBe("Iron Bar × 12");
  expect(slotLabel({ slot: 39, itemId: 9001, stack: 1, prefix: 255 })).toBe("Item 9001 × 1, Prefix 255");
});
