import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { readWorldTiles } from "@studio/world-codec";
import { BRUSH_LAYER } from "@studio/world-model";
import type { Camera } from "@studio/renderer";
import { MapCanvas } from "../src/components/MapCanvas.js";
import { ToolOptions as BrushToolOptions } from "../src/shell/ToolOptions.js";
import { TopBar } from "../src/shell/TopBar.js";
import { InspectorPanel } from "../src/panels/InspectorPanel.js";
import { ContentPanel } from "../src/panels/ContentPanel.js";
import { SwatchesPanel, useSwatchesView } from "../src/panels/SwatchesPanel.js";
import { hydratePalettes, usePaletteStore } from "../src/world/brush-palettes.js";
import { useCommands, useGlobalShortcuts } from "../src/shell/commands.js";
import { getMapController, useViewStore } from "../src/shell/view-store.js";
import { useAppStore } from "../src/store.js";
import { canonicalWorldOf } from "../src/world/canonical-world.js";
import { setBrushWorld, useBrushStore } from "../src/world/brush-session.js";
import { toRenderableWorld } from "../src/world/renderable-world.js";
import { useSaveStore } from "../src/world/save-world.js";
import { brushSource } from "./support/brush-source.js";
import "../src/styles.css";

function Shortcuts(): null {
  useGlobalShortcuts(useCommands());
  return null;
}
/** The tool options bar with the top bar above it, where Undo and Redo live. */
function ToolOptions(): React.JSX.Element {
  const commands = useCommands();
  return <><TopBar commands={commands} /><BrushToolOptions commands={commands} /></>;
}
function stoneCount(): string | undefined {
  const grid = page.getByRole("grid", { name: "Content", exact: true }).element();
  const column = [...grid.querySelectorAll("[role=columnheader]")].findIndex((header) => header.textContent.startsWith("Tiles"));
  const row = page.getByRole("row").filter({ hasText: "Stone Block" }).element();
  return row.querySelectorAll("[role=gridcell]")[column]?.textContent;
}
afterEach(() => {
  setBrushWorld(null);
  useViewStore.setState({ tool: "pan" });
  useAppStore.setState({ phase: "idle", unsavedChanges: false });
});

test("zoomed-out brush outline stays on the tile painted under the pointer", async () => {
  const world = readWorldTiles(brushSource(64, 32, Array.from({ length: 64 }, () => [0x40, 31]).flat()));
  const view = canonicalWorldOf(world);
  setBrushWorld(world);
  useBrushStore.setState({ layer: BRUSH_LAYER.block, blockId: 1, size: 1, shape: "square", smoothing: 0, placementPreview: true });
  useViewStore.setState({ tool: "brush" });
  await render(<div className="map-view" style={{ width: 128, height: 128 }}><MapCanvas world={toRenderableWorld(world)} /></div>);
  const canvas = document.querySelector("canvas");
  if (canvas === null) throw new Error("World map canvas is missing");
  await expect.poll(() => canvas.dataset["camera"]).toBeDefined();
  getMapController()?.jumpTo({ x: 0, y: 0, zoom: 0.25 });
  const camera = JSON.parse(canvas.dataset["camera"] ?? "null") as Camera;
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + (32.5 - camera.x) * camera.zoom * canvas.clientWidth / canvas.width;
  const clientY = rect.top + (16.5 - camera.y) * camera.zoom * canvas.clientHeight / canvas.height;
  const pointer = (type: string): void => {
    canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, isPrimary: true, button: 0, clientX, clientY }));
  };
  pointer("pointermove");
  const footprint = document.querySelector<HTMLElement>(".brush-footprint");
  await expect.poll(() => footprint?.hidden).toBe(false);
  const outline = footprint?.querySelector("svg")?.getBoundingClientRect();
  if (outline === undefined) throw new Error("Brush outline is missing");
  expect(outline.x + outline.width / 2).toBeCloseTo(clientX, 1);
  expect(outline.y + outline.height / 2).toBeCloseTo(clientY, 1);
  act(() => { pointer("pointerdown"); pointer("pointerup"); });
  expect(view.tileAt(32, 16).block).toEqual({ kind: "vanilla", id: 1 });
  expect(view.tileAt(32, 17).block).toBeUndefined();
});

test("round footprint and optional preview match painting; smoothing trails and flushes without a delayed cancelled stroke", async () => {
  const world = readWorldTiles(brushSource(64, 32, Array.from({ length: 64 }, () => [0x40, 31]).flat()));
  const view = canonicalWorldOf(world);
  setBrushWorld(world);
  useAppStore.setState({ phase: "loaded", unsavedChanges: false });
  useBrushStore.setState({ layer: BRUSH_LAYER.block, blockId: 1, size: 5, shape: "square", smoothing: 0, placementPreview: true });
  useViewStore.setState({ tool: "brush" });
  await render(<><ToolOptions /><div style={{ position: "relative", width: 256, height: 256 }}><MapCanvas world={toRenderableWorld(world)} /></div></>);
  const canvas = document.querySelector("canvas");
  if (canvas === null) throw new Error("World map canvas is missing");
  await expect.poll(() => canvas.dataset["camera"]).toBeDefined();
  getMapController()?.jumpTo({ x: 0, y: 0, zoom: 8 });
  const pointer = (type: string, x: number, y: number, buttons = 1, button = 0): void => {
    const camera = JSON.parse(canvas.dataset["camera"] ?? "null") as Camera;
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 7, pointerType: "mouse", isPrimary: true, button, buttons, bubbles: true,
      clientX: rect.left + (x + 0.5 - camera.x) * camera.zoom * canvas.clientWidth / canvas.width,
      clientY: rect.top + (y + 0.5 - camera.y) * camera.zoom * canvas.clientHeight / canvas.height,
    }));
  };
  await page.getByRole("button", { name: "Round brush", exact: true }).click();
  pointer("pointermove", 10, 10, 0);
  const footprint = document.querySelector<HTMLElement>(".brush-footprint");
  await expect.poll(() => footprint?.querySelector("path")?.getAttribute("d")?.match(/M/g)?.length).toBe(21);
  act(() => { useBrushStore.setState({ size: 3 }); });
  await expect.poll(() => footprint?.querySelector("path")?.getAttribute("d")?.match(/M/g)?.length).toBe(5);
  await page.getByRole("button", { name: "Brush outline", exact: true }).click();
  await expect.poll(() => footprint?.hidden).toBe(true);
  act(() => { pointer("pointerdown", 10, 10); pointer("pointerup", 10, 10, 0); });
  expect(view.tileAt(9, 9).block).toBeUndefined();
  expect(view.tileAt(9, 10).block).toEqual({ kind: "vanilla", id: 1 });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const smoothing = page.getByRole("slider", { name: "Brush stabilizer", exact: true }).element();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(smoothing, "100");
    smoothing.dispatchEvent(new Event("input", { bubbles: true }));
    useBrushStore.setState({ size: 1 });
    pointer("pointerdown", 4, 10);
    pointer("pointermove", 20, 10);
  });
  expect(useBrushStore.getState().smoothing).toBe(100);
  expect(view.tileAt(4, 10).block).toEqual({ kind: "vanilla", id: 1 });
  expect(view.tileAt(20, 10).block).toBeUndefined();
  await expect.poll(() => view.tileAt(5, 10).block).toEqual({ kind: "vanilla", id: 1 });
  act(() => { pointer("pointerup", 20, 10, 0); });
  expect(view.tileAt(20, 10).block).toEqual({ kind: "vanilla", id: 1 });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  for (let x = 4; x <= 20; x++) expect(view.tileAt(x, 10).block).toBeUndefined();
  // Losing focus keeps what was painted so far (one undo entry) and stops the trailing cursor.
  act(() => { pointer("pointerdown", 4, 12); pointer("pointermove", 20, 12); window.dispatchEvent(new Event("blur")); });
  await new Promise<void>((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
  expect(view.tileAt(4, 12).block).toEqual({ kind: "vanilla", id: 1 });
  for (let x = 6; x <= 20; x++) expect(view.tileAt(x, 12).block).toBeUndefined();
  expect(useBrushStore.getState().active).toBe(false);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(view.tileAt(4, 12).block).toBeUndefined();
  // Idle time must be integrated against the old target, before accepting a new target.
  let clock = performance.now();
  const timing = vi.spyOn(performance, "now").mockImplementation(() => clock);
  try {
    act(() => { pointer("pointerdown", 4, 16); });
    await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
    clock += 2000;
    act(() => { pointer("pointermove", 20, 16); });
    clock += 16;
    await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
    expect(view.tileAt(20, 16).block).toBeUndefined();
    expect(view.tileAt(4, 16).block).toEqual({ kind: "vanilla", id: 1 });
  } finally {
    timing.mockRestore();
    act(() => { window.dispatchEvent(new Event("blur")); });
  }
  // A chord emits moves with changed buttons, not another pointerdown/up for each button: the stroke ends there.
  act(() => {
    useBrushStore.setState({ smoothing: 0 });
    pointer("pointerdown", 4, 14, 1);
    pointer("pointermove", 5, 14, 3, 2);
    pointer("pointermove", 6, 14, 2, 0);
    pointer("pointerup", 6, 14, 0, 2);
  });
  expect(view.tileAt(4, 14).block).toEqual({ kind: "vanilla", id: 1 });
  for (let x = 5; x <= 6; x++) expect(view.tileAt(x, 14).block).toBeUndefined();
  expect(useBrushStore.getState().active).toBe(false);
});

test("Both takes its materials and paint from the swatches, paints/erases one footprint and previews its exact clipped size", async () => {
  const world = readWorldTiles(brushSource(64, 16, Array.from({ length: 64 }, () => [0x40, 15]).flat()));
  const view = canonicalWorldOf(world);
  setBrushWorld(world);
  useAppStore.setState({ phase: "loaded", unsavedChanges: false });
  useBrushStore.setState({ layer: BRUSH_LAYER.block, eraseLayers: { block: true, wall: false, liquid: false, wires: false }, blockId: 1, wallId: 1, size: 1, shape: "square", smoothing: 0, placementPreview: true });
  useViewStore.setState({ tool: "brush" });
  await render(<><Shortcuts /><ToolOptions /><SwatchesPanel /><div style={{ position: "relative", width: 128, height: 128 }}><MapCanvas world={toRenderableWorld(world)} /></div></>);
  const canvas = document.querySelector("canvas");
  if (canvas === null) throw new Error("World map canvas is missing");
  await expect.poll(() => canvas.dataset["camera"]).toBeDefined();
  getMapController()?.jumpTo({ x: 0, y: 0, zoom: 4 });
  await page.getByRole("group", { name: "Brush layer" }).getByRole("button", { name: "Both", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Both", exact: true })).toHaveAttribute("aria-pressed", "true");
  const swatches = page.getByRole("group", { name: "Swatches", exact: true });
  await page.getByRole("button", { name: /^Block material:/ }).click();
  await expect.element(page.getByRole("searchbox", { name: "Filter swatches" })).toHaveFocus();
  await swatches.getByRole("button", { name: "Gray Brick", exact: true }).click();
  await page.getByRole("button", { name: /^Wall material:/ }).click();
  await page.getByRole("searchbox", { name: "Filter swatches" }).fill("wood wall");
  await swatches.getByRole("button", { name: "Wood Wall", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Wall material: Wood Wall", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Block paint: No paint", exact: true }).click();
  await page.getByRole("button", { name: "Red Paint", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Block material: Gray Brick · Red Paint", exact: true })).toBeVisible();
  const sizeSlider = page.getByRole("slider", { name: "Brush size", exact: true }).element();
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(sizeSlider, "3"); sizeSlider.dispatchEvent(new Event("input", { bubbles: true })); });
  const pointer = (type: string, x: number, y: number): void => {
    const camera = JSON.parse(canvas.dataset["camera"] ?? "null") as Camera;
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, isPrimary: true, button: 0, bubbles: true,
      clientX: rect.left + (x + 0.5 - camera.x) * camera.zoom * canvas.clientWidth / canvas.width,
      clientY: rect.top + (y + 0.5 - camera.y) * camera.zoom * canvas.clientHeight / canvas.height,
    }));
  };
  pointer("pointermove", 0, 0);
  const footprint = document.querySelector<HTMLElement>(".brush-footprint");
  await expect.poll(() => footprint?.hidden).toBe(false);
  expect(footprint?.style.width).toBe(`${String(8 * canvas.clientWidth / canvas.width)}px`);
  act(() => { pointer("pointerdown", 10, 10); pointer("pointerup", 10, 10); });
  for (let x = 9; x <= 11; x++) for (let y = 9; y <= 11; y++) {
    expect(view.tileAt(x, y).block).toEqual({ kind: "vanilla", id: 38 });
    expect(view.tileAt(x, y).paint).toBe(1);
    expect(view.tileAt(x, y).wall).toEqual({ kind: "vanilla", id: 4 });
    expect(view.tileAt(x, y).wallPaint).toBeUndefined();
  }
  expect(view.tileAt(12, 10).block).toBeUndefined();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(view.tileAt(10, 10).block).toBeUndefined();
  expect(view.tileAt(10, 10).wall).toBeUndefined();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  act(() => { useViewStore.getState().setTool("erase"); });
  // Erase has its own layer mask (Blocks by default): Walls is turned on beside it.
  const eraseLayers = page.getByRole("group", { name: "Erase layers" });
  await eraseLayers.getByRole("button", { name: "Walls", exact: true }).click();
  await expect.poll(() => useBrushStore.getState().eraseLayers).toMatchObject({ block: true, wall: true });
  act(() => { pointer("pointerdown", 10, 10); pointer("pointerup", 10, 10); });
  expect(view.tileAt(10, 10).block).toBeUndefined();
  expect(view.tileAt(10, 10).wall).toBeUndefined();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(view.tileAt(10, 10).block).toEqual({ kind: "vanilla", id: 38 });
  expect(view.tileAt(10, 10).wall).toEqual({ kind: "vanilla", id: 4 });
});

test("pointer strokes update only their chunk; controls, keyboard history and cancellation preserve the world", async () => {
  const source = brushSource(384, 8, Array.from({ length: 384 }, () => [0x40, 7]).flat());
  const world = readWorldTiles(source);
  const view = canonicalWorldOf(world);
  view.setTile(300, 3, { block: { kind: "vanilla", id: 1 }, wall: { kind: "vanilla", id: 4 }, wires: 0, actuator: false });
  setBrushWorld(world);
  useAppStore.setState({ phase: "loaded", unsavedChanges: false });
  useBrushStore.setState({ layer: "block", blockId: 1, wallId: 4, size: 1, shape: "square", smoothing: 0, placementPreview: true });
  useViewStore.setState({ tool: "brush" });
  useViewStore.setState({ pinnedTile: { x: 40, y: 3 } });
  await render(<><Shortcuts /><ToolOptions /><InspectorPanel world={view} /><ContentPanel world={world} /><div style={{ position: "relative", width: 384, height: 128 }}><MapCanvas world={toRenderableWorld(world)} /></div></>);
  await expect.element(page.getByRole("grid", { name: "Content", exact: true })).toBeVisible();
  const canvas = document.querySelector("canvas");
  if (canvas === null) throw new Error("World map canvas is missing");
  await expect.poll(() => canvas.dataset["camera"]).toBeDefined();
  getMapController()?.jumpTo({ x: 0, y: 0, zoom: 1 });
  getMapController()?.renderNow();
  const uploads = getMapController()?.stats().textureUploads ?? 0;
  const pointer = (type: string, x: number, y: number, button = 0): void => {
    const camera = JSON.parse(canvas.dataset["camera"] ?? "null") as Camera;
    const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent(type, {
        pointerId: 1, pointerType: "mouse", isPrimary: true, button, buttons: type === "pointerup" ? 0 : button === 2 ? 2 : 1,
        bubbles: true, clientX: rect.left + (x + 0.5 - camera.x) * camera.zoom * canvas.clientWidth / canvas.width,
        clientY: rect.top + (y + 0.5 - camera.y) * camera.zoom * canvas.clientHeight / canvas.height,
      }));
  };
  act(() => {
    pointer("pointerdown", 40, 3);
    pointer("pointermove", 44, 3);
  });
  getMapController()?.renderNow();
  const beforeCommit = getMapController()?.stats().textureUploads;
  act(() => { pointer("pointerup", 44, 3); });
  getMapController()?.renderNow();
  expect(getMapController()?.stats().textureUploads).toBe(beforeCommit);
  for (let x = 40; x <= 44; x++) expect(view.tileAt(x, 3).block).toEqual({ kind: "vanilla", id: 1 });
  expect(view.tileAt(45, 3).block).toBeUndefined();
  expect(useAppStore.getState().unsavedChanges).toBe(true);
  getMapController()?.renderNow();
  expect((getMapController()?.stats().textureUploads ?? 0) - uploads).toBe(1);
  await expect.poll(() => document.querySelector(".inspector-panel dl")?.textContent).toContain("Stone Block");
  await expect.poll(stoneCount).toBe("6");
  await expect.element(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })); });
  expect(view.tileAt(40, 3).block).toBeUndefined();
  expect(useAppStore.getState().unsavedChanges).toBe(false);
  await expect.poll(() => document.querySelector(".inspector-panel dl")?.textContent).not.toContain("Stone Block");
  await expect.poll(stoneCount).toBe("1");
  act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true })); });
  expect(view.tileAt(40, 3).block).toEqual({ kind: "vanilla", id: 1 });
  await expect.poll(() => document.querySelector(".inspector-panel dl")?.textContent).toContain("Stone Block");
  await expect.poll(stoneCount).toBe("6");
  // A cancelled pointer keeps its stroke: losing it to the browser is not the user taking it back.
  act(() => {
    pointer("pointerdown", 50, 3);
    pointer("pointercancel", 50, 3);
  });
  expect(view.tileAt(50, 3).block).toEqual({ kind: "vanilla", id: 1 });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(view.tileAt(50, 3).block).toBeUndefined();
  act(() => { useViewStore.getState().setTool("erase"); });
  act(() => {
    pointer("pointerdown", 40, 3);
    pointer("pointerup", 40, 3);
  });
  expect(view.tileAt(40, 3).block).toBeUndefined();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(view.tileAt(40, 3).block).toEqual({ kind: "vanilla", id: 1 });
  await expect.element(page.getByLabelText("Brush size", { exact: true })).toHaveAttribute("max", "64");
  await expect.element(page.getByRole("group", { name: "Erase layers" }).getByRole("button", { name: "Walls", exact: true })).not.toHaveAttribute("aria-disabled");
  act(() => { useViewStore.getState().setTool("brush"); });
  // The wheel zooms at the pointer: the stroke goes on through it.
  act(() => {
    pointer("pointerdown", 60, 3);
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
  });
  expect(useBrushStore.getState().active).toBe(true);
  act(() => { pointer("pointerup", 60, 3); });
  expect(view.tileAt(60, 3).block).toEqual({ kind: "vanilla", id: 1 });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  getMapController()?.jumpTo({ x: 0, y: 0, zoom: 1 });
  for (const end of ["lostpointercapture", "blur", "second touch"] as const) {
    act(() => {
      pointer("pointerdown", 90, 3);
      if (end === "blur") window.dispatchEvent(new Event("blur"));
      else if (end === "second touch") canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false, button: 0, bubbles: true }));
      else pointer(end, 90, 3);
    });
    expect(view.tileAt(90, 3).block).toEqual({ kind: "vanilla", id: 1 });
    expect(useBrushStore.getState().active).toBe(false);
    canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 2, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true }));
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(view.tileAt(90, 3).block).toBeUndefined();
  }
  act(() => { useAppStore.setState({ phase: "loading" }); });
  await expect.element(page.getByRole("button", { name: "Undo", exact: true })).toHaveAttribute("aria-disabled", "true");
  act(() => { useAppStore.setState({ phase: "loaded" }); useSaveStore.setState({ open: true }); });
  await expect.element(page.getByRole("button", { name: "Undo", exact: true })).toHaveAttribute("aria-disabled", "true");
  act(() => { useSaveStore.setState({ open: false }); });
  expect(useBrushStore.getState().active).toBe(false);
  // Keyboard panning and Fit world end the stroke and keep it; Escape takes it back.
  for (const end of ["arrow", "fit", "escape"] as const) {
    act(() => {
      pointer("pointerdown", 60, 3);
      if (end === "arrow") canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
      else if (end === "fit") getMapController()?.fitWorld();
      else canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      pointer("pointermove", 80, 3);
    });
    canvas.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
    expect(view.tileAt(80, 3).block).toBeUndefined();
    expect(useBrushStore.getState().active).toBe(false);
    if (end === "escape") expect(view.tileAt(60, 3).block).toBeUndefined();
    else {
      expect(view.tileAt(60, 3).block).toEqual({ kind: "vanilla", id: 1 });
      await page.getByRole("button", { name: "Undo", exact: true }).click();
    }
    getMapController()?.jumpTo({ x: 0, y: 0, zoom: 1 });
  }
  const context = new MouseEvent("contextmenu", { button: 2, bubbles: true, cancelable: true });
  canvas.dispatchEvent(context);
  expect(context.defaultPrevented).toBe(true);
  for (const tool of ["pan", "inspect", "brush", "erase"] as const) {
    act(() => { useViewStore.getState().setTool(tool); });
    getMapController()?.jumpTo({ x: 0, y: 0, zoom: 4 });
    const before = JSON.parse(canvas.dataset["camera"] ?? "null") as Camera;
    act(() => {
      pointer("pointerdown", 60, 3, 2);
      pointer("pointermove", 55, 3, 2);
      pointer("pointerup", 55, 3, 2);
    });
    await expect.poll(() => (JSON.parse(canvas.dataset["camera"] ?? "null") as Camera).x).not.toBe(before.x);
    expect(view.tileAt(60, 3).block).toBeUndefined();
    expect(useBrushStore.getState().active).toBe(false);
  }
});

test("artist gestures: Alt+click picks materials, Shift+click draws a straight line, [ and ] resize the brush", async () => {
  const world = readWorldTiles(brushSource(64, 16, Array.from({ length: 64 }, () => [0x40, 15]).flat()));
  const view = canonicalWorldOf(world);
  view.setTile(30, 8, { block: { kind: "vanilla", id: 39 }, paint: 5, wall: { kind: "vanilla", id: 16 }, wires: 0, actuator: false });
  setBrushWorld(world);
  useAppStore.setState({ phase: "loaded", unsavedChanges: false });
  useBrushStore.setState({ layer: "block", blockId: 1, wallId: 1, blockPaint: 0, wallPaint: 0, paintOnly: false, size: 1, shape: "square", smoothing: 0 });
  useViewStore.setState({ tool: "brush" });
  await render(<><Shortcuts /><ToolOptions /><div style={{ position: "relative", width: 256, height: 128 }}><MapCanvas world={toRenderableWorld(world)} /></div></>);
  const canvas = document.querySelector("canvas");
  if (canvas === null) throw new Error("World map canvas is missing");
  await expect.poll(() => canvas.dataset["camera"]).toBeDefined();
  getMapController()?.jumpTo({ x: 0, y: 0, zoom: 4 });
  const pointer = (type: string, x: number, y: number, modifiers: { altKey?: boolean; shiftKey?: boolean } = {}): void => {
    const camera = JSON.parse(canvas.dataset["camera"] ?? "null") as Camera;
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true, ...modifiers,
      clientX: rect.left + (x + 0.5 - camera.x) * camera.zoom * canvas.clientWidth / canvas.width,
      clientY: rect.top + (y + 0.5 - camera.y) * camera.zoom * canvas.clientHeight / canvas.height,
    }));
  };
  act(() => { pointer("pointerdown", 30, 8, { altKey: true }); pointer("pointerup", 30, 8); });
  expect(useBrushStore.getState()).toMatchObject({ blockId: 39, blockPaint: 5, wallId: 16, wallPaint: 0 });
  expect(useBrushStore.getState().canUndo).toBe(false);
  act(() => { pointer("pointerdown", 5, 3); pointer("pointerup", 5, 3); });
  act(() => { pointer("pointerdown", 15, 3, { shiftKey: true }); pointer("pointerup", 15, 3); });
  for (let x = 5; x <= 15; x++) expect(view.tileAt(x, 3)).toMatchObject({ block: { kind: "vanilla", id: 39 }, paint: 5 });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  for (let x = 6; x <= 15; x++) expect(view.tileAt(x, 3).block).toBeUndefined();
  expect(view.tileAt(5, 3).block).toEqual({ kind: "vanilla", id: 39 });
  const key = (name: string): void => { window.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })); };
  for (let i = 0; i < 8; i++) act(() => { key("]"); });
  expect(useBrushStore.getState().size).toBe(10);
  act(() => { key("["); key("["); });
  expect(useBrushStore.getState().size).toBe(7);
  for (let i = 0; i < 30; i++) act(() => { key("]"); });
  expect(useBrushStore.getState().size).toBe(64);
});

test("swatches go into custom palettes from their context menu and the + button, and come out again", async () => {
  const world = readWorldTiles(brushSource(16, 16, Array.from({ length: 16 }, () => [0x40, 15]).flat()));
  hydratePalettes(null);
  setBrushWorld(world);
  useAppStore.setState({ phase: "loaded", unsavedChanges: false });
  useBrushStore.setState({ layer: "block", blockId: 1, blockPaint: 0, wallId: 1, wallPaint: 0, paintOnly: false });
  useSwatchesView.setState({ category: "block", source: "all", query: "" });
  useViewStore.setState({ tool: "brush" });
  await render(<><ToolOptions /><SwatchesPanel /></>);
  const swatches = page.getByRole("group", { name: "Swatches", exact: true });
  await swatches.getByRole("button", { name: "Gray Brick", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "New palette with this swatch" }).click();
  const name = page.getByRole("textbox", { name: "Palette name" });
  await expect.element(name).toHaveFocus();
  await name.fill("Castle");
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("combobox", { name: "Swatch source" })).toHaveValue(usePaletteStore.getState().palettes[0]?.id);
  expect(usePaletteStore.getState().palettes).toMatchObject([{ name: "Castle", swatches: [{ layer: "block", id: 38, paint: 0 }] }]);
  await page.getByRole("combobox", { name: "Swatch source" }).selectOptions("all");
  await swatches.getByRole("button", { name: "Red Brick", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to “Castle”" }).click();
  await swatches.getByRole("button", { name: "Gray Brick", exact: true }).click({ button: "right" });
  await expect.element(page.getByRole("menuitem", { name: /Add to “Castle”/ })).toHaveAttribute("aria-disabled", "true");
  await userEvent.keyboard("{Escape}");
  await page.getByRole("button", { name: "Block paint: No paint", exact: true }).click();
  await page.getByRole("button", { name: "Blue Paint", exact: true }).click();
  await page.getByRole("button", { name: "Add current materials to a palette", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add to “Castle”" }).click();
  expect(usePaletteStore.getState().palettes[0]?.swatches).toEqual([
    { layer: "block", id: 38, paint: 0 }, { layer: "block", id: 39, paint: 0 }, { layer: "block", id: 1, paint: 9 },
  ]);
  await page.getByRole("combobox", { name: "Swatch source" }).selectOptions("Castle");
  await swatches.getByRole("button", { name: "Stone Block · Blue Paint", exact: true }).click();
  expect(useBrushStore.getState()).toMatchObject({ blockId: 1, blockPaint: 9 });
  await swatches.getByRole("button", { name: "Red Brick", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove from “Castle”" }).click();
  await expect.poll(() => usePaletteStore.getState().palettes[0]?.swatches.length).toBe(2);
});

test("zoomed-out brush outline stays on the tile painted under the pointer", async () => {
  const world = readWorldTiles(brushSource(64, 32, Array.from({ length: 64 }, () => [0x40, 31]).flat()));
  const view = canonicalWorldOf(world);
  setBrushWorld(world);
  useAppStore.setState({ phase: "loaded", unsavedChanges: false });
  useBrushStore.setState({ layer: BRUSH_LAYER.block, blockId: 1, size: 1, shape: "square", smoothing: 0, placementPreview: true });
  useViewStore.setState({ tool: "brush" });
  await render(<div className="map-view" style={{ width: 128, height: 128 }}><MapCanvas world={toRenderableWorld(world)} /></div>);
  const canvas = document.querySelector("canvas");
  if (canvas === null) throw new Error("World map canvas is missing");
  await expect.poll(() => canvas.dataset["camera"]).toBeDefined();
  getMapController()?.jumpTo({ x: 0, y: 0, zoom: 0.25 });
  const camera = JSON.parse(canvas.dataset["camera"] ?? "null") as Camera;
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + (32.5 - camera.x) * camera.zoom * canvas.clientWidth / canvas.width;
  const clientY = rect.top + (16.5 - camera.y) * camera.zoom * canvas.clientHeight / canvas.height;
  const pointer = (type: string): void => {
    canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, clientX, clientY }));
  };
  pointer("pointermove");
  const footprint = document.querySelector<HTMLElement>(".brush-footprint");
  await expect.poll(() => footprint?.hidden).toBe(false);
  // The outline is the svg inside the footprint box: its centre, not the box's, is what people see.
  const outline = footprint?.querySelector("svg")?.getBoundingClientRect();
  if (outline === undefined) throw new Error("Brush outline is missing");
  expect(outline.x + outline.width / 2).toBeCloseTo(clientX, 1);
  expect(outline.y + outline.height / 2).toBeCloseTo(clientY, 1);
  act(() => { pointer("pointerdown"); pointer("pointerup"); });
  expect(view.tileAt(32, 16).block).toEqual({ kind: "vanilla", id: 1 });
  expect(view.tileAt(32, 17).block).toBeUndefined();
});
