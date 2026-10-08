import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { WIRE_LAYER, renderChunk, terrariaMapPalette, type ChunkLayers, type RenderableWorld } from "@studio/renderer";
import { WorldWorkerClient } from "@studio/world-codec";
import { createWorld, type CanonicalWorld, type Tile } from "@studio/world-model";
import { App } from "../src/App.js";
import { MapView } from "../src/components/MapView.js";
import { InspectorPanel, type InspectorWorld } from "../src/panels/InspectorPanel.js";
import { LayersPanel } from "../src/panels/LayersPanel.js";
import { useCommands, useGlobalShortcuts } from "../src/shell/commands.js";
import { hydrateLayout } from "../src/shell/layout-store.js";
import { DEFAULT_MAP_LAYERS, getMapController, rendererLayers, useViewStore } from "../src/shell/view-store.js";
import { toCanonicalWorld } from "../src/world/canonical-world.js";
import { getDefaultWorldSession } from "../src/world/world-session.js";
import "../src/styles.css";
import "./support/commands.js";

beforeEach(async () => {
  hydrateLayout(null);
  await page.viewport(1280, 800);
});

afterEach(() => {
  useViewStore.setState({ hoverTile: null, pinnedTile: null, tool: "pan", layers: DEFAULT_MAP_LAYERS });
});

/** 4 × 3 world with one tile per interesting case, written column-major as the CWM contract requires. */
const TILES: readonly (readonly [number, number, Tile])[] = [
  [0, 0, { block: { kind: "vanilla", id: 1 }, wall: { kind: "vanilla", id: 2 }, frameX: 18, frameY: 36, paint: 3, wallPaint: 4, wires: 0b0101, actuator: true, inactive: true, shape: "half" }],
  [0, 1, { liquid: { kind: "water", amount: 0 }, wires: 0, actuator: false }],
  [1, 0, { wall: { kind: "unknown", runtimeId: 900 }, liquid: { kind: "lava", amount: 255 }, wires: 0b1000, actuator: false, invisibleWall: true, fullBrightWall: true }],
  [2, 2, { block: { kind: "vanilla", id: 5 }, wires: 0, actuator: false, shape: "slopeBottomLeft", invisibleBlock: true, fullBrightBlock: true }],
];

function canonicalWorld(): CanonicalWorld {
  const world = createWorld(4, 3);
  for (const [x, y, tile] of TILES) world.setTile(x, y, tile);
  return world;
}

function inspectorWorld(world: CanonicalWorld): InspectorWorld {
  return { width: world.width, height: world.height, tileAt: (x, y) => world.tileAt(x, y) };
}

function rows(): [string, string][] {
  return [...document.querySelectorAll(".inspector-panel .property-row")].map((row) => [
    row.querySelector("dt")?.textContent ?? "", row.querySelector("dd")?.textContent ?? "",
  ]);
}

test.each([
  [0, 0, [
    ["Position", "0, 0"], ["Block", "Block 1 (vanilla:1)"], ["Wall", "Wall 2 (vanilla:2)"], ["Frame X", "18"], ["Frame Y", "36"],
    ["Shape", "Half block"], ["Block paint", "3"], ["Wall paint", "4"], ["Liquid", "None"], ["Liquid amount", "None"],
    ["Wires", "Red, Green"], ["Actuator", "Yes"], ["Inactive", "Yes"], ["Invisible block", "No"], ["Invisible wall", "No"],
    ["Full-bright block", "No"], ["Full-bright wall", "No"],
  ]],
  [0, 1, [
    ["Position", "0, 1"], ["Block", "None"], ["Wall", "None"], ["Frame X", "None"], ["Frame Y", "None"], ["Shape", "None"],
    ["Block paint", "None"], ["Wall paint", "None"], ["Liquid", "Water"], ["Liquid amount", "0"], ["Wires", "None"],
    ["Actuator", "No"], ["Inactive", "No"], ["Invisible block", "No"], ["Invisible wall", "No"], ["Full-bright block", "No"],
    ["Full-bright wall", "No"],
  ]],
  [1, 0, [
    ["Position", "1, 0"], ["Block", "None"], ["Wall", "Unknown wall 900 (unknown:900)"], ["Frame X", "None"], ["Frame Y", "None"],
    ["Shape", "None"], ["Block paint", "None"], ["Wall paint", "None"], ["Liquid", "Lava"], ["Liquid amount", "255"],
    ["Wires", "Yellow"], ["Actuator", "No"], ["Inactive", "No"], ["Invisible block", "No"], ["Invisible wall", "Yes"],
    ["Full-bright block", "No"], ["Full-bright wall", "Yes"],
  ]],
  [2, 2, [
    ["Position", "2, 2"], ["Block", "Block 5 (vanilla:5)"], ["Wall", "None"], ["Frame X", "None"], ["Frame Y", "None"],
    ["Shape", "Slope, bottom left"], ["Block paint", "None"], ["Wall paint", "None"], ["Liquid", "None"], ["Liquid amount", "None"],
    ["Wires", "None"], ["Actuator", "No"], ["Inactive", "No"], ["Invisible block", "Yes"], ["Invisible wall", "No"],
    ["Full-bright block", "Yes"], ["Full-bright wall", "No"],
  ]],
] as const)("the pinned tile %i, %i shows exactly the fields of its tileAt view", async (x, y, expected) => {
  const world = canonicalWorld();
  // The fields shown are the tileAt view's own: absent keys read None, a present liquid with amount 0 reads 0.
  expect(world.tileAt(x, y)).toMatchObject(TILES.find(([tx, ty]) => tx === x && ty === y)?.[2] ?? {});
  await render(<InspectorPanel world={inspectorWorld(world)} />);
  useViewStore.getState().setPinnedTile({ x, y });
  await expect.element(page.getByText("Pinned")).toBeVisible();
  // Shy by default: only what the tile has (the keys of its view, set flags, wires when present).
  await expect.poll(rows).toEqual(expected.filter(([, shown]) => shown !== "None" && shown !== "No"));
  const showEmpty = page.getByRole("button", { name: "Show empty fields" });
  await expect.element(showEmpty).toHaveAttribute("aria-pressed", "false");
  await showEmpty.click();
  await expect.element(showEmpty).toHaveAttribute("aria-pressed", "true");
  await expect.poll(rows).toEqual(expected);
});

test("hovering previews a tile until one is pinned, and Unpin returns to the preview", async () => {
  await render(<InspectorPanel world={inspectorWorld(canonicalWorld())} />);
  useViewStore.getState().setHoverTile({ x: 1, y: 0 });
  await expect.poll(() => rows()[0]).toEqual(["Position", "1, 0"]);
  await expect.element(page.getByText("Hover preview")).toBeVisible();
  useViewStore.getState().setPinnedTile({ x: 2, y: 2 });
  useViewStore.getState().setHoverTile({ x: 0, y: 1 });
  await expect.poll(() => rows()[0]).toEqual(["Position", "2, 2"]);
  await page.getByRole("button", { name: "Unpin tile" }).click();
  await expect.poll(() => rows()[0]).toEqual(["Position", "0, 1"]);
});

// ---------- Clicking the map with the Inspect tool ----------

const MAP = { width: 400, height: 300 };

function renderable(width: number, height: number): RenderableWorld {
  const count = width * height;
  const block = new Uint16Array(count).fill(0xffff);
  for (let i = 0; i < count; i += 3) block[i] = 0;
  const flags = new Uint16Array(count);
  for (let i = 0; i < count; i += 5) flags[i] = WIRE_LAYER.red | WIRE_LAYER.actuator;
  return {
    width, height, surfaceY: 100,
    planes: {
      block, wall: new Uint16Array(count).fill(0xffff), liquid: new Uint8Array(count), liquidAmount: new Uint8Array(count),
      paint: new Uint8Array(count), wallPaint: new Uint8Array(count), flags,
    },
    palette: [{ kind: "vanilla", id: 0 }],
  };
}

function canvas(): HTMLCanvasElement {
  const element = document.querySelector("canvas");
  if (element === null) throw new Error("no canvas");
  return element;
}

function pointer(type: string, x: number, y: number, buttons: number, button = 0): void {
  const rect = canvas().getBoundingClientRect();
  canvas().dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button, buttons, clientX: rect.left + x, clientY: rect.top + y,
  }));
}

async function mountMap(world: RenderableWorld): Promise<void> {
  await render(
    <div style={{ position: "relative", width: MAP.width, height: MAP.height }}>
      <MapView renderer="@studio/renderer" world={world} />
    </div>,
  );
  await vi.waitFor(() => {
    expect(canvas().dataset["camera"]).toBeDefined();
    expect(getMapController()).not.toBeNull();
  });
}

function tileUnder(x: number, y: number): { x: number; y: number } {
  const camera = JSON.parse(canvas().dataset["camera"] ?? "null") as { x: number; y: number; zoom: number };
  const scale = canvas().width / canvas().clientWidth;
  return { x: Math.floor(camera.x + (x * scale) / camera.zoom), y: Math.floor(camera.y + (y * scale) / camera.zoom) };
}

test("with the Inspect tool a click pins the tile under it, a drag does not, and Enter pins the tile under the pointer", async () => {
  await mountMap(renderable(600, 300));
  useViewStore.getState().setTool("inspect");
  await expect.poll(() => canvas().dataset["tool"]).toBe("inspect");

  // The 600 × 300 world is fitted into 400 × 300: it fills rows 50–250 of the canvas.
  pointer("pointermove", 150, 150, 0);
  pointer("pointerdown", 150, 150, 1);
  pointer("pointerup", 151, 151, 0);
  const clicked = tileUnder(151, 151);
  await expect.poll(() => useViewStore.getState().pinnedTile).toEqual(clicked);

  useViewStore.getState().setPinnedTile(null);
  pointer("pointerdown", 150, 150, 1);
  pointer("pointermove", 190, 190, 1);
  pointer("pointerup", 190, 190, 0);
  expect(useViewStore.getState().pinnedTile).toBeNull();

  pointer("pointermove", 60, 120, 0);
  canvas().focus();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => useViewStore.getState().pinnedTile).toEqual(tileUnder(60, 120));
});

test("an out-and-back drag, a secondary click and a cancelled press pin nothing", async () => {
  await mountMap(renderable(600, 300));
  useViewStore.getState().setTool("inspect");
  await expect.poll(() => canvas().dataset["tool"]).toBe("inspect");

  // Out and back: the release lands where the press started, but the pointer left the click slop on the way.
  pointer("pointerdown", 150, 150, 1);
  pointer("pointermove", 250, 150, 1);
  pointer("pointermove", 150, 150, 1);
  pointer("pointerup", 150, 150, 0);
  expect(useViewStore.getState().pinnedTile).toBeNull();

  // Secondary (right) button.
  pointer("pointerdown", 150, 150, 2, 2);
  pointer("pointerup", 150, 150, 0, 2);
  expect(useViewStore.getState().pinnedTile).toBeNull();

  // A press the browser cancels (e.g. a touch turned into a scroll).
  pointer("pointerdown", 150, 150, 1);
  pointer("pointercancel", 150, 150, 0);
  expect(useViewStore.getState().pinnedTile).toBeNull();

  // A plain click still pins.
  pointer("pointerdown", 150, 150, 1);
  pointer("pointerup", 150, 150, 0);
  await expect.poll(() => useViewStore.getState().pinnedTile).toEqual(tileUnder(150, 150));
});

test("with the Pan tool a click pins nothing", async () => {
  await mountMap(renderable(600, 300));
  pointer("pointerdown", 150, 150, 1);
  pointer("pointerup", 150, 150, 0);
  expect(useViewStore.getState().pinnedTile).toBeNull();
});

test("a pin is cleared when another world replaces the shown one", async () => {
  const first = renderable(600, 300);
  const view = await render(
    <div style={{ position: "relative", width: MAP.width, height: MAP.height }}>
      <MapView renderer="@studio/renderer" world={first} />
    </div>,
  );
  await vi.waitFor(() => {
    expect(getMapController()).not.toBeNull();
  });
  useViewStore.getState().setPinnedTile({ x: 42, y: 150 });
  // Re-rendering the same world keeps the pin.
  await view.rerender(
    <div style={{ position: "relative", width: MAP.width, height: MAP.height }}>
      <MapView renderer="@studio/renderer" world={first} />
    </div>,
  );
  expect(useViewStore.getState().pinnedTile).toEqual({ x: 42, y: 150 });
  await view.rerender(
    <div style={{ position: "relative", width: MAP.width, height: MAP.height }}>
      <MapView renderer="@studio/renderer" world={renderable(300, 200)} />
    </div>,
  );
  await expect.poll(() => useViewStore.getState().pinnedTile).toBeNull();
});

// ---------- Layer toggles ----------

function LayersHarness({ world }: { readonly world: RenderableWorld }): React.JSX.Element {
  const commands = useCommands();
  useGlobalShortcuts(commands);
  return (
    <>
      <div style={{ position: "relative", width: MAP.width, height: MAP.height }}>
        <MapView renderer="@studio/renderer" world={world} />
      </div>
      <LayersPanel commands={commands} />
    </>
  );
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => { resolve(); }));

/** The upload count once the first streaming of chunks is over (unchanged across several frames). */
async function settledUploads(): Promise<number> {
  let last = -1;
  let stable = 0;
  while (stable < 8) {
    await nextFrame();
    const uploads = getMapController()?.stats().textureUploads ?? 0;
    stable = uploads === last ? stable + 1 : 0;
    last = uploads;
  }
  return last;
}

function shownLayers(): Record<string, unknown> {
  return JSON.parse(canvas().dataset["layers"] ?? "{}") as Record<string, unknown>;
}

test("hiding and showing the wires group restores the wire colours chosen inside it", async () => {
  await render(<LayersHarness world={renderable(600, 300)} />);
  await vi.waitFor(() => {
    expect(getMapController()).not.toBeNull();
  });
  await page.getByRole("button", { name: "Show Blue wire" }).click();
  await expect.poll(() => shownLayers()["wires"]).toBe(WIRE_LAYER.all & ~WIRE_LAYER.blue);
  await page.getByRole("button", { name: "Show Wires and actuators" }).click();
  await expect.poll(() => shownLayers()["wires"]).toBe(0);
  // The child eyes keep their state while the group is hidden.
  await expect.element(page.getByRole("button", { name: "Show Blue wire" })).toHaveAttribute("aria-pressed", "false");
  await expect.element(page.getByRole("button", { name: "Show Red wire" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Show Wires and actuators" }).click();
  await expect.poll(() => shownLayers()["wires"]).toBe(WIRE_LAYER.all & ~WIRE_LAYER.blue);
});

test("Alt+1 … Alt+5 toggle the layers", async () => {
  await render(<LayersHarness world={renderable(600, 300)} />);
  await vi.waitFor(() => {
    expect(getMapController()).not.toBeNull();
  });
  for (const [digit, key] of [["1", "background"], ["2", "walls"], ["3", "blocks"], ["4", "liquids"]] as const) {
    await userEvent.keyboard(`{Alt>}${digit}{/Alt}`);
    await expect.poll(() => shownLayers()[key]).toBe(false);
  }
  await userEvent.keyboard("{Alt>}5{/Alt}");
  await expect.poll(() => shownLayers()["wires"]).toBe(0);
});

// ---------- The real session: every row, pixels against the CPU reference ----------

async function openFixture(file: string): Promise<void> {
  const binary = atob(await commands.readWorldFixture(file));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("no file input in the app");
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], file));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** The canvas as renderChunk lays out pixels: top-down rows of straight RGBA. */
function readCanvas(): Uint8Array {
  const element = canvas();
  const gl = element.getContext("webgl2");
  if (gl === null) throw new Error("no webgl2 context");
  const out = new Uint8Array(element.width * element.height * 4);
  gl.readPixels(0, 0, element.width, element.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
  const flipped = new Uint8Array(out.length);
  const row = element.width * 4;
  for (let y = 0; y < element.height; y++) flipped.set(out.subarray((element.height - 1 - y) * row, (element.height - y) * row), y * row);
  return flipped;
}

/** The CPU reference of the canvas at 1 pixel per tile with the camera's top-left tile at (left, top). */
function cpuView(world: CanonicalWorld, depth: { surfaceY: number; rockY: number }, left: number, top: number, width: number, height: number, layers: ChunkLayers): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let cy = Math.floor(top / 128); cy <= Math.floor((top + height - 1) / 128); cy++) {
    for (let cx = Math.floor(left / 128); cx <= Math.floor((left + width - 1) / 128); cx++) {
      const chunk = renderChunk(world, cx, cy, { ...depth, layers, mapPalette: terrariaMapPalette });
      for (let y = 0; y < chunk.height; y++) {
        const worldY = cy * 128 + y;
        if (worldY < top || worldY >= top + height) continue;
        for (let x = 0; x < chunk.width; x++) {
          const worldX = cx * 128 + x;
          if (worldX < left || worldX >= left + width) continue;
          out.set(chunk.pixels.subarray((y * chunk.width + x) * 4, (y * chunk.width + x) * 4 + 4), ((worldY - top) * width + worldX - left) * 4);
        }
      }
    }
  }
  return out;
}

test("in a loaded world every layer and wire row removes and restores exactly its pixels, uploading and parsing nothing", async () => {
  await render(<App layoutStorage={null} />);
  const parse = vi.spyOn(WorldWorkerClient.prototype, "parse");
  await openFixture("SCCO1.wld");
  // Generous waits: the parse and the renderer's first frames are slow on software GL under the full suite.
  const slow = { timeout: 20_000 };
  await vi.waitFor(() => {
    expect(getMapController()).not.toBeNull();
  }, slow);
  await expect.poll(() => parse.mock.calls.length, slow).toBe(1);
  const loaded = getDefaultWorldSession().getLoadedWorld();
  if (loaded === null) throw new Error("no world loaded");
  const world = toCanonicalWorld(loaded);
  const depth = { surfaceY: loaded.metadata.surfaceLevel, rockY: loaded.metadata.rockLevel };
  // A view across the surface of the Small fixture, at 1 pixel per tile.
  const target = { x: 1900, y: Math.floor(loaded.metadata.surfaceLevel) - 100, zoom: 1 };
  // The map fits the new world once it has a viewport; jump after that, so the fit does not replace the jump.
  await vi.waitFor(() => {
    getMapController()?.jumpTo(target);
    expect(JSON.parse(canvas().dataset["camera"] ?? "null")).toEqual(target);
  }, slow);
  const uploads = await settledUploads();
  // The camera as applied (clamped to the world); integral, so pixels map to whole tiles.
  const camera = JSON.parse(canvas().dataset["camera"] ?? "null") as { x: number; y: number; zoom: number };
  expect(camera).toEqual(target);
  const { width, height } = canvas();

  const expectLayers = async (): Promise<void> => {
    const layers = rendererLayers(useViewStore.getState().layers);
    await expect.poll(() => shownLayers()).toEqual(layers);
    getMapController()?.renderNow();
    const gpu = readCanvas();
    const cpu = cpuView(world, depth, camera.x, camera.y, width, height, layers);
    expect(gpu.length).toBe(cpu.length);
    const first = gpu.findIndex((value, index) => value !== cpu[index]);
    expect(first === -1 ? "equal" : `pixel ${String(Math.floor(first / 4))} (x ${String(Math.floor(first / 4) % width)}, y ${String(Math.floor(first / 4 / width))}): gpu ${String([...gpu.subarray(first - (first % 4), first - (first % 4) + 4)])} cpu ${String([...cpu.subarray(first - (first % 4), first - (first % 4) + 4)])}`).toBe("equal");
  };

  await expectLayers();
  const rows = ["Background", "Walls", "Blocks", "Liquids", "Wires and actuators", "Red wire", "Blue wire", "Green wire", "Yellow wire", "Actuators"];
  for (const row of rows) {
    const eye = page.getByRole("button", { name: `Show ${row}`, exact: true });
    await eye.click();
    await expect.element(eye).toHaveAttribute("aria-pressed", "false");
    await expectLayers();
    await eye.click();
    await expect.element(eye).toHaveAttribute("aria-pressed", "true");
    await expectLayers();
  }
  expect(await settledUploads()).toBe(uploads);
  expect(parse).toHaveBeenCalledTimes(1);
  expect(getDefaultWorldSession().getLoadedWorld()).toBe(loaded);
}, 120_000);
