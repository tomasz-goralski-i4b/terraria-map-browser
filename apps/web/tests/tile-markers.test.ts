import { expect, test } from "vitest";
import { PIN_RING_SIZE, tileMarkers } from "../src/world/tile-markers.js";

/** The nine-float annotation records of `data`. */
function records(data: Float32Array): number[][] {
  return Array.from({ length: data.length / 9 }, (_, index) => [...data.subarray(index * 9, index * 9 + 9)]);
}

test("the pinned tile gets a white outline with its dark halo and, zoomed out, a ring at least 12 px wide", () => {
  const close = records(tileMarkers({ x: 10, y: 20 }, null, false));
  expect(close).toEqual([
    [10, 20, 11, 20, 1, 1, 1, 2, 0], [11, 20, 11, 21, 1, 1, 1, 2, 0],
    [11, 21, 10, 21, 1, 1, 1, 2, 0], [10, 21, 10, 20, 1, 1, 1, 2, 0],
  ]);
  const far = records(tileMarkers({ x: 10, y: 20 }, null, true));
  expect(far.slice(0, 4)).toEqual(close);
  expect(far[4]).toEqual([10.5, 20.5, 10.5, 20.5, 1, 1, 1, PIN_RING_SIZE, 3]);
  expect(PIN_RING_SIZE).toBeGreaterThanOrEqual(12);
});

test("the hovered tile is outlined thinner, in another colour and without a ring, under the pin", () => {
  const hover = records(tileMarkers(null, { x: 3, y: 4 }, true));
  expect(hover).toHaveLength(4);
  for (const record of hover) {
    expect(record[7]).toBe(1);
    expect(record[8]).toBe(0);
    expect(record.slice(4, 7)).not.toEqual([1, 1, 1]);
  }
  const both = records(tileMarkers({ x: 10, y: 20 }, { x: 3, y: 4 }, true));
  expect(both.slice(0, 4)).toEqual(hover);
  expect(both).toHaveLength(9);
});

test("a hovered tile that is the pinned one is drawn once, as the pin", () => {
  expect(tileMarkers({ x: 1, y: 1 }, { x: 1, y: 1 }, false)).toEqual(tileMarkers({ x: 1, y: 1 }, null, false));
  expect(tileMarkers(null, null, true)).toHaveLength(0);
});
