import { describe, expect, test } from "vitest";
import { TRACK_EXTRA_OFFSET, objectSprites, trackExtraCell, trackPiece } from "../src/index.js";
import type { ObjectWorld, TrackExtra } from "../src/index.js";

// docs/assets.md, "Minecart tracks": the Tiles_314 cell (column, row) of every stored piece and the extras it draws,
// written out here so the test pins the documented table rather than the generated one.
const L = "leftDown";
const R = "rightDown";
const B = "bumper";
const BB = "bouncyBumper";
const DOCUMENTED: readonly (readonly [number, number, readonly TrackExtra[]])[] = [
  [0, 0, []], [1, 0, []], [2, 1, [B]], [3, 1, [B]], [0, 2, [L]], [1, 2, [R]], [0, 1, []], [1, 1, []],
  [0, 3, [R]], [1, 3, [L]], [4, 1, [L, B]], [5, 1, [R, B]], [6, 1, [B]], [7, 1, [B]], [2, 0, []], [3, 0, []],
  [4, 0, [L]], [5, 0, [R]], [6, 0, []], [7, 0, []], [0, 4, []], [1, 4, []], [0, 5, []], [1, 5, []],
  [2, 2, [BB]], [3, 2, [BB]], [4, 2, [L, BB]], [5, 2, [R, BB]], [6, 2, [BB]], [7, 2, [BB]], [2, 3, []], [3, 3, []],
  [4, 3, [R]], [5, 3, [L]], [6, 3, [R]], [7, 3, [L]],
];

describe("minecart track pieces", () => {
  test.each(DOCUMENTED.map((entry, piece) => [piece, ...entry] as const))(
    "stored piece %i takes cell (%i, %i) and draws %j",
    (piece, column, row, extras) => {
      expect(trackPiece(piece)).toEqual({ column, row, extras });
    },
  );

  test("a value outside the 36 pieces has no cell (drawn in its map colour)", () => {
    for (const piece of [-1, 36, 39, 1000]) expect(trackPiece(piece)).toBeUndefined();
  });

  test("the extras take their documented cells: decorations one tile below the track, bumpers one tile above", () => {
    expect(trackExtraCell("leftDown")).toEqual({ column: 0, row: 6 });
    expect(trackExtraCell("rightDown")).toEqual({ column: 1, row: 6 });
    expect(trackExtraCell("bumper")).toEqual({ column: 0, row: 7 });
    expect(trackExtraCell("bouncyBumper")).toEqual({ column: 1, row: 7 });
    expect(TRACK_EXTRA_OFFSET).toEqual({ leftDown: 1, rightDown: 1, bumper: -1, bouncyBumper: -1 });
  });
});

describe("minecart track extras", () => {
  const ABSENT = 0xffff;
  const STONE = 1;
  const TRACK = 314;

  /** A left-down slope piece (4) at (2, 2) over a stone block of `shape` at (2, 3); 0 full, 1 half, 2–5 slopes. */
  function slopeOver(shape: number | null): ObjectWorld {
    const height = 6;
    const block = new Uint16Array(6 * height).fill(ABSENT);
    const frameX = new Int16Array(6 * height).fill(-1);
    const frameY = new Int16Array(6 * height).fill(-1);
    const shapes = new Uint8Array(6 * height);
    block[2 * height + 2] = 0;
    frameX[2 * height + 2] = 4;
    if (shape !== null) {
      block[2 * height + 3] = 1;
      shapes[2 * height + 3] = shape;
    }
    return {
      width: 6, height, planes: { block, frameX, frameY, shape: shapes },
      palette: [{ kind: "vanilla", id: TRACK }, { kind: "vanilla", id: STONE }],
    };
  }

  const decoration = { kind: "tile", id: TRACK, sx: 0, sy: 6 * 18, width: 16, height: 16, dx: 32, dy: 48 };
  const all = { left: 0, top: 0, right: 6, bottom: 6 };

  test("a slope's decoration is drawn on the tile below it when that tile is empty", () => {
    expect(objectSprites(slopeOver(null), all)).toEqual([decoration]);
  });

  test.each([1, 2, 3, 4, 5])("a slope's decoration is drawn over a block of shape %i below it (its open part)", (shape) => {
    expect(objectSprites(slopeOver(shape), all)).toEqual([decoration]);
  });

  test("a full block below a slope keeps its pixels", () => {
    expect(objectSprites(slopeOver(0), all)).toEqual([]);
  });
});
