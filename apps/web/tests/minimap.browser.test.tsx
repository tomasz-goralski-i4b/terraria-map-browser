import { act } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { readWorldTiles } from "@studio/world-codec";
import { BRUSH_LAYER } from "@studio/world-model";
import type { Camera } from "@studio/renderer";
import { MapCanvas } from "../src/components/MapCanvas.js";
import { hydrateLayout, useLayoutStore } from "../src/shell/layout-store.js";
import { getMapController, useViewStore } from "../src/shell/view-store.js";
import { beginBrush, finishBrush, moveBrush, setBrushWorld, useBrushStore } from "../src/world/brush-session.js";
import { toRenderableWorld } from "../src/world/renderable-world.js";
import { useAppStore } from "../src/store.js";
import { PIN_RING_SIZE } from "../src/world/tile-markers.js";
import { brushSource } from "./support/brush-source.js";
import "../src/styles.css";

const WIDTH = 256;
const HEIGHT = 128;

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`${selector} is missing`);
  return found;
}

function canvas(): HTMLCanvasElement {
  const found = element("canvas[aria-label='World map']");
  if (!(found instanceof HTMLCanvasElement)) throw new Error("World map is not a canvas");
  return found;
}
const minimap = (): HTMLElement => element(".minimap");
const camera = (): Camera => JSON.parse(canvas().dataset["camera"] ?? "null") as Camera;
const draws = (): string | undefined => element(".minimap-image").dataset["draws"];

async function mount(): Promise<ReturnType<typeof readWorldTiles>> {
  const world = readWorldTiles(brushSource(WIDTH, HEIGHT, Array.from({ length: WIDTH }, () => [0x40, HEIGHT - 1]).flat()));
  setBrushWorld(world);
  await render(<div className="map-view" style={{ position: "relative", width: 400, height: 300 }}><MapCanvas world={toRenderableWorld(world)} /></div>);
  await expect.poll(() => canvas().dataset["camera"]).toBeDefined();
  return world;
}

/** Dispatches a primary-button pointer event at a fraction of the minimap's box. */
function pointer(type: string, fx: number, fy: number): void {
  const box = minimap().getBoundingClientRect();
  minimap().dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 7, isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1,
    clientX: box.left + fx * box.width, clientY: box.top + fy * box.height,
  }));
}

beforeEach(() => { hydrateLayout(null); });
afterEach(() => {
  setBrushWorld(null);
  useViewStore.setState({ tool: "pan", pinnedTile: null });
  useAppStore.setState({ phase: "idle", unsavedChanges: false });
});

test("the minimap shows the visible area while zoomed in and hides at fit-world zoom or when switched off", async () => {
  await mount();
  expect(minimap().hidden).toBe(true);
  act(() => { getMapController()?.jumpTo({ x: 64, y: 32, zoom: 4 * canvas().width / canvas().clientWidth }); });
  await expect.poll(() => minimap().hidden).toBe(false);
  const view = element(".minimap-view");
  expect(parseFloat(view.style.left)).toBeCloseTo(64 / WIDTH * 100, 3);
  expect(parseFloat(view.style.top)).toBeCloseTo(32 / HEIGHT * 100, 3);
  expect(parseFloat(view.style.width)).toBeCloseTo(100 / WIDTH * 100, 3);
  act(() => { useLayoutStore.getState().setMinimap(false); });
  expect(minimap().hidden).toBe(true);
  act(() => { useLayoutStore.getState().setMinimap(true); });
  expect(minimap().hidden).toBe(false);
  act(() => { getMapController()?.fitWorld(); });
  await expect.poll(() => minimap().hidden).toBe(true);
});

test("the overview is drawn once per world: camera moves only move the rectangle, an edit redraws it", async () => {
  await mount();
  expect(draws()).toBe("1");
  const before = getMapController()?.stats().textureUploads;
  for (const x of [10, 40, 90]) act(() => { getMapController()?.jumpTo({ x, y: 20, zoom: 3 }); });
  act(() => { getMapController()?.renderNow(); });
  expect(draws()).toBe("1");
  // The minimap is a 2D canvas of its own: the main map uploads no more than the newly visible chunks.
  expect(getMapController()?.stats().textureUploads).toBeLessThanOrEqual((before ?? 0) + 2);
  useBrushStore.setState({ layer: BRUSH_LAYER.block, blockId: 1, size: 3, shape: "square", smoothing: 0 });
  act(() => { beginBrush(false); moveBrush(20, 20); finishBrush(); });
  await expect.poll(draws).toBe("2");
});

test("clicking the minimap centres the map there; dragging the rectangle pans by the minimap's scale", async () => {
  await mount();
  const zoom = 4 * canvas().width / canvas().clientWidth;
  act(() => { getMapController()?.jumpTo({ x: 0, y: 0, zoom }); });
  await expect.poll(() => minimap().hidden).toBe(false);
  act(() => { pointer("pointerdown", 0.5, 0.5); pointer("pointerup", 0.5, 0.5); });
  await expect.poll(() => {
    const { x, y, zoom: z } = camera();
    return [Math.round(x + canvas().width / z / 2), Math.round(y + canvas().height / z / 2)];
  }).toEqual([129, 65]);
  // Settled at the centre: now drag the rectangle (around the centre) right and down by 10 CSS pixels.
  const start = camera();
  const box = minimap().getBoundingClientRect();
  const image = element(".minimap-image").getBoundingClientRect();
  act(() => {
    pointer("pointerdown", 0.5, 0.5);
    pointer("pointermove", 0.5 + 10 / box.width, 0.5 + 5 / box.height);
    pointer("pointerup", 0.5 + 10 / box.width, 0.5 + 5 / box.height);
  });
  expect(camera().x - start.x).toBeCloseTo(10 * WIDTH / image.width, 1);
  expect(camera().y - start.y).toBeCloseTo(5 * HEIGHT / image.height, 1);
  expect(camera().zoom).toBe(start.zoom);
});

test("a drag that starts outside the rectangle pans from the clicked place; a release the minimap missed ends it", async () => {
  await mount();
  const zoom = 4 * canvas().width / canvas().clientWidth;
  act(() => { getMapController()?.jumpTo({ x: 0, y: 0, zoom }); });
  await expect.poll(() => minimap().hidden).toBe(false);
  const box = minimap().getBoundingClientRect();
  const image = element(".minimap-image").getBoundingClientRect();
  // From 60 % across the image (right of the rectangle), then 10 CSS pixels right.
  const fx = (image.left - box.left + 0.6 * image.width) / box.width, fy = (image.top - box.top + 0.5 * image.height) / box.height;
  act(() => { pointer("pointerdown", fx, fy); pointer("pointermove", fx + 10 / box.width, fy); });
  const centre = (): number => camera().x + canvas().width / camera().zoom / 2;
  expect(centre()).toBeCloseTo(153.5 + 10 * WIDTH / image.width, 1);
  // A move with no button held (the release happened elsewhere) ends the drag: later moves do nothing.
  const before = camera();
  act(() => {
    minimap().dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 7, buttons: 0, clientX: box.left + 5, clientY: box.top + 5 }));
    pointer("pointermove", fx + 30 / box.width, fy);
  });
  expect(camera()).toEqual(before);
});

test("the minimap does not take pointer events outside its box", async () => {
  await mount();
  act(() => { getMapController()?.jumpTo({ x: 0, y: 0, zoom: 4 }); });
  await expect.poll(() => minimap().hidden).toBe(false);
  const box = minimap().getBoundingClientRect();
  expect(document.elementFromPoint(box.left - 4, box.bottom + 4)).toBe(canvas());
  expect(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest(".minimap")).toBe(minimap());
});

test("the pinned tile's marker has a light band and a dark rim, at least 12 px wide at fit-world zoom", async () => {
  await mount();
  act(() => { getMapController()?.fitWorld(); useViewStore.getState().setPinnedTile({ x: 100, y: 60 }); });
  await expect.poll(() => camera().zoom).toBeLessThan(2);
  const gl = canvas().getContext("webgl2");
  if (gl === null) throw new Error("World map has no WebGL context");
  getMapController()?.renderNow();
  const cam = camera();
  const density = canvas().width / canvas().clientWidth;
  const cx = Math.round((100.5 - cam.x) * cam.zoom), cy = Math.round((60.5 - cam.y) * cam.zoom);
  const span = Math.ceil(PIN_RING_SIZE * density);
  const row = new Uint8Array(span * 2 * 4);
  gl.readPixels(cx - span, canvas().height - 1 - cy, span * 2, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
  const lightness = Array.from({ length: span * 2 }, (_, i) => (row[i * 4] ?? 0) + (row[i * 4 + 1] ?? 0) + (row[i * 4 + 2] ?? 0));
  const light = lightness.map((value, i) => (value === 765 ? i : -1)).filter((i) => i >= 0);
  // White ink over a dark rim contrasts with a white tile and with a black one.
  expect(light.length).toBeGreaterThan(0);
  expect(lightness.some((value) => value < 120)).toBe(true);
  expect((Math.max(...light) - Math.min(...light) + 1) / density).toBeGreaterThanOrEqual(12);
});
