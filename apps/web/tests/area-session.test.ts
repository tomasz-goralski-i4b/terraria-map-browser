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
