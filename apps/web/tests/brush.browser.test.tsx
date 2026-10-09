import { act } from "react";
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { readWorldTiles } from "@studio/world-codec";
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

function Shortcuts(): null {
  useGlobalShortcuts(useCommands());
  return null;
}
afterEach(() => {
  setBrushWorld(null);
  useViewStore.setState({ tool: "pan" });
  useAppStore.setState({ phase: "idle", unsavedChanges: false });
});

test("pointer strokes update only their chunk; controls, keyboard history and cancellation preserve the world", async () => {
  const source = brushSource(384, 8, Array.from({ length: 384 }, () => [0x40, 7]).flat());
  const world = readWorldTiles(source);
  const view = canonicalWorldOf(world);
  view.setTile(300, 3, { block: { kind: "vanilla", id: 1 }, wall: { kind: "vanilla", id: 4 }, wires: 0, actuator: false });
  setBrushWorld(world);
  useAppStore.setState({ phase: "loaded", unsavedChanges: false });
  useBrushStore.setState({ layer: "block", blockId: 1, wallId: 4, size: 1 });
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
  const pointer = (type: string, x: number, y: number): void => {
    const camera = JSON.parse(canvas.dataset["camera"] ?? "null") as Camera;
    const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent(type, {
        pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1,
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
  await expect.element(page.getByRole("row").filter({ hasText: "Stone Block" }).getByRole("gridcell").nth(2)).toHaveTextContent(/^6$/);
  await expect.element(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })); });
  expect(view.tileAt(40, 3).block).toBeUndefined();
  expect(useAppStore.getState().unsavedChanges).toBe(false);
  await expect.poll(() => document.querySelector(".inspector-panel dl")?.textContent).not.toContain("Stone Block");
  await expect.element(page.getByRole("row").filter({ hasText: "Stone Block" }).getByRole("gridcell").nth(2)).toHaveTextContent(/^1$/);
  act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true })); });
  expect(view.tileAt(40, 3).block).toEqual({ kind: "vanilla", id: 1 });
  await expect.poll(() => document.querySelector(".inspector-panel dl")?.textContent).toContain("Stone Block");
  await expect.element(page.getByRole("row").filter({ hasText: "Stone Block" }).getByRole("gridcell").nth(2)).toHaveTextContent(/^6$/);
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
  await expect.element(page.getByLabelText("Brush layer")).toBeEnabled();
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
  await expect.element(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  act(() => { useAppStore.setState({ phase: "loaded" }); useSaveStore.setState({ open: true }); });
  await expect.element(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  act(() => { useSaveStore.setState({ open: false }); });
  expect(view.tileAt(70, 3).block).toBeUndefined();
  expect(useBrushStore.getState().active).toBe(false);
  act(() => {
    pointer("pointerdown", 60, 3);
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    pointer("pointermove", 80, 3);
  });
  expect(view.tileAt(60, 3).block).toBeUndefined();
  act(() => {
    pointer("pointerdown", 60, 3);
    getMapController()?.fitWorld();
    pointer("pointermove", 80, 3);
  });
  expect(view.tileAt(60, 3).block).toBeUndefined();
});
