import { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { screenToTile, terrariaMapPalette, visibleChunks } from "@studio/renderer";
import type { Camera, RenderableWorld } from "@studio/renderer";
import { MapView } from "../src/components/MapView.js";
import { StatusBar } from "../src/shell/StatusBar.js";
import { useAppStore } from "../src/store.js";
import { getDefaultWorldSession } from "../src/world/world-session.js";

const width = 1200;
const height = 600;
const viewport = { width: 400, height: 300 };

function syntheticWorld(): RenderableWorld {
  const count = width * height;
  const block = new Uint16Array(count).fill(0xffff);
  for (let i = 0; i < count; i += 3) block[i] = 0;
  return {
    width, height, surfaceY: 200,
    planes: {
      block, wall: new Uint16Array(count).fill(0xffff), liquid: new Uint8Array(count), liquidAmount: new Uint8Array(count),
      paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
    },
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

// Animation frames and the clock are driven by the tests: a CI runner with software GL delivers real frames too
// slowly and unevenly for a camera glide to settle within a polling timeout. The glide itself is covered with the
// same fake clock in camera-input.browser.test.tsx; here every assertion runs on a settled camera.
let time = 0;
let nextFrame = 0;
let frames = new Map<number, FrameRequestCallback>();

function installFrameClock(): void {
  time = 0;
  nextFrame = 0;
  frames = new Map();
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
}

/** Runs the animation frames requested so far, `ms` after the previous one. */
async function frame(ms = 16): Promise<void> {
  time += ms;
  const callbacks = [...frames.values()];
  frames.clear();
  await act(async () => {
    for (const callback of callbacks) callback(time);
    await Promise.resolve(); // Flush the frame's React updates before assertions.
  });
}

/** Runs frames until neither the camera nor the renderer requests another one: every glide has finished. */
async function settle(): Promise<void> {
  for (let i = 0; frames.size > 0; i++) {
    if (i === 500) throw new Error("the map keeps requesting animation frames");
    await frame(1000);
  }
}

async function mountMap(): Promise<void> {
  await render(
    <div style={{ width: viewport.width, height: viewport.height, position: "relative" }}>
      <MapView renderer="@studio/renderer" world={world} />
      <StatusBar world={null} />
    </div>,
  );
  await mapStarted();
}

/** Waits for the renderer, created a task after mounting, and draws its first settled frame. */
async function mapStarted(): Promise<void> {
  await vi.waitFor(() => {
    expect(frames.size).toBeGreaterThan(0);
  });
  await settle();
  expect(canvas().dataset["camera"]).toBeDefined();
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

function releaseKey(name: string): void {
  canvas().dispatchEvent(new KeyboardEvent("keyup", { key: name, bubbles: true }));
}

async function actualMap(): Promise<void> {
  await page.getByRole("button", { name: /^1:1$/ }).click();
  await settle();
  expect(camera().zoom).toBe(1);
}

function statusText(): string {
  return document.querySelector("[data-testid=cursor-tile]")?.textContent ?? "";
}

function tileText(cam: Camera, x: number, y: number): string {
  const tile = screenToTile(cam, x, y);
  return `${String(Math.floor(tile.x))}, ${String(Math.floor(tile.y))}`;
}

// Captured before any test overrides it; deleting an override would remove the property altogether.
const originalDevicePixelRatio = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");

function restoreDevicePixelRatio(): void {
  if (originalDevicePixelRatio === undefined) Reflect.deleteProperty(window, "devicePixelRatio");
  else Object.defineProperty(window, "devicePixelRatio", originalDevicePixelRatio);
}

beforeEach(() => {
  vi.restoreAllMocks();
  installFrameClock();
});
afterEach(() => {
  vi.restoreAllMocks();
});

test("the visible-chunk set follows the camera and equals the pure visibleChunks result", async () => {
  await mountMap();
  await actualMap();
  const cam = camera();
  expect(cam.zoom).toBe(1);
  expect(chunks()).toEqual(visibleChunks(cam, viewport, { width, height }).map((chunk: { x: number; y: number }) => [chunk.x, chunk.y]));
});

test("the map is drawn with the shipped Terraria map palette", async () => {
  await mountMap();
  expect(canvas().dataset["mapPalette"]).toBe(terrariaMapPalette.gameVersion);
});

test("dragging pans the map: content follows the pointer", async () => {
  await mountMap();
  await actualMap();
  const before = camera();
  pointer("pointerdown", 200, 150, 1);
  pointer("pointermove", 150, 120, 1);
  await frame();
  const after = camera();
  expect(after.x).toBeCloseTo(before.x + 50, 6);
  expect(after.y).toBeCloseTo(before.y + 30, 6);
  expect(after.zoom).toBe(1);
  pointer("pointerup", 150, 120, 0);
});

test("arrow keys pan and +/- zoom around the viewport", async () => {
  await mountMap();
  await actualMap();
  const start = camera();
  // A held arrow pans on every frame until it is released.
  key("ArrowRight");
  await frame();
  await frame();
  expect(camera().x).toBeGreaterThan(start.x);
  releaseKey("ArrowRight");
  await settle();
  key("ArrowDown");
  await frame();
  await frame();
  expect(camera().y).toBeGreaterThan(start.y);
  releaseKey("ArrowDown");
  await settle();
  const zoom = camera().zoom;
  key("+");
  await settle();
  expect(camera().zoom).toBeGreaterThan(zoom);
  key("-");
  key("-");
  await settle();
  expect(camera().zoom).toBeLessThan(zoom);
});

test("the wheel zooms around the pointer, keeping the tile under it fixed", async () => {
  await mountMap();
  await actualMap();
  const before = camera();
  const tile = screenToTile(before, 120, 90);
  wheel(120, 90, -100);
  await settle();
  expect(camera().zoom).toBeGreaterThan(1);
  const after = camera();
  const same = screenToTile(after, 120, 90);
  expect(same.x).toBeCloseTo(tile.x, 6);
  expect(same.y).toBeCloseTo(tile.y, 6);
});

test("zoom stays within 1/8 and 16 pixels per tile", async () => {
  await mountMap();
  for (let i = 0; i < 60; i++) wheel(200, 150, -100);
  await settle();
  expect(camera().zoom).toBe(16);
  for (let i = 0; i < 120; i++) wheel(200, 150, 100);
  await settle();
  expect(camera().zoom).toBe(0.125);
});

test("Fit world shows the whole world; the status bar shows the tile under the pointer", async () => {
  await mountMap();
  // Start away from the fitted view, so the button has to glide there.
  await actualMap();
  await page.getByRole("button", { name: "Fit world" }).click();
  await settle();
  const fitted = camera();
  expect(fitted.zoom).toBeCloseTo(Math.max(0.125, Math.min(viewport.width / width, viewport.height / height)), 9);
  pointer("pointermove", 100, 80, 0);
  await frame();
  expect(statusText()).toBe(tileText(fitted, 100, 80));

  await actualMap();
  pointer("pointermove", 10, 20, 0);
  await frame();
  expect(statusText()).toBe(tileText(camera(), 10, 20));
});

test("without WebGL2 the map shows an error message instead of throwing", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  await render(
    <div style={{ width: viewport.width, height: viewport.height }}>
      <MapView renderer="@studio/renderer" world={world} />
      <StatusBar world={null} />
    </div>,
  );
  await expect.element(page.getByRole("alert")).toMatchTextContent("WebGL2");
});

test("the status bar follows the tile under a resting pointer after keyboard pans", async () => {
  await mountMap();
  await actualMap();
  pointer("pointermove", 120, 90, 0);
  await frame();
  expect(statusText()).toBe(tileText(camera(), 120, 90));
  const before = statusText();
  key("ArrowRight");
  // A held arrow pans about 0.4 CSS pixels per millisecond: 100 ms cross more than one tile at 1:1.
  await frame(100);
  expect(statusText()).not.toBe(before);
  expect(statusText()).toBe(tileText(camera(), 120, 90));
});

test("the status bar follows the tile under a resting pointer after a wheel zoom elsewhere", { tags: ["perf"] }, async () => {
  await mountMap();
  await actualMap();
  pointer("pointermove", 120, 90, 0);
  await frame();
  expect(statusText()).toBe(tileText(camera(), 120, 90));
  // The wheel event carries its own position, but the resting pointer is the one the status bar reports.
  const before = statusText();
  wheel(300, 200, -300);
  await settle();
  expect(camera().zoom).toBeGreaterThan(1);
  expect(statusText()).not.toBe(before);
  expect(statusText()).toBe(tileText(camera(), 120, 90));
});

test("the status bar updates while dragging", async () => {
  await mountMap();
  await actualMap();
  // No earlier hover: the drag move itself must report the tile under the pointer.
  pointer("pointerdown", 200, 150, 1);
  pointer("pointermove", 150, 120, 1);
  await frame();
  expect(statusText()).toBe(tileText(camera(), 150, 120));
  pointer("pointerup", 150, 120, 0);
});

test("the status bar is cleared when the pointer leaves the canvas", async () => {
  await mountMap();
  pointer("pointermove", 120, 90, 0);
  await frame();
  expect(statusText()).not.toBe("—");
  pointer("pointerout", 120, 90, 0);
  await frame();
  expect(statusText()).toBe("—");
  key("ArrowRight");
  await frame(100);
  await frame(100);
  expect(statusText()).toBe("—");
});

test.each(["+", "-"])("the %s key zooms around the last pointer position", async (name) => {
  await mountMap();
  await actualMap();
  pointer("pointermove", 100, 70, 0);
  const before = camera();
  const tile = screenToTile(before, 100, 70);
  key(name);
  await settle();
  expect(camera().zoom).not.toBe(before.zoom);
  const same = screenToTile(camera(), 100, 70);
  expect(same.x).toBeCloseTo(tile.x, 6);
  expect(same.y).toBeCloseTo(tile.y, 6);
});

test("replacing the world refreshes the status bar for the resting pointer", async () => {
  const small: RenderableWorld = { ...syntheticWorld(), width: 600, height: 300 };
  const count = 600 * 300;
  const replacement: RenderableWorld = {
    ...small,
    planes: {
      block: new Uint16Array(count), wall: new Uint16Array(count), liquid: new Uint8Array(count), liquidAmount: new Uint8Array(count),
      paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
    },
  };
  const view = await render(
    <div style={{ width: viewport.width, height: viewport.height, position: "relative" }}>
      <MapView renderer="@studio/renderer" world={world} />
      <StatusBar world={null} />
    </div>,
  );
  await mapStarted();
  pointer("pointermove", 200, 150, 0);
  await frame();
  expect(statusText()).toBe(tileText(camera(), 200, 150));
  const old = statusText();
  await view.rerender(
    <div style={{ width: viewport.width, height: viewport.height, position: "relative" }}>
      <MapView renderer="@studio/renderer" world={replacement} />
      <StatusBar world={null} />
    </div>,
  );
  await settle();
  expect(statusText()).not.toBe(old);
  expect(statusText()).toBe(tileText(camera(), 200, 150));
});

test("a devicePixelRatio change at fixed CSS size resizes the backing store", async () => {
  await mountMap();
  const css = canvas().clientWidth;
  const ratio = window.devicePixelRatio;
  expect(canvas().width).toBe(Math.round(css * ratio));
  try {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: ratio * 2 });
    // Browsers report a ratio change (zoom, moving between monitors) as a window resize.
    window.dispatchEvent(new Event("resize"));
    await settle();
    expect(canvas().width).toBe(Math.round(css * ratio * 2));
    expect(canvas().clientWidth).toBe(css);
  } finally {
    restoreDevicePixelRatio();
  }
});

/** Ratio of canvas backing pixels to CSS pixels, i.e. the devicePixelRatio the canvas was sized with. */
function backingScale(): number {
  return canvas().width / canvas().clientWidth;
}

async function doubleDevicePixelRatio(): Promise<void> {
  const css = canvas().clientWidth;
  const ratio = window.devicePixelRatio;
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: ratio * 2 });
  window.dispatchEvent(new Event("resize"));
  await settle();
  expect(canvas().width).toBe(Math.round(css * ratio * 2));
}

test("after a devicePixelRatio change the status bar reports the tile under the resting pointer", async () => {
  await mountMap();
  await actualMap();
  pointer("pointermove", 120, 90, 0);
  await frame();
  expect(statusText()).toBe(tileText(camera(), 120 * backingScale(), 90 * backingScale()));
  try {
    await doubleDevicePixelRatio();
    // The pointer has not moved: it still rests at CSS (120, 90), which is now twice as many backing pixels.
    expect(statusText()).toBe(tileText(camera(), 120 * backingScale(), 90 * backingScale()));
  } finally {
    restoreDevicePixelRatio();
  }
});

test("after a devicePixelRatio change keyboard zoom keeps the tile under the resting pointer fixed", async () => {
  await mountMap();
  await actualMap();
  pointer("pointermove", 100, 70, 0);
  try {
    await doubleDevicePixelRatio();
    const scale = backingScale();
    const before = camera();
    const tile = screenToTile(before, 100 * scale, 70 * scale);
    key("+");
    await settle();
    expect(camera().zoom).not.toBe(before.zoom);
    const same = screenToTile(camera(), 100 * scale, 70 * scale);
    expect(same.x).toBeCloseTo(tile.x, 6);
    expect(same.y).toBeCloseTo(tile.y, 6);
  } finally {
    restoreDevicePixelRatio();
  }
});

/** The element a real pointer would hit at the centre of `element`. */
function hitAtCentre(element: Element): Element | null {
  const rect = element.getBoundingClientRect();
  return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function resetLoadState(): void {
  useAppStore.setState({ phase: "idle", loadingFileName: null, error: null });
}

test("while another world loads over a drawn map, the loading message and Cancel stay on top of the canvas", async () => {
  try {
    await mountMap();
    useAppStore.getState().setLoading("replacement.wld");
    const cancel = page.getByRole("button", { name: "Cancel" });
    await expect.element(cancel).toBeInTheDocument();
    const button = cancel.element();
    expect(hitAtCentre(button)).toBe(button);
    const message = button.parentElement;
    if (message === null) throw new Error("Cancel has no message around it");
    expect(message.contains(hitAtCentre(message))).toBe(true);

    const cancelled = vi.spyOn(getDefaultWorldSession(), "cancel").mockImplementation(() => undefined);
    await cancel.click();
    expect(cancelled).toHaveBeenCalledOnce();
  } finally {
    resetLoadState();
  }
});

test("a failed replacement load shows its error on top of the drawn map", async () => {
  try {
    await mountMap();
    useAppStore.getState().setFailed({ code: "BadHeader", offset: 4, message: "Not a world file.", fileName: "broken.wld" });
    const alert = page.getByRole("alert");
    await expect.element(alert).toMatchTextContent("broken.wld");
    const element = alert.element();
    expect(element.contains(hitAtCentre(element))).toBe(true);
  } finally {
    resetLoadState();
  }
});
