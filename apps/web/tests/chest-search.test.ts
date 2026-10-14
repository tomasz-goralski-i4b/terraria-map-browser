import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { readWorldEntities, type WorldChest } from "@studio/world-codec";
import { buildChestItemIndex } from "../src/world/chest-search.js";

const chests: readonly WorldChest[] = [
  { x: 12, y: 18, name: "Mining supplies", slotCount: 40, items: [{ slot: 0, itemId: 8, stack: 15, prefix: 0 }, { slot: 17, itemId: 8, stack: 25, prefix: 0 }, { slot: 39, itemId: 22, stack: 12, prefix: 0 }] },
  { x: 32, y: 18, name: "Spare lights", slotCount: 40, items: [{ slot: 5, itemId: 8, stack: 60, prefix: 0 }, { slot: 9, itemId: 9001, stack: 3, prefix: 255 }] },
  { x: 52, y: 18, name: "Weapons", slotCount: 40, items: [{ slot: 0, itemId: 46, stack: 1, prefix: 7 }, { slot: 1, itemId: 46, stack: 1, prefix: 81 }] },
];

test("item ID and case-insensitive name searches aggregate repeated stacks without duplicate chests", async () => {
  const index = await buildChestItemIndex(chests);
  const found = index.search("8");
  expect(found.matches.map((match) => [match.chestIndex, match.totalStack])).toEqual([[0, 40], [1, 60]]);
  expect(found.totals).toEqual([{ itemId: 8, totalStack: 100, slotCount: 3, chestCount: 2 }]);
  expect(index.search("tOrCh")).toEqual(found);
  expect(index.search("9001").matches.map((match) => match.totalStack)).toEqual([3]);
  expect(index.search("Light's Bane").totals).toEqual([{ itemId: 46, totalStack: 2, slotCount: 2, chestCount: 1 }]);
  expect(index.search("").matches).toEqual([]);
  expect(index.search("99999").matches).toEqual([]);
});

test("building the index yields between bounded batches instead of one long task", async () => {
  let slices = 0;
  await buildChestItemIndex(Array.from({ length: 1500 }, (_, chestIndex) => ({ ...chests[0]!, x: chestIndex })), async () => { slices++; });
  expect(slices).toBeGreaterThan(1);
});

test("SCCO1 chest counts and Torch totals match the recorded corpus", async () => {
  const entities = readWorldEntities(readFileSync(new URL("../../../packages/test-fixtures/worlds/SCCO1.wld", import.meta.url)));
  const entries = entities.Chests.data?.entries ?? [];
  expect(entries).toHaveLength(190);
  expect(entries.reduce((sum, chest) => sum + chest.items.length, 0)).toBe(1212);
  expect(entries.reduce((sum, chest) => sum + chest.items.reduce((total, item) => total + item.stack, 0), 0)).toBe(15184);
  const index = await buildChestItemIndex(entries);
  expect(index.search("8").totals).toEqual([{ itemId: 8, totalStack: 995, slotCount: 51, chestCount: 51 }]);
});
