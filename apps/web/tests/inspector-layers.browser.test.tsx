import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { WIRE_LAYER, type RenderableWorld } from "@studio/renderer";
import { createWorld, type CanonicalWorld, type Tile } from "@studio/world-model";
import { MapView } from "../src/components/MapView.js";
import { InspectorPanel, type InspectorWorld } from "../src/panels/InspectorPanel.js";
import { LayersPanel } from "../src/panels/LayersPanel.js";
import { useCommands, useGlobalShortcuts } from "../src/shell/commands.js";
import { hydrateLayout } from "../src/shell/layout-store.js";
import { DEFAULT_MAP_LAYERS, getMapController, useViewStore } from "../src/shell/view-store.js";
import "../src/styles.css";

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

function pointer(type: string, x: number, y: number, buttons: number): void {
  const rect = canvas().getBoundingClientRect();
  canvas().dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, buttons, clientX: rect.left + x, clientY: rect.top + y,
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

test("with the Pan tool a click pins nothing", async () => {
  await mountMap(renderable(600, 300));
  pointer("pointerdown", 150, 150, 1);
  pointer("pointerup", 150, 150, 0);
  expect(useViewStore.getState().pinnedTile).toBeNull();
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

test("every layer row and wire colour toggles the renderer's layers without any texture upload", async () => {
  await render(<LayersHarness world={renderable(600, 300)} />);
  await vi.waitFor(() => {
    expect(getMapController()).not.toBeNull();
  });
  await expect.poll(() => getMapController()?.stats().visibleChunks.length ?? 0).toBeGreaterThan(0);
  const uploads = await settledUploads();

  for (const [label, key] of [["Background", "background"], ["Walls", "walls"], ["Blocks", "blocks"], ["Liquids", "liquids"]] as const) {
    await page.getByRole("button", { name: `Show ${label}`, exact: true }).click();
    await expect.poll(() => shownLayers()[key]).toBe(false);
    await expect.element(page.getByRole("button", { name: `Show ${label}`, exact: true })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: `Show ${label}`, exact: true }).click();
    await expect.poll(() => shownLayers()[key]).toBe(true);
  }
  await page.getByRole("button", { name: "Show Blue wire" }).click();
  await expect.poll(() => shownLayers()["wires"]).toBe(WIRE_LAYER.all & ~WIRE_LAYER.blue);
  await page.getByRole("button", { name: "Show Wires and actuators" }).click();
  await expect.poll(() => shownLayers()["wires"]).toBe(0);
  await page.getByRole("button", { name: "Show Wires and actuators" }).click();
  await expect.poll(() => shownLayers()["wires"]).toBe(WIRE_LAYER.all);

  expect(await settledUploads()).toBe(uploads);
  // A dozen clicks with renders between them: slow under the full suite on software GL.
}, 30_000);

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
