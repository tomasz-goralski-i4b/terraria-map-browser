// @module-tag perf -- UI flows and long-task bounds run locally (docs/tooling.md).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { commands, page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../src/App.js";
import { exportWorld, saveWorldCopy } from "../src/world/export-world.js";
import { resetWorldExport, useExportStore } from "../src/world/export-world.js";
import { getDefaultWorldSession } from "../src/world/world-session.js";
import { readWorldTiles, writeWorld } from "@studio/world-codec";
import { writerSource } from "./support/export-source.js";
import "./support/commands.js";
import "../src/styles.css";
import { useAppStore } from "../src/store.js";

beforeEach(() => { localStorage.setItem("terraria-world-folder-hint-hidden", "1"); });
afterEach(() => { vi.unstubAllGlobals(); localStorage.removeItem("terraria-world-folder-hint-hidden"); });

async function open(bytes: Uint8Array<ArrayBuffer>, name = "SCCO1.wld", withHandle = true): Promise<void> {
  const file = new File([bytes], name);
  if (withHandle) {
    vi.stubGlobal("showOpenFilePicker", vi.fn().mockResolvedValue([{ getFile: () => Promise.resolve(file) }]));
    await page.getByRole("button", { name: "Open .wld world", exact: true }).click();
  } else await getDefaultWorldSession().open(file);
  await expect.element(page.getByRole("region", { name: "World", exact: true })).toMatchTextContent("SCCR1");
}

function directoryFor(handle: unknown): ReturnType<typeof vi.fn> {
  return vi.fn((_name: string, options: { create: boolean }) => options.create
    ? Promise.resolve(handle) : Promise.reject(new DOMException("No copy exists", "NotFoundError")));
}

async function exportAndSave(): Promise<void> {
  await exportWorld();
  if (useExportStore.getState().download !== null) await saveWorldCopy();
}

function destination(): { writes: ArrayBuffer[]; createWritable: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; getFileHandle: ReturnType<typeof vi.fn>; picker: ReturnType<typeof vi.fn>; unsafePicker: ReturnType<typeof vi.fn> } {
  const writes: ArrayBuffer[] = [];
  const close = vi.fn().mockResolvedValue(undefined);
  const createWritable = vi.fn().mockResolvedValue({ write: (bytes: ArrayBuffer) => { writes.push(bytes); }, close });
  const getFileHandle = directoryFor({ createWritable, isSameEntry: () => Promise.resolve(false) });
  const picker = vi.fn().mockResolvedValue({ getFileHandle });
  const unsafePicker = vi.fn().mockRejectedValue(new Error("The unsafe save picker must never run"));
  vi.stubGlobal("showSaveFilePicker", unsafePicker);
  vi.stubGlobal("showDirectoryPicker", picker);
  return { writes, createWritable, close, getFileHandle, picker, unsafePicker };
}

test.each([269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 315, 316, 317, 318, 319, 325, 326])(
  "exports format %i through the writer and preserves every world field", async (version) => {
    await render(<App />);
    // Four separate empty records per column: valid source encoding which the writer combines.
    const bytes = writerSource(2, 4, [0, 0, 0, 0, 0, 0, 0, 0], version);
    await open(bytes);
    const saved = destination();
    await exportAndSave();
    expect(saved.writes).toHaveLength(1);
    const output = new Uint8Array(saved.writes[0] ?? new ArrayBuffer(0));
    expect(output).toEqual(new Uint8Array(writeWorld(readWorldTiles(bytes))));
    expect(readWorldTiles(output).planes).toEqual(readWorldTiles(bytes).planes);
    expect(readWorldTiles(output).header.version).toBe(version);
    expect(saved.close).toHaveBeenCalledOnce();
    expect(saved.getFileHandle).toHaveBeenCalledWith("SCCO1.copy.wld", { create: false });
    expect(saved.getFileHandle).toHaveBeenCalledWith("SCCO1.copy.wld", { create: true });
    expect(saved.unsafePicker).not.toHaveBeenCalled();
  },
);

test.each([269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 315, 316, 317, 318, 319, 325, 326])(
  "exports current CWM edits in format %i without detaching the loaded world", async (version) => {
    await render(<App />);
    await open(writerSource(2, 4, undefined, version));
    const world = getDefaultWorldSession().getLoadedWorld();
    if (world === null) throw new Error("No loaded world");
    Object.assign(world, { palette: [{ kind: "vanilla", id: 1 }, { kind: "vanilla", id: 2 }] });
    world.planes.block[5] = 0;
    world.planes.wall[5] = 1;
    world.planes.shape[5] = 3;
    world.planes.paint[5] = 29;
    world.planes.wallPaint[5] = 12;
    world.planes.liquid[5] = 4;
    world.planes.liquidAmount[5] = 80;
    world.planes.flags[5] = 0x3ff;
    const before = structuredClone(world);
    const saved = destination();
    await exportAndSave();
    const restored = readWorldTiles(new Uint8Array(saved.writes[0] ?? new ArrayBuffer(0)));
    expect(restored.header).toEqual(world.header);
    expect(restored.metadata).toEqual(world.metadata);
    expect(restored.details).toEqual(world.details);
    expect(Object.values(restored.entities).map((section) => section.data)).toEqual(Object.values(world.entities).map((section) => section.data));
    expect(restored.envelope.opaqueSections.map(({ name, bytes }) => ({ name, bytes }))).toEqual(world.envelope.opaqueSections.map(({ name, bytes }) => ({ name, bytes })));
    expect(restored.planes).toEqual(world.planes);
    expect(restored.palette).toEqual(world.palette);
    expect(world).toEqual(before);
  },
);

test("Export world offers clearly named folder and download destinations", async () => {
  await render(<App />);
  await open(writerSource());
  const saved = destination();
  await page.getByRole("button", { name: "App menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export world…", exact: true }).click();
  await expect.element(page.getByRole("link", { name: "Download SCCO1.copy.wld" })).toBeVisible();
  await page.getByRole("button", { name: "Save world copy…", exact: true }).click();
  await expect.poll(() => saved.close.mock.calls.length).toBe(1);
});

test("the native Terraria world filter admits .wld without a generic binary MIME type", async () => {
  await render(<App />);
  const picker = vi.fn().mockRejectedValue(new DOMException("Picker closed", "AbortError"));
  vi.stubGlobal("showOpenFilePicker", picker);
  await page.getByRole("button", { name: "Open .wld world", exact: true }).click();
  expect(picker).toHaveBeenCalledWith({ id: "terraria-worlds", startIn: "documents", multiple: false, excludeAcceptAllOption: true,
    types: [{ description: "Terraria world (.wld)", accept: { "application/x-terraria-world": [".wld"] } }],
  });
});

test("writer rejection shows its reason and never creates a writable destination", async () => {
  await render(<App />);
  // Block 700 fits the source bitset, but exceeds format 279's vanilla range.
  await open(writerSource(2, 4, [0x62, 0xbc, 0x02, 3, 0x40, 3], 279));
  const saved = destination();
  await exportAndSave();
  expect(saved.createWritable).not.toHaveBeenCalled();
  expect(saved.picker).not.toHaveBeenCalled();
  expect(saved.unsafePicker).not.toHaveBeenCalled();
  await expect.element(page.getByRole("alert")).toMatchTextContent("UnsupportedWrite");
});

test("fallback offers a downloadable copy with the original bytes", async () => {
  await render(<App />);
  const bytes = writerSource();
  await open(bytes);
  vi.stubGlobal("showDirectoryPicker", undefined);
  await exportWorld();
  const link = document.querySelector<HTMLAnchorElement>('a[download="SCCO1.copy.wld"]');
  expect(link).not.toBeNull();
  expect(new Uint8Array(await (await fetch(link?.href ?? "")).arrayBuffer())).toEqual(bytes);
});

test("choosing the opened file or its alias refuses export before a writable stream is created", async () => {
  await render(<App />);
  const createWritable = vi.fn();
  const source = { getFile: () => Promise.resolve(new File([writerSource()], "SCCO1.wld")), createWritable };
  vi.stubGlobal("showOpenFilePicker", vi.fn().mockResolvedValue([source]));
  await page.getByRole("button", { name: "Open .wld world", exact: true }).click();
  await expect.element(page.getByRole("region", { name: "World", exact: true })).toMatchTextContent("SCCR1");
  const aliasWritable = vi.fn();
  const getFileHandle = vi.fn().mockResolvedValue({ isSameEntry: (entry: unknown) => Promise.resolve(entry === source), createWritable: aliasWritable });
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue({ getFileHandle }));
  await exportAndSave();
  expect(createWritable).not.toHaveBeenCalled();
  expect(aliasWritable).not.toHaveBeenCalled();
  expect(getFileHandle).toHaveBeenCalledExactlyOnceWith("SCCO1.copy.wld", { create: false });
  await expect.element(page.getByRole("alert")).toMatchTextContent("original");
});

test("file input opens use download even when a directory picker is available", async () => {
  await render(<App />);
  await open(writerSource(), "SCCO1.wld", false);
  const saved = destination();
  await exportWorld();
  // A File without a source handle cannot prove that a picker destination differs.
  expect(saved.createWritable).not.toHaveBeenCalled();
  await expect.element(page.getByRole("button", { name: "Save world copy…", exact: true })).not.toBeInTheDocument();
  await expect.element(page.getByRole("link", { name: "Download SCCO1.copy.wld" })).toBeVisible();
});

test("an existing copy is never overwritten", async () => {
  await render(<App />);
  await open(writerSource());
  const saved = destination();
  saved.getFileHandle.mockResolvedValue({ isSameEntry: () => Promise.resolve(false), createWritable: saved.createWritable });
  await exportAndSave();
  expect(saved.getFileHandle).toHaveBeenCalledExactlyOnceWith("SCCO1.copy.wld", { create: false });
  expect(saved.createWritable).not.toHaveBeenCalled();
  await expect.element(page.getByRole("alert")).toMatchTextContent("already exists");
  await expect.element(page.getByRole("link", { name: "Download SCCO1.copy.wld" })).toBeVisible();
});

test("a source alias appearing between lookup and creation is refused without truncation", async () => {
  await render(<App />);
  await open(writerSource());
  const saved = destination();
  saved.getFileHandle.mockRejectedValueOnce(new DOMException("No copy exists", "NotFoundError"))
    .mockResolvedValueOnce({ isSameEntry: () => Promise.resolve(true), createWritable: saved.createWritable });
  await exportAndSave();
  expect(saved.createWritable).not.toHaveBeenCalled();
  expect(saved.unsafePicker).not.toHaveBeenCalled();
  await expect.element(page.getByRole("alert")).toMatchTextContent("original");
});

test("cancelling directory selection keeps the prepared download without a filesystem write", async () => {
  await render(<App />);
  await open(writerSource());
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockRejectedValue(new DOMException("Save cancelled", "AbortError")));
  await exportAndSave();
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  await expect.element(page.getByRole("link", { name: "Download SCCO1.copy.wld" })).toBeVisible();
});

test("a destination write failure is shown and a later export can succeed", async () => {
  await render(<App />);
  await open(writerSource());
  const abort = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue({ getFileHandle: directoryFor({
    isSameEntry: () => Promise.resolve(false),
    createWritable: () => Promise.resolve({ write: () => Promise.reject(new Error("Disk is full")), close, abort }),
  }) }));
  await exportAndSave();
  await expect.element(page.getByRole("alert")).toMatchTextContent("Disk is full");
  expect(abort).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  const saved = destination();
  await exportAndSave();
  expect(saved.close).toHaveBeenCalledOnce();
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
});

test("a late picker result after opening another world never creates a file", async () => {
  await render(<App />);
  await open(writerSource());
  let pick: ((handle: unknown) => void) | undefined;
  vi.stubGlobal("showDirectoryPicker", () => new Promise((resolve) => { pick = resolve; }));
  await exportWorld();
  const exporting = saveWorldCopy();
  await getDefaultWorldSession().open(new File([writerSource()], "CrimsonObservatory.wld"));
  const getFileHandle = vi.fn();
  pick?.({ getFileHandle });
  await exporting;
  expect(getFileHandle).not.toHaveBeenCalled();
  expect(document.querySelector("a[download]")).toBeNull();
});

test("an export Worker crash reports an error without creating a writable file", async () => {
  await render(<App />);
  await open(writerSource());
  const saved = destination();
  const terminate = vi.fn();
  class CrashingWorker {
    onerror: ((event: { message: string; preventDefault(): void }) => void) | null = null;
    terminate = terminate;
    postMessage(): void {
      queueMicrotask(() => { this.onerror?.({ message: "Export Worker stopped unexpectedly", preventDefault: () => undefined }); });
    }
  }
  vi.stubGlobal("Worker", CrashingWorker);
  await exportWorld();
  await expect.element(page.getByRole("alert")).toMatchTextContent("Export Worker stopped unexpectedly");
  expect(terminate).toHaveBeenCalledOnce();
  expect(saved.createWritable).not.toHaveBeenCalled();
  expect(useExportStore.getState().busy).toBe(false);
});

test("resetting the world releases its download URL and export state", async () => {
  await render(<App />);
  await open(writerSource());
  vi.stubGlobal("showDirectoryPicker", undefined);
  await exportWorld();
  const url = useExportStore.getState().download?.url;
  expect(url).toBeDefined();
  resetWorldExport();
  await expect.element(page.getByRole("link", { name: "Download SCCO1.copy.wld" })).not.toBeInTheDocument();
  await expect(fetch(url ?? "")).rejects.toThrow();
  expect(useExportStore.getState()).toEqual({ busy: false, message: null, error: null, download: null, canSave: false });
});

test("Save world copy works immediately after Open world without an Export step", async () => {
  await render(<App />);
  await open(writerSource());
  const saved = destination();
  await page.getByRole("button", { name: "App menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save world copy…", exact: true }).click();
  await expect.poll(() => saved.close.mock.calls.length).toBe(1);
  expect(saved.picker).toHaveBeenCalledOnce();
  const world = getDefaultWorldSession().getLoadedWorld();
  if (world === null) throw new Error("SCCO1 should be loaded before saving its copy");
  expect(new Uint8Array(saved.writes[0] ?? new ArrayBuffer(0))).toEqual(new Uint8Array(writeWorld(world)));
});

test("Save world copy serializes current edits even after an earlier export was prepared", async () => {
  await render(<App />);
  await open(writerSource());
  await exportWorld();
  const world = getDefaultWorldSession().getLoadedWorld();
  if (world === null) throw new Error("SCCO1 should be loaded before changing its tiles");
  Object.assign(world, { palette: [{ kind: "vanilla", id: 1 }] });
  world.planes.block[5] = 0;
  world.planes.paint[5] = 29;
  const saved = destination();
  await saveWorldCopy();
  const restored = readWorldTiles(new Uint8Array(saved.writes[0] ?? new ArrayBuffer(0)));
  expect(restored.planes.block).toEqual(world.planes.block);
  expect(restored.planes.paint).toEqual(world.planes.paint);
  expect(restored.palette).toEqual(world.palette);
});

test("Open folder remembers the destination for direct Save world copy", async () => {
  const bytes = writerSource();
  const source = { kind: "file", name: "SCCO1.wld", getFile: () => Promise.resolve(new File([bytes], "SCCO1.wld")) };
  const saved = destination();
  const folder = {
    name: "Terraria Worlds", getFileHandle: saved.getFileHandle,
    values: async function* () {
      yield { kind: "directory", name: "Backups" };
      yield { kind: "file", name: "Worlds.txt", getFile: () => Promise.resolve(new File([], "Worlds.txt")) };
      yield await Promise.resolve(source);
    },
  };
  saved.picker.mockResolvedValue(folder);
  await render(<App />);
  await page.getByRole("button", { name: "Open folder…", exact: true }).click();
  await expect.element(page.getByRole("dialog", { name: "Worlds in Terraria Worlds" })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Open Worlds.txt", exact: true })).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Open SCCO1.wld", exact: true }).click();
  await expect.element(page.getByRole("region", { name: "World", exact: true })).toMatchTextContent("SCCR1");
  await page.getByRole("button", { name: "App menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save world copy…", exact: true }).click();
  await expect.poll(() => saved.close.mock.calls.length).toBe(1);
  expect(saved.picker).toHaveBeenCalledOnce();
  expect(saved.picker).toHaveBeenCalledWith({ id: "terraria-worlds", startIn: "documents", mode: "readwrite" });
  const world = getDefaultWorldSession().getLoadedWorld();
  if (world === null) throw new Error("SCCO1 should be loaded from Terraria Worlds before saving");
  expect(new Uint8Array(saved.writes[0] ?? new ArrayBuffer(0))).toEqual(new Uint8Array(writeWorld(world)));
});

test("the export result can be closed without closing the world", async () => {
  await render(<App />);
  await open(writerSource());
  await exportWorld();
  const world = getDefaultWorldSession().getLoadedWorld();
  const url = useExportStore.getState().download?.url;
  await page.getByRole("button", { name: "Close export", exact: true }).click();
  await expect.element(page.getByRole("link", { name: "Download SCCO1.copy.wld" })).not.toBeInTheDocument();
  await expect(fetch(url ?? "")).rejects.toThrow();
  expect(getDefaultWorldSession().getLoadedWorld()).toBe(world);
});

test("the folder world chooser can be closed", async () => {
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue({
    name: "Terraria Worlds", values: async function* () { yield await Promise.resolve({ kind: "directory", name: "Backups" }); },
  }));
  await render(<App />);
  await page.getByRole("button", { name: "Open folder…", exact: true }).click();
  await expect.element(page.getByRole("dialog", { name: "Worlds in Terraria Worlds" })).toBeVisible();
  await page.getByRole("button", { name: "Close folder", exact: true }).click();
  await expect.poll(() => document.querySelector<HTMLDialogElement>('dialog[aria-label="Worlds in Terraria Worlds"]')?.open).toBe(false);
  expect(getDefaultWorldSession().getLoadedWorld()).toBeNull();
});

test("a later folder-world selection wins when an earlier file lookup completes first", async () => {
  let resolveEarlier: ((file: File) => void) | undefined;
  let resolveLater: ((file: File) => void) | undefined;
  const earlier = { kind: "file", name: "SCCO1.wld", getFile: vi.fn(() => new Promise<File>((resolve) => { resolveEarlier = resolve; })) };
  const later = { kind: "file", name: "CrimsonObservatory.wld", getFile: vi.fn(() => new Promise<File>((resolve) => { resolveLater = resolve; })) };
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue({
    name: "Terraria Worlds", values: async function* () { yield earlier; yield await Promise.resolve(later); },
  }));
  await render(<App />);
  await page.getByRole("button", { name: "Open folder…", exact: true }).click();
  await page.getByRole("button", { name: "Open SCCO1.wld", exact: true }).click();
  await page.getByRole("button", { name: "Open CrimsonObservatory.wld", exact: true }).click();
  resolveEarlier?.(new File([writerSource()], "SCCO1.wld"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(useAppStore.getState().phase).toBe("idle");
  resolveLater?.(new File([writerSource()], "CrimsonObservatory.wld"));
  await expect.poll(() => getDefaultWorldSession().getOpenedFile()?.file.name).toBe("CrimsonObservatory.wld");
});

test("the first folder picker explains Terraria's default path and can remember dismissal", async () => {
  localStorage.removeItem("terraria-world-folder-hint-hidden");
  const picker = vi.fn().mockRejectedValue(new DOMException("Selection cancelled", "AbortError"));
  vi.stubGlobal("showDirectoryPicker", picker);
  await render(<App />);
  await page.getByRole("button", { name: "Open folder…", exact: true }).click();
  await expect.element(page.getByRole("dialog", { name: "Choose your Terraria worlds folder" })).toBeVisible();
  await expect.element(page.getByText("Documents\\My Games\\Terraria\\Worlds", { exact: true })).toBeVisible();
  expect(picker).not.toHaveBeenCalled();
  await page.getByRole("checkbox", { name: "Don't show again", exact: true }).click();
  await page.getByRole("button", { name: "Choose folder…", exact: true }).click();
  expect(picker).toHaveBeenCalledWith({ id: "terraria-worlds", startIn: "documents", mode: "readwrite" });
  expect(localStorage.getItem("terraria-world-folder-hint-hidden")).toBe("1");
  await page.getByRole("button", { name: "Open folder…", exact: true }).click();
  await expect.poll(() => picker.mock.calls.length).toBe(2);
  await expect.poll(() => document.querySelector<HTMLDialogElement>('dialog[aria-label="Choose your Terraria worlds folder"]')?.open).toBe(false);
});

test("closing the first-folder explanation never opens the system picker", async () => {
  localStorage.removeItem("terraria-world-folder-hint-hidden");
  const picker = vi.fn();
  vi.stubGlobal("showDirectoryPicker", picker);
  await render(<App />);
  await page.getByRole("button", { name: "Open folder…", exact: true }).click();
  await page.getByRole("button", { name: "Close folder explanation", exact: true }).click();
  await expect.poll(() => document.querySelector<HTMLDialogElement>('dialog[aria-label="Choose your Terraria worlds folder"]')?.open).toBe(false);
  expect(picker).not.toHaveBeenCalled();
  expect(localStorage.getItem("terraria-world-folder-hint-hidden")).toBeNull();
});

test("exporting a generated Small world causes no main-thread task over 100 ms", async () => {
  const binary = atob(await commands.readWorldFixture("SCCO1.wld"));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  await render(<App />);
  await open(bytes);
  // Let the initial renderer upload finish before measuring the export.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const saved = destination();
  const tasks: PerformanceEntry[] = [];
  const observer = new PerformanceObserver((list) => { tasks.push(...list.getEntries()); });
  observer.observe({ type: "longtask" });
  const start = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await exportAndSave();
  const end = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 0));
  tasks.push(...observer.takeRecords());
  observer.disconnect();
  expect(Math.max(0, ...tasks.filter((entry) => entry.startTime >= start && entry.startTime < end).map((entry) => entry.duration))).toBeLessThanOrEqual(100);
  expect(new Uint8Array(saved.writes[0] ?? new ArrayBuffer(0))).toEqual(bytes);
});
