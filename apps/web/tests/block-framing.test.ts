import { describe, expect, test } from "vitest";
import { getBlockFraming } from "../src/world/block-framing.js";

describe("block framing", () => {
  test("is loaded once from the shipped framing database and frames self-framed blocks", async () => {
    const first = getBlockFraming();
    expect(getBlockFraming()).toBe(first);
    const framing = await first;
    // docs/assets.md, "Worked examples" 1: an isolated dirt block at variant 0 takes cell (9, 3).
    expect(framing.frameBlock({ type: 0, shape: 0, x: 0, y: 0, neighbours: [-1, -1, -1, -1, -1, -1, -1, -1] }))
      .toEqual({ column: 9, row: 3 });
    expect(framing.depth(0)).toBe(5);
  });
});
