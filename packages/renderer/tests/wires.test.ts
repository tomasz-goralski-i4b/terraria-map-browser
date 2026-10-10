import { describe, expect, test } from "vitest";
import { WIRE_DRAW_ORDER, wireCell, wirePiece } from "../src/index.js";
import { collectWireRuns } from "../src/objects/wires.js";

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

describe("wire runs of a chunk", () => {
  test("are the vertical runs of tiles with any wire or actuator, inside the chunk and the world, with their bits", () => {
    const width = 130;
    const height = 140;
    const flags = new Uint16Array(width * height);
    const at = (x: number, y: number): number => x * height + y;
    for (let y = 3; y < 6; y++) flags[at(2, y)] = 1; // a red run x 2, y 3–5
    flags[at(2, 8)] = 16; // an actuator alone
    flags[at(127, 126)] = 4; // green, running past the chunk's bottom edge
    flags[at(127, 127)] = 4;
    flags[at(127, 128)] = 4;
    flags[at(128, 5)] = 2; // next chunk
    flags[at(5, 5)] = 32; // not a wire bit
    const { bits, runs } = collectWireRuns({ width, height, planes: { flags } }, { x: 0, y: 0 });
    expect(bits).toBe(1 | 4 | 16);
    expect([...runs]).toEqual([2, 3, 1, 3, 2, 8, 1, 1, 127, 126, 1, 2]);
    expect([...collectWireRuns({ width, height, planes: { flags } }, { x: 1, y: 1 }).runs]).toEqual([]);
    expect([...collectWireRuns({ width, height, planes: { flags } }, { x: 0, y: 1 }).runs]).toEqual([127, 128, 1, 1]);
  });
});
