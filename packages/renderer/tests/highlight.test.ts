// The content highlight's CPU side: which tiles match, the overlay the chunk pass draws over them (the GPU reference),
// and the overview's match mask with its "any" mip levels, built in slices.
import { describe, expect, test } from "vitest";
import {
  DEFAULT_HIGHLIGHT_COLOR, DEFAULT_HIGHLIGHT_DIM, HIGHLIGHT_OUTLINE_PIXELS, HIGHLIGHT_OUTLINE_ZOOM, HIGHLIGHT_TINT_ALPHA,
  createHighlightMask, highlightLookup, highlightMatches, highlightOverlay,
} from "../src/index.js";
import type { HighlightWorld, MapHighlight } from "../src/index.js";

const ABSENT = 0xffff;

/** A world of `width` × `height` air tiles with a palette of `paletteLength` entries; `set` places content. */
function world(width: number, height: number, paletteLength = 4): HighlightWorld & {
  set: (x: number, y: number, tile: { block?: number; wall?: number; liquid?: number }) => void;
} {
  const count = width * height;
  const block = new Uint16Array(count).fill(ABSENT);
  const wall = new Uint16Array(count).fill(ABSENT);
  const liquid = new Uint8Array(count);
  return {
    width, height, palette: { length: paletteLength }, planes: { block, wall, liquid },
    set: (x, y, tile) => {
      const index = x * height + y;
      if (tile.block !== undefined) block[index] = tile.block;
      if (tile.wall !== undefined) wall[index] = tile.wall;
      if (tile.liquid !== undefined) liquid[index] = tile.liquid;
    },
  };
}

const highlight = (fields: Partial<MapHighlight>): MapHighlight => ({ blocks: [], walls: [], liquids: [], dim: true, ...fields });

describe("matching", () => {
  test("a tile matches by its block's or wall's palette index, or its liquid kind (amount ignored)", () => {
    const w = world(5, 1);
    w.set(0, 0, { block: 1 });
    w.set(1, 0, { wall: 2 });
    w.set(2, 0, { liquid: 3 });
    // Liquid flag bits above the kind (bits 3+) do not change the kind.
    w.set(3, 0, { liquid: 3 | 0b1000 });
    w.set(4, 0, { block: 2, wall: 1, liquid: 1 });
    const lookup = highlightLookup(highlight({ blocks: [1], walls: [2], liquids: [3] }));
    const liquids = 1 << 3;
    expect([0, 1, 2, 3, 4].map((x) => highlightMatches(w, lookup, liquids, x * w.height))).toEqual([true, true, true, true, false]);
  });

  test("indices at or past the palette's length never match", () => {
    const w = world(2, 1, 2);
    w.set(0, 0, { block: 3 });
    w.set(1, 0, { wall: 2 });
    const lookup = highlightLookup(highlight({ blocks: [3], walls: [2] }));
    expect(highlightMatches(w, lookup, 0, 0)).toBe(false);
    expect(highlightMatches(w, lookup, 0, 1)).toBe(false);
  });

  test("rejects indices and liquid kinds outside their ranges", () => {
    expect(() => highlightLookup(highlight({ blocks: [65535] }))).toThrow(RangeError);
    expect(() => highlightLookup(highlight({ walls: [-1] }))).toThrow(RangeError);
    expect(() => highlightLookup(highlight({ blocks: [1.5] }))).toThrow(RangeError);
  });
});

describe("highlightOverlay", () => {
  // A 2 × 1 group of matches with a lone non-matching tile between it and a third match.
  const w = world(6, 3);
  w.set(1, 1, { block: 1 });
  w.set(2, 1, { block: 1 });
  w.set(4, 1, { wall: 2 });
  const camera = { x: 0, y: 0, zoom: 8 };
  const viewport = { width: 48, height: 24 };
  const at = (pixels: Uint8ClampedArray, x: number, y: number): number[] =>
    [...pixels.subarray((y * viewport.width + x) * 4, (y * viewport.width + x) * 4 + 4)];
  const dim = Math.round(DEFAULT_HIGHLIGHT_DIM * 255);

  test("outlines a group's outer edges, leaves its inside clear and dims the rest", () => {
    const pixels = highlightOverlay(w, highlight({ blocks: [1], walls: [2] }), camera, viewport);
    const ink = [...DEFAULT_HIGHLIGHT_COLOR, 255];
    // Tile (1, 1) spans pixels 8–15 × 8–15: its left, top and bottom edges are outlined, not the right (tile (2, 1)).
    expect(at(pixels, 8, 12)).toEqual(ink);
    expect(at(pixels, 8 + HIGHLIGHT_OUTLINE_PIXELS - 1, 12)).toEqual(ink);
    expect(at(pixels, 8 + HIGHLIGHT_OUTLINE_PIXELS, 12)).toEqual([0, 0, 0, 0]);
    expect(at(pixels, 12, 8)).toEqual(ink);
    expect(at(pixels, 12, 15)).toEqual(ink);
    expect(at(pixels, 15, 12)).toEqual([0, 0, 0, 0]);
    expect(at(pixels, 16, 12)).toEqual([0, 0, 0, 0]);
    expect(at(pixels, 23, 12)).toEqual(ink);
    // The air tile (3, 1) and everything else is dimmed.
    expect(at(pixels, 28, 12)).toEqual([0, 0, 0, dim]);
    expect(at(pixels, 0, 0)).toEqual([0, 0, 0, dim]);
    // A wall match is outlined on all sides.
    expect(at(pixels, 32, 12)).toEqual(ink);
    expect(at(pixels, 39, 12)).toEqual(ink);
  });

  test("without dim the non-matching tiles stay clear", () => {
    const pixels = highlightOverlay(w, highlight({ blocks: [1], dim: false }), camera, viewport);
    expect(at(pixels, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(at(pixels, 8, 12)).toEqual([...DEFAULT_HIGHLIGHT_COLOR, 255]);
  });

  test(`below ${String(HIGHLIGHT_OUTLINE_ZOOM)} pixels per tile matches are tinted instead of outlined`, () => {
    const pixels = highlightOverlay(
      w, highlight({ blocks: [1] }), { x: 0, y: 0, zoom: 2 }, { width: 12, height: 6 },
      { highlightColor: [10, 20, 30], highlightDim: 0.5 },
    );
    const pixel = (x: number, y: number): number[] => [...pixels.subarray((y * 12 + x) * 4, (y * 12 + x) * 4 + 4)];
    expect(pixel(2, 2)).toEqual([10, 20, 30, HIGHLIGHT_TINT_ALPHA]);
    expect(pixel(3, 3)).toEqual([10, 20, 30, HIGHLIGHT_TINT_ALPHA]);
    expect(pixel(6, 2)).toEqual([0, 0, 0, 128]);
  });

  test("pixels outside the world are clear and the world's edge is not outlined", () => {
    const edge = world(2, 2);
    edge.set(0, 0, { block: 0 });
    const pixels = highlightOverlay(edge, highlight({ blocks: [0] }), { x: -1, y: 0, zoom: 8 }, { width: 32, height: 8 });
    const pixel = (x: number, y: number): number[] => [...pixels.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];
    expect(pixel(2, 4)).toEqual([0, 0, 0, 0]);
    expect(pixel(8, 4)).toEqual([0, 0, 0, 0]);
    expect(pixel(15, 4)).toEqual([...DEFAULT_HIGHLIGHT_COLOR, 255]);
  });
});

describe("createHighlightMask", () => {
  test("marks a texel when any of its factor × factor tiles matches, built column by column", () => {
    const w = world(10, 7);
    w.set(3, 6, { block: 1 });
    w.set(9, 0, { liquid: 2 });
    const mask = createHighlightMask(w, highlightLookup(highlight({ blocks: [1] })), 1 << 2, 2);
    expect([mask.width, mask.height]).toEqual([5, 4]);
    let steps = 0;
    while (!mask.done) {
      // A deadline that has always passed: one column per step.
      const rects = mask.step(() => true);
      expect(rects[0]).toEqual({ level: 0, x: steps, y: 0, width: 1, height: 4 });
      steps++;
    }
    expect(steps).toBe(5);
    const base = mask.levels[0];
    expect(base?.[3 * 5 + 1]).toBe(255);
    expect(base?.[0 * 5 + 4]).toBe(255);
    expect(base?.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0)).toBe(2);
  });

  test("mip levels keep any match (max, not mean), odd edges folded into the last texel", () => {
    const w = world(14, 2);
    w.set(13, 1, { block: 1 });
    const mask = createHighlightMask(w, highlightLookup(highlight({ blocks: [1] })), 0, 2);
    while (!mask.done) mask.step(() => false);
    // 7 × 1, 3 × 1, 1 × 1.
    expect(mask.levels.map((level) => level.length)).toEqual([7, 3, 1]);
    expect([...(mask.levels[1] ?? [])]).toEqual([0, 0, 255]);
    expect([...(mask.levels[2] ?? [])]).toEqual([255]);
  });

  test(
    "a step on a Large world honours its deadline: no step of a 6 ms budget takes 16 ms",
    { tags: ["perf"], timeout: 60_000 },
    () => {
      const w = world(8400, 2400, 3);
      for (let i = 0; i < w.planes.block.length; i += 7) w.planes.block[i] = 1;
      // Nothing matches block 2 or lava: every tile is read.
      const mask = createHighlightMask(w, highlightLookup(highlight({ blocks: [2] })), 1 << 4, 2);
      const steps: number[] = [];
      while (!mask.done) {
        const start = performance.now();
        mask.step(() => performance.now() >= start + 6);
        steps.push(performance.now() - start);
      }
      expect(steps.length).toBeGreaterThan(1);
      expect(Math.max(...steps), steps.map((time) => time.toFixed(1)).join(", ")).toBeLessThan(16);
    },
  );

  test("patch recomputes the texels of changed tiles and their mip levels", () => {
    const w = world(8, 8);
    w.set(5, 5, { block: 1 });
    const mask = createHighlightMask(w, highlightLookup(highlight({ blocks: [1] })), 0, 2);
    while (!mask.done) mask.step(() => false);
    w.set(5, 5, { block: 0 });
    w.set(0, 1, { block: 1 });
    const rects = mask.patch([{ x: 5, y: 5 }, { x: 0, y: 1 }]);
    expect(rects[0]).toEqual({ level: 0, x: 0, y: 0, width: 3, height: 3 });
    expect(mask.levels[0]?.[2 * 4 + 2]).toBe(0);
    expect(mask.levels[0]?.[0]).toBe(255);
    expect([...(mask.levels[2] ?? [])]).toEqual([255]);
  });
});
