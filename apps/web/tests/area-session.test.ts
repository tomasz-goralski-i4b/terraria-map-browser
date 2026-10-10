import { afterEach, beforeEach, expect, test } from "vitest";
import { readWorldTiles } from "@studio/world-codec";
import { useAppStore } from "../src/store.js";
import { useViewStore } from "../src/shell/view-store.js";
import { setBrushWorld, beginBrush, useBrushStore } from "../src/world/brush-session.js";
import { useSaveStore } from "../src/world/save-world.js";
import { canonicalWorldOf } from "../src/world/canonical-world.js";
import { cancelArea, copySelection, movePaste, pastePreview, placePaste, selectArea, setAreaWorld, startPaste, useAreaStore } from "../src/world/area-session.js";
import { DEFAULT_COPY_LAYERS, DEFAULT_PASTE_OPTIONS } from "../src/world/area-clipboard.js";
import { brushSource } from "./support/brush-source.js";

function meadow() {
  const world = readWorldTiles(brushSource(8, 8, Array.from({ length: 8 }, () => [0x40, 7]).flat()));
  canonicalWorldOf(world).setTile(2, 2, { block: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  return world;
}
beforeEach(() => {
  useSaveStore.setState({ open: false }); useAppStore.setState({ phase: "loaded", unsavedChanges: false });
  useViewStore.setState({ tool: "select", hoverTile: null });
  useAreaStore.setState({ layers: DEFAULT_COPY_LAYERS, options: DEFAULT_PASTE_OPTIONS });
});
afterEach(() => { setAreaWorld(null); setBrushWorld(null); useSaveStore.setState({ open: false }); });

test("reverse selection clamps at world boundaries and empty clipboard does nothing", () => {
  const world = meadow(); setBrushWorld(world); setAreaWorld(world);
  startPaste(); expect(useAreaStore.getState().pasting).toBe(false);
  selectArea({ x: 6, y: 5 }, { x: -3, y: -2 });
  expect(useAreaStore.getState().selection).toEqual({ x: 0, y: 0, width: 7, height: 6 });
  selectArea({ x: 2, y: 2 }, { x: 40, y: 100 });
  expect(useAreaStore.getState().selection).toEqual({ x: 2, y: 2, width: 6, height: 6 });
});

test("preview cancellation and changing tools mutate nothing; recopy reflects the new mask", () => {
  const world = meadow(); const view = canonicalWorldOf(world); setBrushWorld(world); setAreaWorld(world);
  selectArea({ x: 2, y: 2 }, { x: 2, y: 2 }); copySelection(); startPaste(); movePaste({ x: 5, y: 5 });
  expect(pastePreview().length).toBeGreaterThan(0);
  expect(view.tileAt(5, 5).block).toBeUndefined(); expect(useAppStore.getState().unsavedChanges).toBe(false);
  cancelArea(); expect(view.tileAt(5, 5).block).toBeUndefined();
  startPaste(); movePaste({ x: 5, y: 5 }); useViewStore.getState().setTool("pan");
  expect(useAreaStore.getState().pasting).toBe(false);
  useAreaStore.setState({ layers: { ...DEFAULT_COPY_LAYERS, blocks: false, objects: false } });
  selectArea({ x: 2, y: 2 }, { x: 2, y: 2 }); copySelection(); startPaste(); movePaste({ x: 5, y: 5 }); placePaste();
  expect(view.tileAt(5, 5).block).toBeUndefined(); expect(useBrushStore.getState().canUndo).toBe(false);
});

test("loading and export prevent selection, copying, preview mutation and placement", () => {
  for (const lock of ["loading", "export"] as const) {
    useAppStore.setState({ unsavedChanges: false });
    const world = meadow(); setBrushWorld(world); setAreaWorld(world);
    selectArea({ x: 2, y: 2 }, { x: 2, y: 2 }); copySelection(); startPaste(); movePaste({ x: 5, y: 5 });
    useAppStore.setState({ phase: lock === "loading" ? "loading" : "loaded" }); useSaveStore.setState({ open: lock === "export" });
    selectArea({ x: 1, y: 1 }, { x: 7, y: 7 }); copySelection(); placePaste();
    expect(useAreaStore.getState().selection).toEqual({ x: 2, y: 2, width: 1, height: 1 });
    expect(canonicalWorldOf(world).tileAt(5, 5).block).toBeUndefined(); expect(useAppStore.getState().unsavedChanges).toBe(false);
    useAppStore.setState({ phase: "loaded" }); useSaveStore.setState({ open: false });
    placePaste(); expect(canonicalWorldOf(world).tileAt(5, 5).block).toEqual({ kind: "vanilla", id: 1 });
  }
});

test("world replacement and closing clear selection and clipboard; opening paste first commits a brush stroke", () => {
  const world = meadow(); setBrushWorld(world); setAreaWorld(world);
  selectArea({ x: 2, y: 2 }, { x: 2, y: 2 }); copySelection();
  expect(beginBrush(false)).toBe(true); startPaste(); expect(useBrushStore.getState().active).toBe(false);
  setAreaWorld(meadow()); expect(useAreaStore.getState()).toMatchObject({ selection: null, hasClipboard: false, pasting: false });
  setAreaWorld(null); startPaste(); expect(useAreaStore.getState().pasting).toBe(false);
});

test("maximum clipboard planning yields, cancels stale work and only places completed current previews", async () => {
  const world = readWorldTiles(brushSource(1024, 512, Array.from({ length: 1024 }, () => [0x80, 0xff, 1]).flat()));
  canonicalWorldOf(world).setTile(0, 0, { block: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  setBrushWorld(world); setAreaWorld(world);
  selectArea({ x: 0, y: 0 }, { x: 511, y: 511 }); copySelection(); startPaste();
  movePaste({ x: 512, y: 0 }); placePaste();
  expect(useAreaStore.getState().canPlace).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(useAreaStore.getState().canPlace).toBe(false);
  cancelArea();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(useAreaStore.getState()).toMatchObject({ pasting: false, canPlace: false });
  expect(useBrushStore.getState().canUndo).toBe(false);
  startPaste(); movePaste({ x: 512, y: 0 }); useSaveStore.setState({ open: true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(useAreaStore.getState().canPlace).toBe(false);
  useSaveStore.setState({ open: false });
  await expect.poll(() => useAreaStore.getState().canPlace, { timeout: 5000 }).toBe(true);
  placePaste();
  expect(canonicalWorldOf(world).tileAt(512, 0).block).toEqual({ kind: "vanilla", id: 1 });
});

test("invalid overlap disables placement and option-only recovery clears the error", () => {
  const bytes = brushSource(8, 8, Array.from({ length: 8 }, () => [0x40, 7]).flat());
  bytes[74] = (bytes[74] ?? 0) | 32;
  const world = readWorldTiles(bytes), view = canonicalWorldOf(world);
  view.setTile(5, 5, { block: { kind: "vanilla", id: 21 }, wires: 0, actuator: false });
  view.setTile(2, 2, { wall: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  setBrushWorld(world); setAreaWorld(world);
  selectArea({ x: 2, y: 2 }, { x: 2, y: 2 }); copySelection(); startPaste(); movePaste({ x: 5, y: 5 });
  expect(useAreaStore.getState().canPlace).toBe(false);
  expect(useAreaStore.getState().message).toContain("object");
  useAreaStore.setState({ options: { ...DEFAULT_PASTE_OPTIONS, air: "transparent" } });
  expect(useAreaStore.getState()).toMatchObject({ canPlace: true, message: "Click or Enter to place · Escape to cancel" });
  placePaste(); expect(view.tileAt(5, 5)).toMatchObject({ block: { id: 21 }, wall: { id: 1 } });
});
