import { describe, expect, it } from "vitest";
import { createWorld, type BlockShape, type CanonicalWorld, type Tile } from "./index.js";
import { createBrushHistory, type BrushOptions, type BrushRules } from "./brush.js";

const place = (id: number) => ({ kind: "place", id, paint: 0 }) as const;
const ERASE = { kind: "erase" } as const;
// Rope (213) stands in for a block that cannot be hammered.
const RULES: BrushRules = { shapeable: (id) => id !== 213 };

/** Rows of the area: `.` empty, `#` full, `h` half, `L`/`R` top-left/top-right corner cut, `l`/`r` bottom ones, `o` other blocks. */
function picture(world: CanonicalWorld, left: number, top: number, width: number, height: number): string[] {
  const glyph = (tile: Tile): string => {
    if (tile.block === undefined) return ".";
    if (tile.block.kind === "vanilla" && tile.block.id === 213) return "o";
    return { full: "#", half: "h", slopeTopLeft: "L", slopeTopRight: "R", slopeBottomLeft: "l", slopeBottomRight: "r" }[tile.shape ?? "full"];
  };
  return Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, column) => glyph(world.tileAt(left + column, top + row))).join(""));
}

function draw(world: CanonicalWorld, rows: readonly string[], left = 0, top = 0): void {
  rows.forEach((row, y) => {
    Array.from(row).forEach((glyph, x) => {
      if (glyph === ".") return;
      const shapes: Partial<Record<string, BlockShape>> = { h: "half", L: "slopeTopLeft", R: "slopeTopRight", l: "slopeBottomLeft", r: "slopeBottomRight" };
      const shape = shapes[glyph];
      world.setTile(left + x, top + y, { block: { kind: "vanilla", id: glyph === "o" ? 213 : 1 }, ...(shape === undefined ? {} : { shape }), wires: 0, actuator: false });
    });
  });
}

function stroke(world: CanonicalWorld, options: BrushOptions, points: readonly (readonly [number, number])[], rules: BrushRules = RULES) {
  const history = createBrushHistory(world, rules);
  history.begin(options);
  for (const [x, y] of points) history.move(x, y);
  return { history, diff: history.commit() };
}

describe("smooth brush", () => {
  it("rounds the corners of what it paints: a square gets four corner slopes", () => {
    const world = createWorld(9, 9);
    stroke(world, { block: place(1), size: 5, smooth: true }, [[4, 4]]);
    expect(picture(world, 1, 1, 7, 7)).toEqual([
      ".......",
      ".L###R.",
      ".#####.",
      ".#####.",
      ".#####.",
      ".l###r.",
      ".......",
    ]);
  });

  it("makes a one-tile bump on the ground a half block and smooths the steps of a diagonal line", () => {
    const world = createWorld(12, 8);
    draw(world, ["############"], 0, 7);
    stroke(world, { block: place(1), size: 1, smooth: true }, [[2, 6]]);
    stroke(world, { block: place(1), size: 2, smooth: true }, [[6, 6], [9, 3]]);
    expect(picture(world, 0, 1, 12, 7)).toEqual([
      "............",
      "........LR..",
      ".......L#r..",
      "......L#r...",
      ".....L#r....",
      "..h..##.....",
      "############",
    ]);
  });

  it("smooths the walls of a tunnel it erases, ground it did not paint included", () => {
    const world = createWorld(10, 7);
    draw(world, ["##########", "##########", "##########", "##########", "##########", "##########", "##########"]);
    stroke(world, { block: ERASE, size: 1, smooth: true }, [[1, 1], [5, 5]]);
    expect(picture(world, 0, 0, 10, 7)).toEqual([
      "##########",
      "#.l#######",
      "#R.l######",
      "##R.l#####",
      "###R.l####",
      "####R.####",
      "##########",
    ]);
  });

  it("puts back full blocks where a tile is no longer an edge, and takes back every shape on undo", () => {
    const world = createWorld(8, 6);
    draw(world, ["........", "........", "..L#R...", "..####..", "########", "########"]);
    const original = Object.values(world.planes).map((plane) => new Uint8Array(plane.buffer).slice());
    const { history } = stroke(world, { block: place(1), size: 1, smooth: true }, [[2, 1], [4, 1]]);
    expect(picture(world, 0, 0, 8, 6)).toEqual([
      "........",
      "..L#R...",
      "..###...",
      "..####..",
      "########",
      "########",
    ]);
    history.undo();
    expect(Object.values(world.planes).map((plane) => new Uint8Array(plane.buffer))).toEqual(original);
  });

  it("leaves blocks that cannot be shaped, protected tiles and wall-only or unsmoothed strokes alone", () => {
    const world = createWorld(9, 5);
    draw(world, [".........", ".........", "....o....", ".........", "#########"]);
    stroke(world, { block: place(1), size: 1, smooth: true }, [[1, 3], [7, 3]], { ...RULES, protectedTile: (x) => x === 7 });
    expect(picture(world, 0, 2, 9, 3)).toEqual([
      "....o....",
      ".L####R..",
      "#########",
    ]);
    const unsmoothed = createWorld(5, 5);
    stroke(unsmoothed, { block: place(1), size: 3 }, [[2, 2]]);
    expect(picture(unsmoothed, 1, 1, 3, 3)).toEqual(["###", "###", "###"]);
    const walls = createWorld(5, 5);
    draw(walls, [".....", ".###.", ".###.", ".###.", "....."]);
    stroke(walls, { wall: place(4), size: 3, smooth: true }, [[2, 2]]);
    expect(picture(walls, 1, 1, 3, 3)).toEqual(["###", "###", "###"]);
  });
});
