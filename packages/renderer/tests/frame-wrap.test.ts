import { describe, expect, test } from "vitest";
import { SPRITE_FRAME_WRAPS, wrappedFrame } from "../src/index.js";

describe("stored frames past their sheet's edge", () => {
  // docs/assets.md, "Frames past the sheet's edge": measured in the art of the local install; the first block's styles
  // end where its art ends, and the second block starts where the sheet's art resumes along the other axis.
  test("styles past the sheet's width continue at its left edge in the rows below the first block", () => {
    // Large piles 2 (187) and their rubblemaker copy (648): 1890 wide, the second block of 36-pixel rows starts at y = 36.
    for (const id of [187, 648]) {
      expect(wrappedFrame(id, 0, 18)).toEqual([0, 18]);
      expect(wrappedFrame(id, 1872, 0)).toEqual([1872, 0]);
      expect(wrappedFrame(id, 1890, 0)).toEqual([0, 36]);
      expect(wrappedFrame(id, 2952, 18)).toEqual([1062, 54]);
    }
    // Small piles (185): the 2 × 1 row (y = 18) continues in the third row; their rubblemaker copy (649) holds that row
    // alone, so it continues in its second.
    expect(wrappedFrame(185, 2322, 18)).toEqual([414, 36]);
    expect(wrappedFrame(649, 2322, 0)).toEqual([414, 18]);
    // Pianos, dressers, sofas (87–89): the sheets are 1996–1998 wide (the last gap trimmed); the period is 1998.
    for (const id of [87, 88, 89]) expect(wrappedFrame(id, 2574, 18)).toEqual([576, 54]);
    // Bookcases (101): 4 rows tall, the second block starts at y = 72.
    expect(wrappedFrame(101, 2142, 54)).toEqual([144, 126]);
    // Tables (14): 3 × 2 styles end at 1890; the second block starts at y = 38.
    expect(wrappedFrame(14, 1890, 18)).toEqual([0, 56]);
    // Work benches (18): 2 × 1 styles end at 2016; the second block starts at y = 20.
    expect(wrappedFrame(18, 2034, 0)).toEqual([18, 20]);
    // Banners (91): 1 × 3 styles, 1998 wide, in three blocks of 54-pixel rows.
    expect(wrappedFrame(91, 1998, 36)).toEqual([0, 90]);
    expect(wrappedFrame(91, 4014, 18)).toEqual([18, 126]);
    // Clocks (104): 2 × 5 styles end at 2016; the second block starts at y = 90.
    expect(wrappedFrame(104, 2016, 72)).toEqual([0, 162]);
    // Statues (105): 2 × 3 styles end at 1980; each 54-pixel band continues in the next one.
    expect(wrappedFrame(105, 1998, 36)).toEqual([18, 90]);
    expect(wrappedFrame(105, 1980, 198)).toEqual([0, 252]);
  });

  test("styles past the sheet's height continue at its top in the columns right of the first block", () => {
    // Lamps (93): 1 × 3 styles of 54 rows; the first block's art ends at style 37's start, y = 1998.
    expect(wrappedFrame(93, 0, 1980)).toEqual([0, 1980]);
    expect(wrappedFrame(93, 0, 1998)).toEqual([36, 0]);
    expect(wrappedFrame(93, 18, 2574)).toEqual([54, 576]);
    // Chairs (15) and toilets (497): 1 × 2 styles every 40 rows, ending at 2040; the second block starts at x = 36.
    for (const id of [15, 497]) expect(wrappedFrame(id, 18, 2058)).toEqual([54, 18]);
    // Chandeliers (34): 3 × 3 styles, on and off side by side (108 wide), ending at 1998.
    expect(wrappedFrame(34, 54, 2016)).toEqual([162, 18]);
    // Lanterns (42): 1 × 2 styles ending at 2016, second block at x = 36.
    expect(wrappedFrame(42, 0, 2034)).toEqual([36, 18]);
    // Beds (79) and bathtubs (90): 4 × 2 styles, both directions side by side (144 wide), ending at 2016.
    for (const id of [79, 90]) expect(wrappedFrame(id, 72, 2016)).toEqual([216, 0]);
    // Candelabras (100) and music boxes (139): 2 × 2 styles ending at 2016, second block at x = 72.
    for (const id of [100, 139]) expect(wrappedFrame(id, 18, 2034)).toEqual([90, 18]);
    // Sinks (172): 2 × 2 styles every 38 rows, ending at 2014; second block at x = 36.
    expect(wrappedFrame(172, 18, 2032)).toEqual([54, 18]);
  });

  test("other ids keep their stored frame", () => {
    expect(wrappedFrame(21, 4000, 3000)).toEqual([4000, 3000]);
    expect([...SPRITE_FRAME_WRAPS.keys()].sort((a, b) => a - b)).toEqual([
      14, 15, 18, 34, 42, 79, 87, 88, 89, 90, 91, 93, 100, 101, 104, 105, 139, 172, 185, 187, 497, 648, 649,
    ]);
  });
});
