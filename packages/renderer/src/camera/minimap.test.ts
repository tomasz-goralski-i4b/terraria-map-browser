import { describe, expect, test } from "vitest";
import { fitWorld } from "./camera.js";
import { minimapSize, minimapTile, minimapViewRect } from "./minimap.js";

const world = { width: 8400, height: 2400 };
const viewport = { width: 1000, height: 600 };

describe("minimapSize", () => {
  test("keeps the world's aspect ratio inside the bounds", () => {
    expect(minimapSize(world, 480, 480)).toEqual({ width: 480, height: 137 });
    expect(minimapSize({ width: 100, height: 400 }, 480, 200)).toEqual({ width: 50, height: 200 });
  });

  test("never exceeds one pixel per tile", () => {
    expect(minimapSize({ width: 100, height: 50 }, 480, 480)).toEqual({ width: 100, height: 50 });
  });
});

describe("minimapViewRect", () => {
  const size = { width: 420, height: 120 }; // 20 tiles per minimap pixel on both axes

  test("is the visible tile range scaled to the minimap", () => {
    expect(minimapViewRect({ x: 2000, y: 400, zoom: 2 }, viewport, world, size))
      .toEqual({ x: 100, y: 20, width: 25, height: 15 });
    expect(minimapViewRect({ x: 4010, y: 1000, zoom: 0.5 }, viewport, world, size))
      .toEqual({ x: 200.5, y: 50, width: 100, height: 60 });
  });

  test("is clamped to the minimap where the view reaches past the world", () => {
    expect(minimapViewRect({ x: -100, y: -40, zoom: 1 }, viewport, world, size))
      .toEqual({ x: 0, y: 0, width: 45, height: 28 });
    expect(minimapViewRect({ x: 8000, y: 2000, zoom: 1 }, viewport, world, size))
      .toEqual({ x: 400, y: 100, width: 20, height: 20 });
  });

  test("covers the whole minimap at fit-world zoom", () => {
    expect(minimapViewRect(fitWorld(viewport, world), viewport, world, size)).toEqual({ x: 0, y: 0, width: 420, height: 120 });
  });
});

describe("minimapTile", () => {
  test("is the fractional tile under a minimap point", () => {
    const size = { width: 420, height: 120 };
    expect(minimapTile(0, 0, world, size)).toEqual({ x: 0, y: 0 });
    expect(minimapTile(210, 60, world, size)).toEqual({ x: 4200, y: 1200 });
    expect(minimapTile(420, 120, world, size)).toEqual({ x: 8400, y: 2400 });
  });
});
