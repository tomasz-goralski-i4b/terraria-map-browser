import { describe, expect, test } from "vitest";
import { SPRITE_FRAME_WRAPS, wrappedFrame } from "../src/index.js";

describe("stored frames past their sheet's edge", () => {
  // docs/assets.md, "Frames past the sheet's edge": measured in the art of the local install against the frames stored
  // by worlds.
  test("styles past the sheet's width continue at its left edge in the rows below the first block", () => {
    // Large piles 2 (187): 1890 wide, the second block of 36-pixel rows starts at y = 36.
    expect(wrappedFrame(187, 0, 18)).toEqual([0, 18]);
    expect(wrappedFrame(187, 1872, 0)).toEqual([1872, 0]);
    expect(wrappedFrame(187, 1890, 0)).toEqual([0, 36]);
    expect(wrappedFrame(187, 2952, 18)).toEqual([1062, 54]);
    // Small piles (185): the 2 × 1 row (y = 18) continues in the third row.
    expect(wrappedFrame(185, 2322, 18)).toEqual([414, 36]);
    // Pianos, dressers, sofas (87–89): the sheets are 1996–1998 wide (the last gap trimmed); the period is 1998.
    for (const id of [87, 88, 89]) expect(wrappedFrame(id, 2574, 18)).toEqual([576, 54]);
    // Bookcases (101): 4 rows tall, the second block starts at y = 72.
    expect(wrappedFrame(101, 2142, 54)).toEqual([144, 126]);
  });

  test("lamps (93) continue past the sheet's height in the next column block", () => {
    expect(wrappedFrame(93, 0, 2016)).toEqual([0, 2016]);
    expect(wrappedFrame(93, 18, 2574)).toEqual([54, 522]);
  });

  test("other ids keep their stored frame", () => {
    expect(wrappedFrame(21, 4000, 3000)).toEqual([4000, 3000]);
    expect([...SPRITE_FRAME_WRAPS.keys()].sort((a, b) => a - b)).toEqual([87, 88, 89, 93, 101, 185, 187]);
  });
});
