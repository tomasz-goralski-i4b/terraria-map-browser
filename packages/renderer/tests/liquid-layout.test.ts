// The liquid layout of sprite mode (docs/assets.md, "Liquids"): which piece of its water sheet a liquid tile draws
// and where, and the liquid piece behind a solid block, on small synthetic worlds worked out by hand.
import { describe, expect, test } from "vitest";
import { BEHIND_OPACITY, behindPiece, liquidLayout, liquidPiece, shimmerGlitter, shimmerGlitterPlane } from "../src/chunk/liquid-layout.js";
import type { LiquidLayoutWorld } from "../src/chunk/liquid-layout.js";

const ABSENT = 0xffff;
const STONE = 0;
const HALF = 1;
const WATER = 1;
const LAVA = 2;
const SHIMMER = 4;

/** A world of `width` × `height` air tiles; palette 0 is stone, 1 a wood wall, 2 glass wall (21). */
function world(width: number, height: number, surfaceY = 0) {
  const count = width * height;
  const planes = {
    block: new Uint16Array(count).fill(ABSENT), wall: new Uint16Array(count).fill(ABSENT),
    liquid: new Uint8Array(count), liquidAmount: new Uint8Array(count), shape: new Uint8Array(count),
  };
  const at = (x: number, y: number): number => x * height + y;
  const self = {
    width, height, surfaceY, planes,
    palette: [{ kind: "vanilla", id: 1 }, { kind: "vanilla", id: 4 }, { kind: "vanilla", id: 21 }],
    stone(x: number, y: number, shape = 0) {
      planes.block[at(x, y)] = STONE;
      planes.shape[at(x, y)] = shape;
      return self;
    },
    pour(x: number, y: number, kind: number, amount = 255) {
      planes.liquid[at(x, y)] = kind;
      planes.liquidAmount[at(x, y)] = amount;
      return self;
    },
    wall(x: number, y: number, index = 1) {
      planes.wall[at(x, y)] = index;
      return self;
    },
  } satisfies LiquidLayoutWorld & Record<string, unknown>;
  return self;
}

/** The layout of the whole world, read back per tile. */
function layoutOf(source: LiquidLayoutWorld) {
  const layout = liquidLayout(source, { left: 0, top: 0, width: source.width, height: source.height });
  const index = (x: number, y: number): number => x * source.height + y;
  return {
    piece: (x: number, y: number) => liquidPiece(layout.cell[index(x, y)] ?? 0, layout.rect[index(x, y)] ?? 0, layout.behind[index(x, y)] ?? 0),
    behind: (x: number, y: number) => behindPiece(layout.behind[index(x, y)] ?? 0),
  };
}

describe("liquid pieces", () => {
  test("a lone tile of water in the air: the piece with both side edges and a top, falling and fading below it", () => {
    const layout = layoutOf(world(5, 16).pour(2, 2, WATER));
    expect(layout.piece(2, 2)).toEqual({ kind: WATER, source: { x: 16, y: 16 }, offset: { x: 0, y: 0 }, size: { width: 16, height: 16 }, surface: false, fade: 0 });
    // Below it the fall: the side pieces without a top, one step more faded per tile, ten tiles deep.
    expect(layout.piece(2, 3)).toEqual({ kind: WATER, source: { x: 16, y: 32 }, offset: { x: 0, y: 0 }, size: { width: 16, height: 16 }, surface: false, fade: 1 });
    expect(layout.piece(2, 12)?.fade).toBe(10);
    expect(layout.piece(2, 13)).toBeNull();
    expect(layout.piece(1, 2)).toBeNull();
  });

  test("the surface of a pool takes the surface band; its sides join the stone without edges", () => {
    const source = world(5, 6, 0).stone(0, 2).stone(4, 2);
    for (let x = 0; x < 5; x++) source.stone(x, 3);
    source.pour(1, 2, WATER).pour(2, 2, WATER).pour(3, 2, WATER);
    const layout = layoutOf(source);
    for (const x of [1, 2, 3]) {
      expect(layout.piece(x, 2)).toEqual({ kind: WATER, source: { x: 16, y: 0 }, offset: { x: 0, y: 0 }, size: { width: 16, height: 16 }, surface: true, fade: 0 });
    }
    // High above the surface the animated top piece is drawn instead of the surface band.
    const high = world(5, 6, 60).stone(0, 2).stone(4, 2);
    for (let x = 0; x < 5; x++) high.stone(x, 3);
    high.pour(1, 2, WATER).pour(2, 2, WATER).pour(3, 2, WATER);
    expect(layoutOf(high).piece(2, 2)?.surface).toBe(false);
  });

  test("a half-full tile is cut at its level: 128 of 255 draws 9 rows from row 7", () => {
    const source = world(3, 5).stone(0, 2).stone(2, 2).stone(1, 3).pour(1, 2, WATER, 128);
    expect(layoutOf(source).piece(1, 2)).toEqual({
      kind: WATER, source: { x: 16, y: 0 }, offset: { x: 0, y: 7 }, size: { width: 16, height: 9 }, surface: true, fade: 0,
    });
  });

  test("a half block under water shows the body in its upper half", () => {
    const source = world(3, 5).stone(0, 1).stone(2, 1).stone(0, 2).stone(2, 2).stone(1, 2, HALF).stone(1, 3).pour(1, 1, WATER);
    expect(layoutOf(source).piece(1, 2)).toEqual({
      kind: WATER, source: { x: 16, y: 56 }, offset: { x: 0, y: 0 }, size: { width: 16, height: 8 }, surface: false, fade: 0,
    });
  });
});

describe("liquid behind blocks", () => {
  test("water beside a block: a 4-pixel strip on that side, from its surface rows, at half opacity underground", () => {
    const source = world(4, 5, 0).stone(2, 2).stone(1, 3).stone(2, 3).pour(1, 2, WATER);
    expect(layoutOf(source).behind(2, 2)).toEqual({
      kind: WATER, dest: { x: 0, y: 0, width: 4, height: 16 }, sourceY: 0, opacity: BEHIND_OPACITY.half, gradient: false,
    });
  });

  test("above the surface the strip is opaque, 0.6 over a wall and 0.9 over glass", () => {
    const sky = (wall?: number) => {
      const source = world(4, 5, 10).stone(2, 2).stone(1, 3).stone(2, 3).pour(1, 2, WATER);
      if (wall !== undefined) source.wall(2, 2, wall);
      return layoutOf(source).behind(2, 2)?.opacity;
    };
    expect(sky()).toBe(BEHIND_OPACITY.full);
    expect(sky(1)).toBe(BEHIND_OPACITY.wall);
    expect(sky(2)).toBe(BEHIND_OPACITY.glass);
  });

  test("a half block under water: its top 12 rows, fading in from the top underground", () => {
    const source = world(3, 5).stone(0, 1).stone(2, 1).stone(0, 2).stone(2, 2).stone(1, 2, HALF).stone(1, 3).pour(1, 1, WATER);
    expect(layoutOf(source).behind(1, 2)).toEqual({
      kind: WATER, dest: { x: 0, y: 0, width: 16, height: 12 }, sourceY: 4, opacity: BEHIND_OPACITY.half, gradient: true,
    });
  });

  test("lava keeps its opacity and shimmer its own; liquid above a block shows in its top 4 rows; no liquid, no piece", () => {
    const lava = world(4, 5, 0).stone(2, 2).stone(1, 3).stone(2, 3).pour(1, 2, LAVA);
    expect(layoutOf(lava).behind(2, 2)?.opacity).toBe(BEHIND_OPACITY.full);
    const shimmer = world(4, 5, 0).stone(2, 2).stone(1, 3).stone(2, 3).pour(1, 2, SHIMMER);
    expect(layoutOf(shimmer).behind(2, 2)?.opacity).toBe(BEHIND_OPACITY.shimmer);
    expect(layoutOf(shimmer).behind(1, 3)).toEqual({
      kind: SHIMMER, dest: { x: 0, y: 0, width: 16, height: 4 }, sourceY: 4, opacity: BEHIND_OPACITY.shimmer, gradient: false,
    });
    expect(layoutOf(world(4, 5).stone(2, 2)).behind(2, 2)).toBeNull();
  });
});

describe("shimmer glitter (docs/assets.md, \"Liquids\")", () => {
  test("the body's glitter opacity is 0 where the shimmer wave is low or the noise vanishes, and 0–255 elsewhere", () => {
    // At x = 7, y = 0 the wave is sin(0.7 · 2π) < −0.5: no glitter; at the origin the noise is 0.
    expect(shimmerGlitter(7, 0)).toBe(0);
    expect(shimmerGlitter(0, 0)).toBe(0);
    const values = Array.from({ length: 400 }, (_, i) => shimmerGlitter(i % 20, Math.floor(i / 20)));
    expect(values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(20);
  });

  test("the plane holds the glitter of every corner of an area, column-major", () => {
    const plane = shimmerGlitterPlane(10, 20, 3, 4);
    expect(plane).toHaveLength(12);
    expect(plane[1 * 4 + 2]).toBe(shimmerGlitter(11, 22));
  });
});
