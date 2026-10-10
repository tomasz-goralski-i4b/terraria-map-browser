import { describe, expect, test } from "vitest";
import { WIRE_DRAW_ORDER, wireCell, wirePiece } from "../src/index.js";

// docs/assets.md, "Wires": a wire's piece is the WiresNew column whose art reaches exactly the sides where the same
// colour continues: up 1, right 2, down 4, left 8. Written out here so the test pins the documented table.
const DOCUMENTED: readonly (readonly [up: boolean, right: boolean, down: boolean, left: boolean, column: number])[] = [
  [false, false, false, false, 0], [true, false, false, false, 1], [false, true, false, false, 2], [true, true, false, false, 3],
  [false, false, true, false, 4], [true, false, true, false, 5], [false, true, true, false, 6], [true, true, true, false, 7],
  [false, false, false, true, 8], [true, false, false, true, 9], [false, true, false, true, 10], [true, true, false, true, 11],
  [false, false, true, true, 12], [true, false, true, true, 13], [false, true, true, true, 14], [true, true, true, true, 15],
];

describe("wire pieces", () => {
  test.each(DOCUMENTED)("up %s, right %s, down %s, left %s → column %i", (up, right, down, left, column) => {
    expect(wirePiece({ up, right, down, left })).toBe(column);
  });

  test("each colour reads its own row of WiresNew, and they are drawn red, blue, green, yellow from the bottom", () => {
    expect(WIRE_DRAW_ORDER).toEqual(["red", "blue", "green", "yellow"]);
    expect(wireCell("red", 5)).toEqual({ column: 5, row: 0 });
    expect(wireCell("blue", 10)).toEqual({ column: 10, row: 1 });
    expect(wireCell("green", 0)).toEqual({ column: 0, row: 2 });
    expect(wireCell("yellow", 15)).toEqual({ column: 15, row: 3 });
  });
});
