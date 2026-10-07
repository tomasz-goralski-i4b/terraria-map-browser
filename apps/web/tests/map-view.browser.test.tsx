import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { screenToTile, visibleChunks } from "@studio/renderer";
import type { Camera, RenderableWorld } from "@studio/renderer";
import { MapView } from "../src/components/MapView.js";

const width = 1200;
const height = 600;
const viewport = { width: 400, height: 300 };

function syntheticWorld(): RenderableWorld {
  const count = width * height;
  const block = new Uint16Array(count).fill(0xffff);
  for (let i = 0; i < count; i += 3) block[i] = 0;
  return {
    width, height, surfaceY: 200,
    planes: { block, wall: new Uint16Array(count).fill(0xffff), liquid: new Uint8Array(count), liquidAmount: new Uint8Array(count) },
    palette: [{ kind: "vanilla", id: 0 }],
  };
}

const world = syntheticWorld();

function canvas(): HTMLCanvasElement {
  const element = document.querySelector("canvas");
  if (element === null) throw new Error("MapView rendered no canvas");
  return element;
}

function camera(): Camera {
  return JSON.parse(canvas().dataset["camera"] ?? "null") as Camera;
}

function chunks(): [number, number][] {
  return JSON.parse(canvas().dataset["visibleChunks"] ?? "null") as [number, number][];
}

async function mountMap(): Promise<void> {
  await render(
    <div style={{ width: viewport.width, height: viewport.height, position: "relative" }}>
      <MapView renderer="@studio/renderer" world={world} />
    </div>,
  );
  await vi.waitFor(() => {
    expect(canvas().dataset["camera"]).toBeDefined();
  });
}

function pointer(type: string, x: number, y: number, buttons: number): void {
  const rect = canvas().getBoundingClientRect();
  canvas().dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, buttons,
    clientX: rect.left + x, clientY: rect.top + y,
  }));
}

function wheel(x: number, y: number, deltaY: number): void {
  const rect = canvas().getBoundingClientRect();
  canvas().dispatchEvent(new WheelEvent("wheel", {
    bubbles: true, cancelable: true, deltaY, clientX: rect.left + x, clientY: rect.top + y,
  }));
}

function key(name: string): void {
  canvas().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

test("the visible-chunk set follows the camera and equals the pure visibleChunks result", async () => {
  await mountMap();
  await page.getByRole("button", { name: "1:1" }).click();
  const cam = camera();
  expect(cam.zoom).toBe(1);
  await vi.waitFor(() => {
    expect(chunks()).toEqual(visibleChunks(cam, viewport, { width, height }).map((chunk: { x: number; y: number }) => [chunk.x, chunk.y]));
  });
});

test("dragging pans the map: content follows the pointer", async () => {
  await mountMap();
  await page.getByRole("button", { name: "1:1" }).click();
  const before = camera();
  pointer("pointerdown", 200, 150, 1);
  pointer("pointermove", 150, 120, 1);
  pointer("pointerup", 150, 120, 0);
  await vi.waitFor(() => {
    const after = camera();
    expect(after.x).toBeCloseTo(before.x + 50, 6);
    expect(after.y).toBeCloseTo(before.y + 30, 6);
    expect(after.zoom).toBe(1);
  });
});

test("arrow keys pan and +/- zoom around the viewport", async () => {
  await mountMap();
  await page.getByRole("button", { name: "1:1" }).click();
  const start = camera();
  key("ArrowRight");
  await vi.waitFor(() => {
    expect(camera().x).toBeGreaterThan(start.x);
  });
  key("ArrowDown");
  await vi.waitFor(() => {
    expect(camera().y).toBeGreaterThan(start.y);
  });
  const zoom = camera().zoom;
  key("+");
  await vi.waitFor(() => {
    expect(camera().zoom).toBeGreaterThan(zoom);
  });
  key("-");
  key("-");
  await vi.waitFor(() => {
    expect(camera().zoom).toBeLessThan(zoom);
  });
});

test("the wheel zooms around the pointer, keeping the tile under it fixed", async () => {
  await mountMap();
  await page.getByRole("button", { name: "1:1" }).click();
  const before = camera();
  const tile = screenToTile(before, 120, 90);
  wheel(120, 90, -100);
  await vi.waitFor(() => {
    expect(camera().zoom).toBeGreaterThan(1);
  });
  const after = camera();
  const same = screenToTile(after, 120, 90);
  expect(same.x).toBeCloseTo(tile.x, 6);
  expect(same.y).toBeCloseTo(tile.y, 6);
});

test("zoom stays within 1/8 and 16 pixels per tile", async () => {
  await mountMap();
  for (let i = 0; i < 60; i++) wheel(200, 150, -100);
  await vi.waitFor(() => {
    expect(camera().zoom).toBe(16);
  });
  for (let i = 0; i < 120; i++) wheel(200, 150, 100);
  await vi.waitFor(() => {
    expect(camera().zoom).toBe(0.125);
  });
});

test("Fit world shows the whole world; the status bar shows the tile under the pointer", async () => {
  await mountMap();
  await page.getByRole("button", { name: "Fit world" }).click();
  const fitted = camera();
  expect(fitted.zoom).toBeCloseTo(Math.max(0.125, Math.min(viewport.width / width, viewport.height / height)), 9);
  pointer("pointermove", 100, 80, 0);
  const tile = screenToTile(fitted, 100, 80);
  await expect.element(page.getByRole("status")).toMatchTextContent(`${String(Math.floor(tile.x))}, ${String(Math.floor(tile.y))}`);

  await page.getByRole("button", { name: "1:1" }).click();
  pointer("pointermove", 10, 20, 0);
  const actual = camera();
  const under = screenToTile(actual, 10, 20);
  await expect.element(page.getByRole("status")).toMatchTextContent(`${String(Math.floor(under.x))}, ${String(Math.floor(under.y))}`);
});

test("without WebGL2 the map shows an error message instead of throwing", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  await render(
    <div style={{ width: viewport.width, height: viewport.height }}>
      <MapView renderer="@studio/renderer" world={world} />
    </div>,
  );
  await expect.element(page.getByRole("alert")).toMatchTextContent("WebGL2");
});
