import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readWorldTiles } from "@studio/world-codec";
import { useAppStore } from "../src/store.js";
import { beginBrush, finishBrush, moveBrush, redoBrush, setBrushWorld, undoBrush, useBrushStore } from "../src/world/brush-session.js";
import { canonicalWorldOf } from "../src/world/canonical-world.js";
import { setDiscardConfirmer } from "../src/world/discard-guard.js";
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
  // With unsaved edits the open first asks; cancel once the replacement is being read.
  await vi.waitFor(() => { expect(parse).toHaveBeenCalledTimes(3); });
  session.cancel();
  await opening;
  expect(useAppStore.getState().phase).not.toBe("loading");
  expect(useBrushStore.getState().canUndo).toBe(true);
  undoBrush();
  expect(canonicalWorldOf(world).tileAt(2, 2).block).toBeUndefined();
  await session.open(file);
  expect(useBrushStore.getState().canUndo).toBe(false);
  expect(useBrushStore.getState().canRedo).toBe(false);
  session.reset();
  expect(useBrushStore.getState().reason).toBe("Open a vanilla world first");
});

test("a chest footprint stays as it is while the rest of the stroke erases", () => {
  const world = readWorldTiles(source());
  const view = canonicalWorldOf(world);
  for (let x = 0; x < 8; x++) view.setTile(x, 5, { block: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  Object.assign(world.entities.Chests, { data: { entries: [{ x: 1, y: 3, name: "", slotCount: 40, items: [] }] } });
  setBrushWorld(world);
  expect(beginBrush(true)).toBe(true);
  moveBrush(0, 5);
  moveBrush(7, 5);
  finishBrush();
  for (let x = 0; x <= 3; x++) expect(view.tileAt(x, 5).block).toEqual({ kind: "vanilla", id: 1 });
  for (let x = 4; x < 8; x++) expect(view.tileAt(x, 5).block).toBeUndefined();
  expect(useBrushStore.getState().canUndo).toBe(true);
});

test("opening another world with unsaved edits asks first; declining keeps the world and its history", async () => {
  const world = readWorldTiles(source());
  const other = readWorldTiles(source());
  const parse = vi.fn<WorldParser["parse"]>().mockResolvedValueOnce(world).mockResolvedValue(other);
  const session = createWorldSession({ parse });
  const file = new File([source()], "EvergreenReach.wld");
  await session.open(file);
  paint(2, 2);
  const answers = [false, true];
  const confirm = vi.fn(() => Promise.resolve(answers.shift() ?? false));
  setDiscardConfirmer(confirm);
  try {
    await session.open(file);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(session.getLoadedWorld()).toBe(world);
    expect(useBrushStore.getState().canUndo).toBe(true);
    await session.open(file);
    expect(session.getLoadedWorld()).toBe(other);
    expect(useBrushStore.getState().canUndo).toBe(false);
    await session.open(file);
    expect(confirm).toHaveBeenCalledTimes(2);
  } finally {
    setDiscardConfirmer(null);
  }
});

test("declining the question for a second open leaves the first one loading, never a stuck spinner", async () => {
  const world = readWorldTiles(source());
  const replacement = readWorldTiles(source());
  let finish: (value: typeof replacement) => void = () => undefined;
  const parse = vi.fn<WorldParser["parse"]>().mockResolvedValueOnce(world)
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const session = createWorldSession({ parse });
  const file = new File([source()], "EvergreenReach.wld");
  await session.open(file);
  paint(2, 2);
  const answers = [true, false];
  setDiscardConfirmer(() => Promise.resolve(answers.shift() ?? false));
  try {
    const first = session.open(file);
    await vi.waitFor(() => { expect(parse).toHaveBeenCalledTimes(2); });
    await session.open(file);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().phase).toBe("loading");
    finish(replacement);
    await first;
    expect(session.getLoadedWorld()).toBe(replacement);
    expect(useAppStore.getState().phase).toBe("loaded");
  } finally {
    setDiscardConfirmer(null);
  }
});
