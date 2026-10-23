// @module-tag perf -- UI flows starve on shared CI runners; skipped in CI (docs/tooling.md).
import { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { createMapRenderer, screenToTile } from "@studio/renderer";
import type { Camera, MapRenderer, RenderableWorld } from "@studio/renderer";
import { MapCanvas } from "../src/components/MapCanvas.js";
import { useViewStore } from "../src/shell/view-store.js";

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

beforeEach(() => {
  time = 0;
  nextFrame = 0;
  frames = new Map();
  drawn = { x: 0, y: 0, zoom: 1 };
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
  renderer = {
    setWorld: vi.fn(), setCamera: vi.fn((camera: Camera) => { drawn = camera; }), setLayers: vi.fn(), setAtlas: vi.fn(),
    setSpriteMode: vi.fn(), setFraming: vi.fn(), invalidateTiles: vi.fn(), setGrid: vi.fn(), setAnnotations: vi.fn(), setHighlight: vi.fn(),
    tileAt: (x, y) => {
      const tile = screenToTile(drawn, x, y);
      return tile.x < 0 || tile.y < 0 || tile.x >= world.width || tile.y >= world.height
        ? null : { x: Math.floor(tile.x), y: Math.floor(tile.y) };
    },
    render: vi.fn(), flushFrame: vi.fn(), dispose: vi.fn(),
    stats: () => ({ textureUploads: 0, drawCalls: 0, visibleChunks: [], residentChunks: 0, evictedChunks: 0, atlasUploads: 0, framedTiles: 0, framedWalls: 0, spritesPreparing: false, reusedFrames: 0, highlightUploads: 0, highlightBuilding: false, objectUploads: 0, objectChunksCollected: 0 }),
  };
  vi.mocked(createMapRenderer).mockReturnValue(renderer);
});

afterEach(() => {
  window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
  useViewStore.setState({ tool: "pan", pinnedTile: null });
  vi.restoreAllMocks();
});

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
    await Promise.resolve();
  });
}

async function mount(onQuickMenu = vi.fn()): Promise<typeof onQuickMenu> {
  await render(<div style={{ position: "relative", width: 400, height: 300 }}><MapCanvas world={world} onQuickMenu={onQuickMenu} /></div>);
  await vi.waitFor(() => { expect(createMapRenderer).toHaveBeenCalled(); });
  await frame();
  canvas().parentElement?.querySelector<HTMLButtonElement>(".map-controls button:last-child")?.click();
  await frame(2000);
  vi.mocked(renderer.setCamera).mockClear();
  return onQuickMenu;
}

/** A mouse event on the canvas at a point inside it; `button` 2 is the right button. */
function pointer(type: string, x: number, y: number, button = 0): void {
  const rect = canvas().getBoundingClientRect();
  const held = button === 2 ? 2 : 1;
  const event = new PointerEvent(type, {
    pointerId: 1, pointerType: "mouse", bubbles: true, cancelable: true, button: type === "pointermove" ? -1 : button,
    clientX: rect.left + x, clientY: rect.top + y, buttons: type === "pointerup" ? 0 : held, isPrimary: true,
  });
  Object.defineProperty(event, "timeStamp", { value: time });
  canvas().dispatchEvent(event);
}

function space(type: "keydown" | "keyup"): void {
  window.dispatchEvent(new KeyboardEvent(type, { key: " ", code: "Space", bubbles: true, cancelable: true }));
}

test("a right click without a drag opens the quick menu at the pointer, with the tile under it", async () => {
  const onQuickMenu = await mount();
  pointer("pointerdown", 120, 90, 2);
  pointer("pointerup", 121, 90, 2);
  expect(onQuickMenu).toHaveBeenCalledOnce();
  const rect = canvas().getBoundingClientRect();
  const [at, tile] = onQuickMenu.mock.calls[0] as [{ x: number; y: number }, { x: number; y: number } | null];
  expect(at).toEqual({ x: rect.left + 121, y: rect.top + 90 });
  expect(tile).not.toBeNull();
});

test("a right drag still pans and opens no menu", async () => {
  const onQuickMenu = await mount();
  const before = { ...drawn };
  pointer("pointerdown", 200, 150, 2);
  for (let step = 1; step <= 10; step++) pointer("pointermove", 200 - step * 5, 150, 2);
  pointer("pointerup", 150, 150, 2);
  await frame(2000);
  expect(onQuickMenu).not.toHaveBeenCalled();
  expect(drawn.x).not.toBe(before.x);
});

test("a left click never opens the quick menu", async () => {
  const onQuickMenu = await mount();
  pointer("pointerdown", 120, 90);
  pointer("pointerup", 120, 90);
  expect(onQuickMenu).not.toHaveBeenCalled();
});

test("with Inspect a click pins the tile, but with Space held the same click only pans", async () => {
  await mount();
  useViewStore.setState({ tool: "inspect", pinnedTile: null });
  space("keydown");
  pointer("pointerdown", 120, 90);
  pointer("pointerup", 120, 90);
  expect(useViewStore.getState().pinnedTile).toBeNull();
  space("keyup");
  pointer("pointerdown", 120, 90);
  pointer("pointerup", 120, 90);
  expect(useViewStore.getState().pinnedTile).not.toBeNull();
});

test("Space + drag pans the map whatever the tool", async () => {
  await mount();
  useViewStore.setState({ tool: "inspect" });
  const before = { ...drawn };
  space("keydown");
  pointer("pointerdown", 200, 150);
  for (let step = 1; step <= 10; step++) pointer("pointermove", 200, 150 - step * 4);
  pointer("pointerup", 200, 110);
  await frame(2000);
  expect(drawn.y).not.toBe(before.y);
  expect(useViewStore.getState().pinnedTile).toBeNull();
});

test("Space typed in a text field neither pans nor is swallowed", async () => {
  await mount();
  const input = document.createElement("input");
  document.body.append(input);
  input.focus();
  const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  useViewStore.setState({ tool: "inspect" });
  pointer("pointerdown", 120, 90);
  pointer("pointerup", 120, 90);
  // Space did not count as held: the click pins as usual.
  expect(useViewStore.getState().pinnedTile).not.toBeNull();
  input.remove();
});
