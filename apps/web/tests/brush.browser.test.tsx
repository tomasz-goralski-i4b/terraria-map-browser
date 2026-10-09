import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { readWorldTiles } from "@studio/world-codec";
import { BRUSH_LAYER } from "@studio/world-model";
import type { Camera } from "@studio/renderer";
import { MapCanvas } from "../src/components/MapCanvas.js";
import { ToolOptions } from "../src/shell/ToolOptions.js";
import { InspectorPanel } from "../src/panels/InspectorPanel.js";
import { ContentPanel } from "../src/panels/ContentPanel.js";
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
  await page.getByRole("button", { name: "Placement preview", exact: true }).click();
  await expect.poll(() => footprint?.hidden).toBe(true);
  act(() => { pointer("pointerdown", 10, 10); pointer("pointerup", 10, 10, 0); });
  expect(view.tileAt(8, 8).block).toBeUndefined();
  expect(view.tileAt(8, 10).block).toEqual({ kind: "vanilla", id: 1 });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const smoothing = page.getByRole("slider", { name: "Brush smoothing", exact: true }).element();
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
  act(() => { pointer("pointerdown", 4, 12); pointer("pointermove", 20, 12); window.dispatchEvent(new Event("blur")); });
  await new Promise<void>((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
  for (let x = 4; x <= 20; x++) expect(view.tileAt(x, 12).block).toBeUndefined();
  expect(useBrushStore.getState().active).toBe(false);
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
  // A chord emits moves with changed buttons, not another pointerdown/up for each button.
  act(() => {
    useBrushStore.setState({ smoothing: 0 });
    pointer("pointerdown", 4, 14, 1);
    pointer("pointermove", 5, 14, 3, 2);
    pointer("pointermove", 6, 14, 2, 0);
    pointer("pointerup", 6, 14, 0, 2);
  });
  for (let x = 4; x <= 6; x++) expect(view.tileAt(x, 14).block).toBeUndefined();
  expect(useBrushStore.getState().active).toBe(false);
});

test("Both offers independent materials, paints/erases one footprint and previews its exact clipped size", async () => {
  const world = readWorldTiles(brushSource(64, 16, Array.from({ length: 64 }, () => [0x40, 15]).flat()));
  const view = canonicalWorldOf(world);
  setBrushWorld(world);
  useAppStore.setState({ phase: "loaded", unsavedChanges: false });
  useBrushStore.setState({ layer: BRUSH_LAYER.block, blockId: 1, wallId: 1, size: 1, shape: "square", smoothing: 0, placementPreview: true });
  useViewStore.setState({ tool: "brush" });
  await render(<><Shortcuts /><ToolOptions /><div style={{ position: "relative", width: 128, height: 128 }}><MapCanvas world={toRenderableWorld(world)} /></div></>);
  const canvas = document.querySelector("canvas");
  if (canvas === null) throw new Error("World map canvas is missing");
  await expect.poll(() => canvas.dataset["camera"]).toBeDefined();
  getMapController()?.jumpTo({ x: 0, y: 0, zoom: 4 });
  await page.getByRole("group", { name: "Brush layer" }).getByRole("button", { name: "Both", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Both", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("combobox", { name: "Block material" }).selectOptions("38");
  await page.getByRole("combobox", { name: "Wall material" }).selectOptions("4");
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
    expect(view.tileAt(x, y).wall).toEqual({ kind: "vanilla", id: 4 });
  }
  expect(view.tileAt(12, 10).block).toBeUndefined();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(view.tileAt(10, 10).block).toBeUndefined();
  expect(view.tileAt(10, 10).wall).toBeUndefined();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  act(() => { useViewStore.getState().setTool("erase"); });
  await expect.element(page.getByRole("button", { name: "Both", exact: true })).toHaveAttribute("aria-pressed", "true");
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
  act(() => {
    pointer("pointerdown", 50, 3);
    pointer("pointercancel", 50, 3);
  });
  expect(view.tileAt(50, 3).block).toBeUndefined();
  act(() => { useViewStore.getState().setTool("erase"); });
  act(() => {
    pointer("pointerdown", 40, 3);
    pointer("pointerup", 40, 3);
  });
  expect(view.tileAt(40, 3).block).toBeUndefined();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(view.tileAt(40, 3).block).toEqual({ kind: "vanilla", id: 1 });
  await expect.element(page.getByLabelText("Brush size")).toHaveAttribute("max", "9");
  await expect.element(page.getByRole("group", { name: "Brush layer" }).getByRole("button", { name: "Both", exact: true })).toBeEnabled();
  act(() => { useViewStore.getState().setTool("brush"); });
  act(() => {
    pointer("pointerdown", 60, 3);
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
    pointer("pointermove", 80, 3);
  });
  expect(view.tileAt(60, 3).block).toBeUndefined();
  for (const end of ["lostpointercapture", "blur", "second touch"] as const) {
    act(() => {
      pointer("pointerdown", 90, 3);
      if (end === "blur") window.dispatchEvent(new Event("blur"));
      else if (end === "second touch") canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false, button: 0, bubbles: true }));
      else pointer(end, 90, 3);
    });
    expect(view.tileAt(90, 3).block).toBeUndefined();
    expect(useBrushStore.getState().active).toBe(false);
    canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 2, bubbles: true }));
  }
  act(() => { useAppStore.setState({ phase: "loading" }); });
  await expect.element(page.getByRole("button", { name: "Undo", exact: true })).toHaveAttribute("aria-disabled", "true");
  act(() => { useAppStore.setState({ phase: "loaded" }); useSaveStore.setState({ open: true }); });
  await expect.element(page.getByRole("button", { name: "Undo", exact: true })).toHaveAttribute("aria-disabled", "true");
  act(() => { useSaveStore.setState({ open: false }); });
  expect(view.tileAt(70, 3).block).toBeUndefined();
  expect(useBrushStore.getState().active).toBe(false);
  act(() => {
    pointer("pointerdown", 60, 3);
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    pointer("pointermove", 80, 3);
  });
  expect(view.tileAt(60, 3).block).toBeUndefined();
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
  act(() => {
    pointer("pointerdown", 60, 3);
    getMapController()?.fitWorld();
    pointer("pointermove", 80, 3);
  });
  expect(view.tileAt(60, 3).block).toBeUndefined();
});
