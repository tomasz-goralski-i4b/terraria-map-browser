import { describe, expect, it } from "vitest";
import { layoutFrames, objectFrames, resolveObject, type ObjectLayout } from "./object-frames.js";
import { terrariaObjectLayouts } from "./terraria-object-layouts.generated.js";

describe("resolveObject", () => {
  it.each([
    ["chest", 21, 450, 0, 12, 1, 0],
    ["dresser", 88, 108, 18, 2, 0, 1],
    ["torch", 4, 0, 66, 3, 0, 0],
    ["chair (1 × 2)", 15, 0, 58, 1, 0, 1],
    ["chandelier (3 × 3)", 34, 18, 72, 1, 1, 1],
    ["chandelier past the wrap of its column", 34, 126, 180, 40, 1, 1],
    ["door past the wrap of its column", 10, 54, 234, 40, 0, 1],
  ])("resolves a %s frame to its style and part", (_, tile, frameX, frameY, style, dx, dy) => {
    expect(resolveObject(tile, frameX, frameY)).toEqual({ style, part: { dx, dy }, originOffset: { dx: -dx, dy: -dy } });
  });

  it("resolves an unknown, non-object or modded id to null", () => {
    expect(resolveObject(1, 0, 0)).toBeNull();
    expect(resolveObject(9999, 0, 0)).toBeNull();
    expect(resolveObject(-1, 0, 0)).toBeNull();
  });

  it("resolves frames off the style grid or past the styles items place to null", () => {
    expect(resolveObject(21, 9, 0)).toBeNull();
    expect(resolveObject(21, -36, 0)).toBeNull();
    expect(resolveObject(21, 0, 36)).toBeNull();
    const styles = terrariaObjectLayouts.layouts[21]?.styles ?? 0;
    expect(styles).toBeGreaterThan(12);
    expect(resolveObject(21, styles * 36, 0)).toBeNull();
  });
});

describe("objectFrames", () => {
  it("lists the frames of every tile of a chest from its top-left tile", () => {
    expect(objectFrames(21, 12, { x: 10, y: 20 })).toEqual([
      { x: 10, y: 20, frameX: 432, frameY: 0 },
      { x: 11, y: 20, frameX: 450, frameY: 0 },
      { x: 10, y: 21, frameX: 432, frameY: 18 },
      { x: 11, y: 21, frameX: 450, frameY: 18 },
    ]);
  });

  it("has no frames for an unknown id or a style outside the sheet", () => {
    expect(objectFrames(1, 0, { x: 0, y: 0 })).toBeNull();
    expect(objectFrames(21, -1, { x: 0, y: 0 })).toBeNull();
    expect(objectFrames(21, 10_000, { x: 0, y: 0 })).toBeNull();
  });

  it("round-trips styles 0–2 of every id in the table through resolveObject", () => {
    const ids = Object.keys(terrariaObjectLayouts.layouts).map(Number);
    expect(ids.length).toBeGreaterThan(300);
    for (const id of ids) {
      const styles = Math.min(3, terrariaObjectLayouts.layouts[id]?.styles ?? 3);
      for (let style = 0; style < styles; style++) {
        const frames = objectFrames(id, style, { x: 100, y: 200 });
        expect(frames, `tile ${String(id)} style ${String(style)}`).not.toBeNull();
        for (const frame of frames ?? []) {
          const part = { dx: frame.x - 100, dy: frame.y - 200 };
          expect(resolveObject(id, frame.frameX, frame.frameY), `tile ${String(id)} style ${String(style)}`)
            .toEqual({ style, part, originOffset: { dx: -part.dx, dy: -part.dy } });
        }
      }
    }
  });
});

describe("layoutFrames", () => {
  // A 2 × 1 object, styles down the sheet in columns of 3, every second column holding the "off" frames.
  const layout: ObjectLayout = { cellX: [0, 18], cellY: [0], styleWidth: 36, styleHeight: 18, horizontal: false, wrap: 3, multiplier: 1, lineSkip: 2, styles: null };

  it("wraps styles onto further columns, skipping the state columns", () => {
    expect(layoutFrames(layout, 4)).toEqual([{ dx: 0, dy: 0, frameX: 72, frameY: 18 }, { dx: 1, dy: 0, frameX: 90, frameY: 18 }]);
  });
});
