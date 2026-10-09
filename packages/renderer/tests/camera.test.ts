import { describe, expect, test } from "vitest";
import {
  MAX_ZOOM, MIN_ZOOM, actualSize, clampCamera, clampZoom, fitWorld, panBy, screenToTile, tileToScreen, visibleChunks,
  zoomAt,
} from "../src/index.js";
import type { Camera } from "../src/index.js";

const world = { width: 8400, height: 2400 };
const viewport = { width: 800, height: 600 };

describe("screen ↔ tile conversion", () => {
  test.each([0.25, 1, 3.5, 16])("round-trips at zoom %f", (zoom) => {
    const camera: Camera = { x: 1000.5, y: 400.25, zoom };
    const tile = screenToTile(camera, 123, 456);
    expect(tile.x).toBeCloseTo(1000.5 + 123 / zoom, 9);
    expect(tile.y).toBeCloseTo(400.25 + 456 / zoom, 9);
    const back = tileToScreen(camera, tile.x, tile.y);
    expect(back.x).toBeCloseTo(123, 9);
    expect(back.y).toBeCloseTo(456, 9);
  });

  test("the top-left viewport pixel is the camera position", () => {
    expect(screenToTile({ x: 10, y: 20, zoom: 2 }, 0, 0)).toEqual({ x: 10, y: 20 });
  });
});

describe("zoom", () => {
  test.each([[0.01, MIN_ZOOM], [100, MAX_ZOOM], [2, 2]])("clampZoom(%f) = %f", (input, expected) => {
    expect(clampZoom(input)).toBe(expected);
  });

  test("the limits are 1/8 and 64 pixels per tile", () => {
    expect(MIN_ZOOM).toBe(0.125);
    expect(MAX_ZOOM).toBe(64);
  });

  test.each([[2, 300, 200], [8, 0, 0], [0.5, 799, 599], [16, 400, 300], [64, 123, 456]])(
    "zoomAt(%f) at pointer (%i, %i) keeps the tile under the pointer fixed",
    (zoom, sx, sy) => {
      const camera: Camera = { x: 3000, y: 1000, zoom: 1 };
      const before = screenToTile(camera, sx, sy);
      const zoomed = zoomAt(camera, zoom, sx, sy, viewport, world);
      expect(zoomed.zoom).toBe(zoom);
      const after = screenToTile(zoomed, sx, sy);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    },
  );

  test("zoomAt clamps the requested zoom", () => {
    const camera: Camera = { x: 3000, y: 1000, zoom: 1 };
    expect(zoomAt(camera, 1000, 400, 300, viewport, world).zoom).toBe(MAX_ZOOM);
    expect(zoomAt({ ...camera, zoom: MAX_ZOOM }, 2 * MAX_ZOOM, 400, 300, viewport, world)).toEqual({ ...camera, zoom: MAX_ZOOM });
    expect(zoomAt(camera, 0.0001, 400, 300, viewport, world).zoom).toBe(viewport.width / world.width);
  });
});

describe("clamping", () => {
  test("the viewport cannot leave the world on any side", () => {
    const camera: Camera = { x: 0, y: 0, zoom: 2 };
    expect(clampCamera({ ...camera, x: -50, y: -50 }, viewport, world)).toEqual({ x: 0, y: 0, zoom: 2 });
    const far = clampCamera({ ...camera, x: 99999, y: 99999 }, viewport, world);
    expect(far.x).toBe(8400 - 800 / 2);
    expect(far.y).toBe(2400 - 600 / 2);
  });

  test("a world smaller than the viewport on an axis is centred on it", () => {
    const small = { width: 100, height: 5000 };
    const clamped = clampCamera({ x: 40, y: 10, zoom: 2 }, viewport, small);
    expect(clamped.x).toBe((100 - 800 / 2) / 2);
    expect(clamped.y).toBe(10);
  });

  test("panBy moves content with the pointer and clamps at the world edge", () => {
    const camera: Camera = { x: 1000, y: 1000, zoom: 2 };
    expect(panBy(camera, 100, -40, viewport, world)).toEqual({ x: 950, y: 1020, zoom: 2 });
    expect(panBy(camera, 1e6, 1e6, viewport, world)).toEqual({ x: 0, y: 0, zoom: 2 });
  });
});

describe("fit world and 1:1", () => {
  test("fitWorld shows the whole world centred at the largest zoom that fits", () => {
    const camera = fitWorld({ width: 1680, height: 480 }, world);
    expect(camera.zoom).toBeCloseTo(0.2, 9);
    expect(camera.x).toBeCloseTo(0, 9);
    expect(camera.y).toBeCloseTo(0, 9);
  });

  test("fitWorld can go below the usual minimum to show a large world in a small viewport", () => {
    expect(fitWorld(viewport, world).zoom).toBe(viewport.width / world.width);
  });

  test.each([{ width: 0, height: 600 }, { width: 800, height: 0 }])("fitWorld keeps a finite camera for an empty viewport %o", (empty) => {
    const camera = fitWorld(empty, { width: 4200, height: 1200 });
    expect(camera.zoom).toBe(MIN_ZOOM);
    expect(Number.isFinite(camera.x) && Number.isFinite(camera.y)).toBe(true);
  });

  test("zooming out below the current floor never zooms in (after the viewport grew)", () => {
    const custom = { width: 13400, height: 3800 };
    const fitted = fitWorld({ width: 1280, height: 636 }, custom);
    const grown = { width: 2560, height: 1272 };
    expect(zoomAt(fitted, fitted.zoom * 0.9, 1280, 636, grown, custom).zoom).toBe(fitted.zoom);
    expect(zoomAt(fitted, fitted.zoom * 1.1, 1280, 636, grown, custom).zoom).toBeCloseTo(fitted.zoom * 1.1, 9);
  });

  test("the wheel-zoom floor stays MIN_ZOOM when the world already fits at that scale", () => {
    const small = { width: 4200, height: 1200 };
    const roomy = { width: 1920, height: 1080 };
    expect(fitWorld(roomy, small).zoom).toBeCloseTo(1920 / 4200, 9);
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, 0.0001, 960, 540, roomy, small).zoom).toBe(MIN_ZOOM);
  });

  test("fits every chunk of the custom CMCO1 world and keeps wheel zoom continuous at that scale", () => {
    const customWorld = { width: 13400, height: 3800 };
    const mapViewport = { width: 1280, height: 636 };
    const fitted = fitWorld(mapViewport, customWorld);
    expect(fitted.zoom).toBeCloseTo(1280 / 13400, 9);
    expect(visibleChunks(fitted, mapViewport, customWorld)).toHaveLength(105 * 30);
    expect(zoomAt(fitted, fitted.zoom, 640, 318, mapViewport, customWorld)).toEqual(fitted);
    expect(zoomAt(fitted, fitted.zoom * 1.1, 640, 318, mapViewport, customWorld).zoom).toBeCloseTo(fitted.zoom * 1.1, 9);
  });

  test("actualSize is one pixel per tile around the viewport centre", () => {
    const camera: Camera = { x: 2000, y: 800, zoom: 4 };
    const before = screenToTile(camera, 400, 300);
    const actual = actualSize(camera, viewport, world);
    expect(actual.zoom).toBe(1);
    const after = screenToTile(actual, 400, 300);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
});

describe("visible chunks", () => {
  test("a viewport inside one chunk sees only it", () => {
    expect(visibleChunks({ x: 10, y: 10, zoom: 1 }, { width: 100, height: 100 }, world)).toEqual([{ x: 0, y: 0 }]);
  });

  test("a viewport straddling chunk borders lists every touched chunk, ordered by y then x", () => {
    expect(visibleChunks({ x: 100, y: 120, zoom: 1 }, { width: 100, height: 20 }, world)).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 },
    ]);
  });

  test("a viewport ending exactly on a chunk border does not include the next chunk", () => {
    expect(visibleChunks({ x: 0, y: 0, zoom: 1 }, { width: 256, height: 128 }, world)).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 },
    ]);
  });

  test("zoom changes the covered tile range", () => {
    // 512 px at 4 px/tile = 128 tiles; at 0.5 px/tile = 1024 tiles = 8 chunk columns.
    // 64 px at 0.5 px/tile = 128 tiles = exactly one chunk row.
    expect(visibleChunks({ x: 0, y: 0, zoom: 4 }, { width: 512, height: 512 }, world)).toEqual([{ x: 0, y: 0 }]);
    expect(visibleChunks({ x: 0, y: 0, zoom: 0.5 }, { width: 512, height: 64 }, world)).toHaveLength(8);
  });

  test("chunks are clipped to the world grid, including the partial edge chunk", () => {
    const edge = visibleChunks({ x: 8300, y: 2300, zoom: 1 }, { width: 800, height: 600 }, world);
    expect(edge).toEqual([{ x: 64, y: 17 }, { x: 65, y: 17 }, { x: 64, y: 18 }, { x: 65, y: 18 }]);
  });

  test("the whole world at the minimum zoom lists every chunk exactly once", () => {
    const camera = fitWorld({ width: 1050, height: 300 }, world);
    expect(visibleChunks(camera, { width: 1050, height: 300 }, world)).toHaveLength(66 * 19);
  });
});
