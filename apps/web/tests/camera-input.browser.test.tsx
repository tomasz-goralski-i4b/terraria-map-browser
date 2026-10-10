// @module-tag perf -- UI flows starve on shared CI runners; skipped in CI (docs/tooling.md).
import { Profiler, act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { createMapRenderer, fitWorld, screenToTile } from "@studio/renderer";
import type { Camera, MapRenderer, RenderableWorld } from "@studio/renderer";
import { setDefaultAssetSession, useAssetStore, type AssetSession, type AssetStatus } from "../src/assets/asset-session.js";
import { MapCanvas } from "../src/components/MapCanvas.js";
import { StatusBar } from "../src/shell/StatusBar.js";
import { getMapController } from "../src/shell/view-store.js";
import { getBlockFraming } from "../src/world/block-framing.js";

vi.mock("@studio/renderer", async (original) => {
  const module = await original<typeof import("@studio/renderer")>();
  return { ...module, createMapRenderer: vi.fn() };
});

const world: RenderableWorld = {
  width: 1200, height: 600, surfaceY: 200,
  planes: {
    block: new Uint16Array(720_000).fill(0xffff), wall: new Uint16Array(720_000).fill(0xffff),
    liquid: new Uint8Array(720_000), liquidAmount: new Uint8Array(720_000),
    paint: new Uint8Array(720_000), wallPaint: new Uint8Array(720_000),
  },
  palette: [{ kind: "vanilla", id: 0 }],
};

let time = 0;
let nextFrame = 0;
let drawn: Camera;
let frames: Map<number, FrameRequestCallback>;
let renderer: MapRenderer;
let commits = 0;
let media: MediaQueryList;

beforeEach(() => {
  time = 0;
  nextFrame = 0;
  commits = 0;
  frames = new Map();
  drawn = { x: 0, y: 0, zoom: 1 };
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
  media = window.matchMedia("(prefers-reduced-motion: reduce)");
  Object.defineProperty(media, "matches", { configurable: true, value: false });
  vi.spyOn(window, "matchMedia").mockReturnValue(media);
  renderer = {
    setWorld: vi.fn(), setCamera: vi.fn((camera: Camera) => { drawn = camera; }), setLayers: vi.fn(), setAtlas: vi.fn(),
    setSpriteMode: vi.fn(), setFraming: vi.fn(), invalidateTiles: vi.fn(),
    tileAt: (x, y) => {
      const tile = screenToTile(drawn, x, y);
      return tile.x < 0 || tile.y < 0 || tile.x >= world.width || tile.y >= world.height
        ? null : { x: Math.floor(tile.x), y: Math.floor(tile.y) };
    },
    render: vi.fn(), dispose: vi.fn(),
    stats: () => ({ textureUploads: 0, drawCalls: 0, visibleChunks: [], residentChunks: 0, evictedChunks: 0, atlasUploads: 0, framedTiles: 0, framedWalls: 0, spritesPreparing: false }),
  };
  vi.mocked(createMapRenderer).mockReturnValue(renderer);
});

afterEach(() => { vi.restoreAllMocks(); });

function canvas(): HTMLCanvasElement {
  const element = document.querySelector("canvas");
  if (element === null) throw new Error("World map canvas is missing");
  return element;
}

async function frame(ms = 16): Promise<void> {
  time += ms;
  const callbacks = [...frames.values()];
  frames.clear();
  await act(async () => {
    for (const callback of callbacks) callback(time);
    await Promise.resolve(); // Flush the frame's React updates and attribute observers before assertions.
  });
}

async function mount(reduce = false) {
  Object.defineProperty(media, "matches", { configurable: true, value: reduce });
  const view = await render(
    <Profiler id="world-map" onRender={() => { commits++; }}>
      <div style={{ position: "relative", width: 400, height: 300 }}><MapCanvas world={world} /></div>
      <StatusBar world={null} />
    </Profiler>,
  );
  await vi.waitFor(() => { expect(createMapRenderer).toHaveBeenCalled(); });
  await frame();
  canvas().parentElement?.querySelector<HTMLButtonElement>(".map-controls button:last-child")?.click();
  await frame(2000);
  expect(drawn.zoom).toBe(1);
  vi.mocked(renderer.setCamera).mockClear();
  return view;
}

function wheel(deltaY: number, deltaMode = 0, ctrlKey = false): void {
  const rect = canvas().getBoundingClientRect();
  canvas().dispatchEvent(new WheelEvent("wheel", {
    deltaY, deltaMode, ctrlKey, bubbles: true, cancelable: true, clientX: rect.left + 120, clientY: rect.top + 90,
  }));
}

function pointer(type: string, x: number, y: number): void {
  const rect = canvas().getBoundingClientRect();
  canvas().dispatchEvent(new PointerEvent(type, {
    pointerId: 1, pointerType: "mouse", bubbles: true, cancelable: true,
    clientX: rect.left + x, clientY: rect.top + y, buttons: type === "pointerup" ? 0 : 1,
  }));
}

function key(type: string, name: string, repeat = false): void {
  canvas().dispatchEvent(new KeyboardEvent(type, { key: name, repeat, bubbles: true, cancelable: true }));
}

test("twenty wheel events coalesce into one camera update and accumulate their zoom", async () => {
  await mount();
  const tile = screenToTile(drawn, 120, 90);
  for (let event = 0; event < 20; event++) wheel(-5);
  expect(renderer.setCamera).not.toHaveBeenCalled();
  await frame();
  expect(renderer.setCamera).toHaveBeenCalledOnce();
  expect(drawn.zoom).toBeGreaterThan(1);
  expect(drawn.zoom).toBeLessThan(Math.exp(100 * 0.0015));
  expect(screenToTile(drawn, 120, 90).x).toBeCloseTo(tile.x, 6);
  await frame(2000);
  expect(drawn.zoom).toBeCloseTo(Math.exp(100 * 0.0015), 9);
  expect(frames.size).toBe(0);
});

test.each([{ delta: -3, mode: 1, pixels: -48 }, { delta: -1, mode: 2, pixels: -300 }])(
  "wheel units $mode match their pixel equivalent", async ({ delta, mode, pixels }) => {
    await mount();
    wheel(delta, mode);
    await frame(2000);
    expect(drawn.zoom).toBeCloseTo(Math.exp(-pixels * 0.0015), 9);
  },
);

test("trackpad pinch is direct but coalesced", async () => {
  await mount();
  for (let event = 0; event < 20; event++) wheel(-1, 0, true);
  expect(renderer.setCamera).not.toHaveBeenCalled();
  await frame();
  expect(renderer.setCamera).toHaveBeenCalledOnce();
  expect(drawn.zoom).toBeCloseTo(Math.exp(0.2), 9);
  expect(frames.size).toBe(0);
});

test("sixty drag events write camera hooks once per frame and only commit for changed hover tiles", async () => {
  await mount();
  pointer("pointermove", 200, 150);
  await frame();
  const before = commits;
  const mutations: MutationRecord[] = [];
  const observer = new MutationObserver((records) => { mutations.push(...records); });
  observer.observe(canvas(), { attributes: true, attributeFilter: ["data-camera"] });
  try {
    pointer("pointerdown", 200, 150);
    for (let event = 1; event <= 60; event++) pointer("pointermove", 200 - event, 150);
    expect(renderer.setCamera).not.toHaveBeenCalled();
    expect(commits).toBe(before);
    await frame();
    expect(renderer.setCamera).toHaveBeenCalledOnce();
    expect(mutations).toHaveLength(1);
    expect(commits).toBe(before); // The cave tile follows the captured pointer during a drag.
    pointer("pointerup", 140, 150);
    pointer("pointermove", 160, 150);
    await frame();
    expect(commits).toBe(before + 1);
    for (let event = 0; event < 60; event++) pointer("pointermove", 160.1, 150.1);
    await frame();
    expect(commits).toBe(before + 1);
  } finally { observer.disconnect(); }
});

test("reduced motion applies wheel zoom in its first frame and suppresses flick inertia", async () => {
  await mount(true);
  wheel(-100);
  await frame();
  expect(drawn.zoom).toBeCloseTo(Math.exp(0.15), 9);
  pointer("pointerdown", 200, 150);
  time += 20;
  pointer("pointermove", 180, 150);
  await frame();
  pointer("pointerup", 180, 150);
  await frame();
  const stopped = drawn;
  await frame(100);
  expect(drawn).toEqual(stopped);
  expect(frames.size).toBe(0);
});

test.each(["pointer", "wheel", "key"])("%s input stops an active browser flick", async (input) => {
  await mount();
  pointer("pointerdown", 200, 150);
  time += 20;
  pointer("pointermove", 180, 150);
  await frame();
  pointer("pointerup", 180, 150);
  const released = drawn.x;
  await frame();
  expect(drawn.x).toBeGreaterThan(released);
  if (input === "pointer") pointer("pointerdown", 180, 150);
  if (input === "wheel") wheel(0);
  if (input === "key") key("keydown", "+");
  await frame(2000);
  const stopped = drawn;
  await frame(100);
  expect(drawn).toEqual(stopped);
});

test("held arrow keys pan every frame, ignore repeat and stop on keyup and blur", async () => {
  await mount();
  const start = drawn.x;
  key("keydown", "ArrowRight");
  await frame(100);
  const distance = drawn.x - start;
  expect(distance).toBeGreaterThan(0);
  await frame(100);
  expect(drawn.x - start).toBeCloseTo(distance * 2, 9);
  key("keydown", "ArrowRight", true);
  await frame(100);
  expect(drawn.x - start).toBeCloseTo(distance * 3, 9);
  key("keyup", "ArrowRight");
  await frame();
  const released = drawn;
  await frame(100);
  expect(drawn).toEqual(released);
  key("keydown", "ArrowRight");
  await frame(100);
  canvas().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  await frame();
  const blurred = drawn;
  await frame(100);
  expect(drawn).toEqual(blurred);
  expect(frames.size).toBe(0);
});

test("a live reduced-motion change finishes easing and unmount cancels pending frames", async () => {
  const view = await mount();
  wheel(-100);
  await frame();
  expect(drawn.zoom).toBeLessThan(Math.exp(0.15));
  Object.defineProperty(media, "matches", { configurable: true, value: true });
  media.dispatchEvent(new Event("change"));
  await frame();
  expect(drawn.zoom).toBeCloseTo(Math.exp(0.15), 9);
  wheel(-100);
  await view.unmount();
  expect(frames.size).toBe(0);
  expect(renderer.dispose).toHaveBeenCalledOnce();
});

test("zoomTo glides to 4 px per tile around the centre of the view", async () => {
  await mount();
  const centre = { x: canvas().width / 2, y: canvas().height / 2 };
  const tile = screenToTile(drawn, centre.x, centre.y);
  getMapController()?.zoomTo(4);
  await frame();
  expect(drawn.zoom).toBeGreaterThan(1);
  expect(drawn.zoom).toBeLessThan(4);
  await frame(2000);
  expect(drawn.zoom).toBe(4);
  expect(screenToTile(drawn, centre.x, centre.y).x).toBeCloseTo(tile.x, 6);
  expect(screenToTile(drawn, centre.x, centre.y).y).toBeCloseTo(tile.y, 6);
  expect(frames.size).toBe(0);
});

test("opening another world gives the renderer that world's fitted camera before the world itself", async () => {
  const view = await mount();
  // Wide and short: its fitted camera differs from the first world's and from the zoomed-in camera of mount().
  const other: RenderableWorld = { ...world, width: 4800, height: 600 };
  let cameraAtSetWorld: Camera | undefined;
  vi.mocked(renderer.setWorld).mockImplementation((next) => { if (next === other) cameraAtSetWorld = drawn; });
  await view.rerender(
    <Profiler id="world-map" onRender={() => { commits++; }}>
      <div style={{ position: "relative", width: 400, height: 300 }}><MapCanvas world={other} /></div>
      <StatusBar world={null} />
    </Profiler>,
  );
  expect(renderer.setWorld).toHaveBeenCalledWith(other);
  // The renderer's first frame of the new world must not use the previous world's camera: it would start building
  // around the wrong place.
  expect(cameraAtSetWorld).toEqual(fitWorld({ width: canvas().width, height: canvas().height }, other));
});

test("the map follows the connected atlas, and drops it when the assets are disconnected during a rebuild", async () => {
  const connected = { pages: [], index: { pageSize: 1, entries: [] } };
  let atlas: typeof connected | null = connected;
  setDefaultAssetSession({ getAtlas: () => atlas } as unknown as AssetSession);
  try {
    await mount();
    const ready: AssetStatus = { kind: "ready", folderName: "Images", tileSheets: 0, wallSheets: 0, pages: 0, fromCache: true, missing: [] };
    act(() => { useAssetStore.setState({ status: ready }); });
    expect(renderer.setAtlas).toHaveBeenLastCalledWith(connected);
    act(() => { useAssetStore.setState({ status: { kind: "building", folderName: "Images", progress: null } }); });
    // Disconnect: the session forgets the atlas and goes back to "none".
    atlas = null;
    act(() => { useAssetStore.setState({ status: { kind: "none" } }); });
    expect(renderer.setAtlas).toHaveBeenLastCalledWith(null);
  } finally {
    setDefaultAssetSession(undefined);
    useAssetStore.setState({ status: { kind: "none" } });
  }
});

test("the map hands the shipped block framing to the renderer once, for self-framed block sprites", async () => {
  await mount();
  await vi.waitFor(() => { expect(renderer.setFraming).toHaveBeenCalledTimes(1); });
  expect(renderer.setFraming).toHaveBeenCalledWith(await getBlockFraming());
});

test("panning and zooming the map read no asset files and rebuild no atlas", async () => {
  const atlas = { pages: [], index: { pageSize: 1, entries: [] } };
  const session = {
    getAtlas: vi.fn(() => atlas), connect: vi.fn(), connectFiles: vi.fn(), reconnect: vi.fn(), restore: vi.fn(),
    chooseFiles: vi.fn(), disconnect: vi.fn(),
  };
  setDefaultAssetSession(session as unknown as AssetSession);
  try {
    await mount();
    act(() => {
      useAssetStore.setState({ status: { kind: "ready", folderName: "Images", tileSheets: 1, wallSheets: 0, pages: 1, fromCache: true, missing: [] } });
    });
    for (let step = 0; step < 30; step++) {
      pointer("pointerdown", 120, 90);
      pointer("pointermove", 120 - step * 7, 90 + (step % 5));
      pointer("pointerup", 120 - step * 7, 90 + (step % 5));
      wheel(step % 2 === 0 ? -5 : 5);
      await frame();
    }
    for (const read of [session.connect, session.connectFiles, session.reconnect, session.restore, session.chooseFiles]) {
      expect(read).not.toHaveBeenCalled();
    }
    expect(vi.mocked(renderer.setAtlas).mock.calls.every(([given]) => given === atlas)).toBe(true);
  } finally {
    setDefaultAssetSession(undefined);
    useAssetStore.setState({ status: { kind: "none" } });
  }
});
