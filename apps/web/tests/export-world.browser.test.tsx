// @module-tag perf -- UI flows and long-task bounds run locally (docs/tooling.md).
import { afterEach, expect, test, vi } from "vitest";
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

afterEach(() => { vi.unstubAllGlobals(); });

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
  await saveWorldCopy();
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

test("the Export world command is available after opening a world", async () => {
  await render(<App />);
  await open(writerSource());
  const saved = destination();
  await page.getByRole("button", { name: "App menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export world…", exact: true }).click();
  await page.getByRole("button", { name: "Save world copy…", exact: true }).click();
  await expect.poll(() => saved.close.mock.calls.length).toBe(1);
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
  saved.getFileHandle.mockImplementation(() => Promise.resolve({ isSameEntry: () => Promise.resolve(false), createWritable: saved.createWritable }));
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
  saved.getFileHandle.mockImplementation((_name: string, options: { create: boolean }) => options.create
    ? Promise.resolve({ isSameEntry: () => Promise.resolve(true), createWritable: saved.createWritable })
    : Promise.reject(new DOMException("No copy exists", "NotFoundError")));
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
