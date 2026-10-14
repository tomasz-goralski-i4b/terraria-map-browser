import { expect, test } from "vitest";
import { buildContentStepIndex, matchContent, selectionOf } from "../src/world/content-search.js";

/** A 4 × 3 world, column-major: the block plane holds palette indices, 0xffff for none. */
function planes(blocks: readonly (readonly number[])[]): { block: Uint16Array; wall: Uint16Array; liquid: Uint8Array } {
  const width = blocks[0]?.length ?? 0, height = blocks.length;
  const block = new Uint16Array(width * height).fill(0xffff);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) block[x * height + y] = blocks[y]?.[x] ?? 0xffff;
  return { block, wall: new Uint16Array(width * height).fill(0xffff), liquid: new Uint8Array(width * height) };
}

test("entries match by name or key, case-insensitively, and map to palette indices per layer", () => {
  const entries = [
    { key: "block:1", kind: "block", name: "Dirt Block", id: "vanilla:0" },
    { key: "wall:1", kind: "wall", name: "Dirt Wall", id: "vanilla:2" },
    { key: "liquid:2", kind: "liquid", name: "Lava", id: "liquid:2" },
  ] as const;
  expect(matchContent(entries, "dIRT").map((entry) => entry.key)).toEqual(["block:1", "wall:1"]);
  expect(matchContent(entries, "liquid:2").map((entry) => entry.key)).toEqual(["liquid:2"]);
  expect(matchContent(entries, "  ")).toEqual([]);
  expect(selectionOf(entries)).toEqual({ blocks: [1], walls: [1], liquids: [2] });
});

test("steps visit vertical runs in column-major order, both ways, wrapping, numbered as stops", async () => {
  const world = planes([
    [5, 0, 5, 0],
    [5, 0, 0, 0],
    [0, 0, 5, 5],
  ]);
  const index = await buildContentStepIndex(world, 4, 3, { blocks: [5], walls: [], liquids: [] });
  expect(index.total).toBe(4);
  const first = index.step(null, 1);
  expect(first).toEqual({ x: 0, y: 0, ordinal: 1 });
  // The rest of column 0's run (y 1) is skipped.
  const second = index.step(first, 1);
  expect(second).toEqual({ x: 2, y: 0, ordinal: 2 });
  const third = index.step(second, 1);
  expect(third).toEqual({ x: 2, y: 2, ordinal: 3 });
  const fourth = index.step(third, 1);
  expect(fourth).toEqual({ x: 3, y: 2, ordinal: 4 });
  expect(index.step(fourth, 1)).toEqual(first);
  expect(index.step(first, -1)).toEqual(fourth);
  expect(index.step(null, -1)).toEqual(fourth);
});

test("building yields between column slices and an empty selection has nothing to step to", async () => {
  let slices = 0;
  const world = planes([[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]]);
  const index = await buildContentStepIndex(world, 4, 3, { blocks: [1], walls: [], liquids: [] }, { sliceTiles: 3, yieldControl: () => { slices++; return Promise.resolve(); } });
  expect(slices).toBe(3);
  expect(index.total).toBe(4);
  const none = await buildContentStepIndex(world, 4, 3, { blocks: [], walls: [], liquids: [] });
  expect(none.step(null, 1)).toBeNull();
});

test("indexing a content that covers a Large world never runs 50 ms without yielding", { tags: ["perf"] }, async () => {
  const width = 8400, height = 2400;
  // Worst case: every tile matches, and runs break every other tile.
  const block = new Uint16Array(width * height);
  for (let index = 1; index < block.length; index += 2) block[index] = 1;
  const planes = { block, wall: new Uint16Array(width * height).fill(0xffff), liquid: new Uint8Array(width * height) };
  let longest = 0;
  let last = performance.now();
  const index = await buildContentStepIndex(planes, width, height, { blocks: [0, 1], walls: [], liquids: [] }, {
    yieldControl: () => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      return new Promise((resolve) => setTimeout(() => { last = performance.now(); resolve(); }, 0));
    },
  });
  longest = Math.max(longest, performance.now() - last);
  expect(index.total).toBe(width);
  expect(longest).toBeLessThan(50);
});
