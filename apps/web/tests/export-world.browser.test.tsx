// @module-tag perf -- UI flows and long-task bounds run locally (docs/tooling.md).
import { afterEach, expect, test, vi } from "vitest";
import { commands, page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../src/App.js";
import { exportWorld } from "../src/world/export-world.js";
import { resetWorldExport, useExportStore } from "../src/world/export-world.js";
import { getDefaultWorldSession } from "../src/world/world-session.js";
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

function destination(): { writes: ArrayBuffer[]; createWritable: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
  const writes: ArrayBuffer[] = [];
  const close = vi.fn().mockResolvedValue(undefined);
  const createWritable = vi.fn().mockResolvedValue({ write: (bytes: ArrayBuffer) => { writes.push(bytes); }, close });
  vi.stubGlobal("showSaveFilePicker", vi.fn().mockResolvedValue({ createWritable, isSameEntry: () => Promise.resolve(false) }));
  return { writes, createWritable, close };
}

test.each([269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 315, 316, 317, 318, 319, 325, 326])(
  "exports format %i byte-identically including noncanonical tile runs", async (version) => {
    await render(<App />);
    // Four separate empty records per column: valid source encoding which the writer combines.
    const bytes = writerSource(2, 4, [0, 0, 0, 0, 0, 0, 0, 0], version);
    await open(bytes);
    const saved = destination();
    await exportWorld();
    expect(saved.writes).toHaveLength(1);
    expect(new Uint8Array(saved.writes[0] ?? new ArrayBuffer(0))).toEqual(bytes);
    expect(saved.close).toHaveBeenCalledOnce();
    expect(vi.mocked(Reflect.get(window, "showSaveFilePicker"))).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: "SCCO1.copy.wld" }));
  },
);

test("the Export world command is available after opening a world", async () => {
  await render(<App />);
  await open(writerSource());
  const saved = destination();
  await page.getByRole("button", { name: "App menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export world…", exact: true }).click();
  await expect.poll(() => saved.close.mock.calls.length).toBe(1);
});

test("writer rejection shows its reason and never creates a writable destination", async () => {
  await render(<App />);
  // Block 700 fits the source bitset, but exceeds format 279's vanilla range.
  await open(writerSource(2, 4, [0x62, 0xbc, 0x02, 3, 0x40, 3], 279));
  const saved = destination();
  await exportWorld();
  expect(saved.createWritable).not.toHaveBeenCalled();
  await expect.element(page.getByRole("alert")).toMatchTextContent("UnsupportedWrite");
});

test("fallback offers a downloadable copy with the original bytes", async () => {
  await render(<App />);
  const bytes = writerSource();
  await open(bytes);
  vi.stubGlobal("showSaveFilePicker", undefined);
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
  vi.stubGlobal("showSaveFilePicker", vi.fn().mockResolvedValue({ isSameEntry: (entry: unknown) => Promise.resolve(entry === source), createWritable: aliasWritable }));
  await exportWorld();
  expect(createWritable).not.toHaveBeenCalled();
  expect(aliasWritable).not.toHaveBeenCalled();
  await expect.element(page.getByRole("alert")).toMatchTextContent("original");
});

test("file input opens use download even when a save picker is available", async () => {
  await render(<App />);
  await open(writerSource(), "SCCO1.wld", false);
  const saved = destination();
  await exportWorld();
  // A File without a source handle cannot prove that a picker destination differs.
  expect(saved.createWritable).not.toHaveBeenCalled();
  await expect.element(page.getByRole("link", { name: "Download SCCO1.copy.wld" })).toBeVisible();
});

test("cancelling the save picker produces no error or file", async () => {
  await render(<App />);
  await open(writerSource());
  vi.stubGlobal("showSaveFilePicker", vi.fn().mockRejectedValue(new DOMException("Save cancelled", "AbortError")));
  await exportWorld();
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  expect(document.querySelector("a[download]")).toBeNull();
});

test("a destination write failure is shown and a later export can succeed", async () => {
  await render(<App />);
  await open(writerSource());
  const abort = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  vi.stubGlobal("showSaveFilePicker", vi.fn().mockResolvedValue({
    isSameEntry: () => Promise.resolve(false),
    createWritable: () => Promise.resolve({ write: () => Promise.reject(new Error("Disk is full")), close, abort }),
  }));
  await exportWorld();
  await expect.element(page.getByRole("alert")).toMatchTextContent("Disk is full");
  expect(abort).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  const saved = destination();
  await exportWorld();
  expect(saved.close).toHaveBeenCalledOnce();
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
});

test("a late picker result after opening another world never creates a file", async () => {
  await render(<App />);
  await open(writerSource());
  let pick: ((handle: unknown) => void) | undefined;
  vi.stubGlobal("showSaveFilePicker", () => new Promise((resolve) => { pick = resolve; }));
  const exporting = exportWorld();
  await getDefaultWorldSession().open(new File([writerSource()], "CrimsonObservatory.wld"));
  const createWritable = vi.fn();
  pick?.({ isSameEntry: () => Promise.resolve(false), createWritable });
  await exporting;
  expect(createWritable).not.toHaveBeenCalled();
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
  vi.stubGlobal("showSaveFilePicker", undefined);
  await exportWorld();
  const url = useExportStore.getState().download?.url;
  expect(url).toBeDefined();
  resetWorldExport();
  await expect.element(page.getByRole("link", { name: "Download SCCO1.copy.wld" })).not.toBeInTheDocument();
  await expect(fetch(url ?? "")).rejects.toThrow();
  expect(useExportStore.getState()).toEqual({ busy: false, message: null, error: null, download: null });
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
  await exportWorld();
  const end = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 0));
  tasks.push(...observer.takeRecords());
  observer.disconnect();
  expect(Math.max(0, ...tasks.filter((entry) => entry.startTime >= start && entry.startTime < end).map((entry) => entry.duration))).toBeLessThanOrEqual(100);
  expect(new Uint8Array(saved.writes[0] ?? new ArrayBuffer(0))).toEqual(bytes);
});
