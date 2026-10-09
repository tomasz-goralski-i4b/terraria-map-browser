import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readWorldTiles } from "@studio/world-codec";
import { useAppStore } from "../src/store.js";
import { beginBrush, finishBrush, moveBrush, redoBrush, setBrushWorld, undoBrush, useBrushStore } from "../src/world/brush-session.js";
import { canonicalWorldOf } from "../src/world/canonical-world.js";
import { useSaveStore } from "../src/world/save-world.js";
import { createWorldSession, type WorldParser } from "../src/world/world-session.js";
import { brushSource } from "./support/brush-source.js";

const source = (): Uint8Array<ArrayBuffer> => brushSource(8, 8, Array.from({ length: 8 }, () => [0x40, 7]).flat());
beforeEach(() => {
  useSaveStore.setState({ open: false });
  useAppStore.setState({ phase: "loaded", unsavedChanges: false });
  useBrushStore.setState({ layer: "block", blockId: 1, size: 1 });
});
afterEach(() => { setBrushWorld(null); useSaveStore.setState({ open: false }); });
const paint = (x: number, y: number): void => {
  expect(beginBrush(false)).toBe(true);
  moveBrush(x, y);
  finishBrush();
};

test("save points survive further edit, undo, redo and cancellation of clean or already dirty strokes", () => {
  const world = readWorldTiles(source());
  setBrushWorld(world);
  paint(2, 2);
  useAppStore.getState().setUnsavedChanges(false); // Existing successful Save As sets this flag.
  paint(4, 4);
  undoBrush();
  expect(useAppStore.getState().unsavedChanges).toBe(false);
  redoBrush();
  expect(useAppStore.getState().unsavedChanges).toBe(true);
  expect(beginBrush(false)).toBe(true);
  moveBrush(6, 6);
  finishBrush(true);
  expect(canonicalWorldOf(world).tileAt(6, 6).block).toBeUndefined();
  expect(useAppStore.getState().unsavedChanges).toBe(true);
  undoBrush();
  expect(beginBrush(false)).toBe(true);
  moveBrush(6, 6);
  finishBrush(true);
  expect(useAppStore.getState().unsavedChanges).toBe(false);
  redoBrush();
  expect(canonicalWorldOf(world).tileAt(4, 4).block).toEqual({ kind: "vanilla", id: 1 });
});

test("loading and export lock both mutation and history actions", () => {
  const world = readWorldTiles(source());
  setBrushWorld(world);
  paint(2, 2);
  for (const lock of ["loading", "export"] as const) {
    useAppStore.setState({ phase: lock === "loading" ? "loading" : "loaded" });
    useSaveStore.setState({ open: lock === "export" });
    expect(beginBrush(false)).toBe(false);
    undoBrush();
    expect(canonicalWorldOf(world).tileAt(2, 2).block).toEqual({ kind: "vanilla", id: 1 });
    useAppStore.setState({ phase: "loaded" });
    useSaveStore.setState({ open: false });
  }
  undoBrush();
  useSaveStore.setState({ open: true });
  redoBrush();
  expect(canonicalWorldOf(world).tileAt(2, 2).block).toBeUndefined();
  useSaveStore.setState({ open: false });
  redoBrush();
  expect(canonicalWorldOf(world).tileAt(2, 2).block).toEqual({ kind: "vanilla", id: 1 });
});

test("successful replacement clears history; failed and cancelled replacements retain committed edits", async () => {
  const world = readWorldTiles(source());
  const parse = vi.fn<WorldParser["parse"]>().mockResolvedValue(world);
  const session = createWorldSession({ parse });
  const file = new File([source()], "EvergreenReach.wld");
  await session.open(file);
  paint(2, 2);
  parse.mockRejectedValueOnce(new Error("The selected world could not be read"));
  await session.open(file);
  expect(session.getLoadedWorld()).toBe(world);
  expect(useBrushStore.getState().canUndo).toBe(true);
  expect(useAppStore.getState().unsavedChanges).toBe(true);
  parse.mockImplementationOnce((_file, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => { reject(new DOMException("Open cancelled", "AbortError")); });
  }));
  const opening = session.open(file);
  session.cancel();
  await opening;
  expect(useBrushStore.getState().canUndo).toBe(true);
  undoBrush();
  expect(canonicalWorldOf(world).tileAt(2, 2).block).toBeUndefined();
  await session.open(file);
  expect(useBrushStore.getState().canUndo).toBe(false);
  expect(useBrushStore.getState().canRedo).toBe(false);
  session.reset();
  expect(useBrushStore.getState().reason).toBe("Open a vanilla world first");
});

test("the header frame-important flag protects even an otherwise whitelisted stone block", () => {
  const world = readWorldTiles(source());
  const view = canonicalWorldOf(world);
  view.setTile(2, 2, { block: { kind: "vanilla", id: 1 }, frameX: 18, frameY: 0, wires: 0, actuator: false });
  world.sections.frameImportantBits[0] = (world.sections.frameImportantBits[0] ?? 0) | 2;
  setBrushWorld(world);
  expect(beginBrush(true)).toBe(true);
  moveBrush(2, 2);
  finishBrush();
  expect(view.tileAt(2, 2).block).toEqual({ kind: "vanilla", id: 1 });
  expect(useBrushStore.getState().canUndo).toBe(false);
});
