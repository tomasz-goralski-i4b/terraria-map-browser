import { Profiler, act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { createMapRenderer, screenToTile } from "@studio/renderer";
import type { Camera, MapRenderer, RenderableWorld } from "@studio/renderer";
import { MapCanvas } from "../src/components/MapCanvas.js";

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
    setWorld: vi.fn(), setCamera: vi.fn((camera: Camera) => { drawn = camera; }), setLayers: vi.fn(),
    tileAt: (x, y) => {
      const tile = screenToTile(drawn, x, y);
      return tile.x < 0 || tile.y < 0 || tile.x >= world.width || tile.y >= world.height
        ? null : { x: Math.floor(tile.x), y: Math.floor(tile.y) };
    },
    render: vi.fn(), dispose: vi.fn(),
    stats: () => ({ textureUploads: 0, drawCalls: 0, visibleChunks: [], residentChunks: 0 }),
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
  await act(async () => { for (const callback of callbacks) callback(time); });
}

async function mount(reduce = false) {
  Object.defineProperty(media, "matches", { configurable: true, value: reduce });
  const view = await render(
    <Profiler id="world-map" onRender={() => { commits++; }}>
      <div style={{ position: "relative", width: 400, height: 300 }}><MapCanvas world={world} /></div>
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
