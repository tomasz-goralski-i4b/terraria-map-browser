import { expect, test } from "vitest";
import { countContent, countContentInSlices, type CountablePlanes } from "../src/world/content-counts.js";

const NONE = 0xffff;

/** 4 × 3 world, column-major; palette: 0 vanilla 1 (block and wall), 1 vanilla 2 (block), 2 unknown 9 (wall). */
function planes(): CountablePlanes {
  return {
    block: Uint16Array.from([0, 0, NONE, 1, NONE, 0, 1, 1, 1, NONE, NONE, 0]),
    wall: Uint16Array.from([0, NONE, 2, 2, NONE, NONE, 0, NONE, NONE, NONE, 2, NONE]),
    liquid: Uint8Array.from([0, 1, 1, 0, 2, 0, 0, 3, 4, 4, 4, 0]),
  };
}

test("counts every palette entry per plane and every liquid kind exactly", () => {
  const counts = countContent(planes(), 3);
  expect([...counts.blocks]).toEqual([4, 4, 0]);
  expect([...counts.walls]).toEqual([2, 0, 3]);
  expect([...counts.liquids]).toEqual([0, 2, 1, 1, 3]);
});

test("counting in slices gives the same counts and yields between slices", async () => {
  let yields = 0;
  const counts = await countContentInSlices(planes(), 3, {
    sliceSize: 5,
    yieldControl: () => {
      yields++;
      return Promise.resolve();
    },
  });
  expect(yields).toBeGreaterThanOrEqual(2);
  expect(counts).toEqual(countContent(planes(), 3));
});

test("an aborted count rejects with an AbortError", async () => {
  const controller = new AbortController();
  const counting = countContentInSlices(planes(), 3, {
    sliceSize: 2,
    signal: controller.signal,
    yieldControl: () => {
      controller.abort();
      return Promise.resolve();
    },
  });
  await expect(counting).rejects.toMatchObject({ name: "AbortError" });
});

test("a plane value beyond the palette is not counted as content", () => {
  const counts = countContent({ block: Uint16Array.from([5]), wall: Uint16Array.from([NONE]), liquid: Uint8Array.from([0]) }, 1);
  expect([...counts.blocks]).toEqual([0]);
});
