// @module-tag perf -- UI flows and long-task bounds run locally (docs/tooling.md).
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../src/App.js";
import { getDefaultWorldSession } from "../src/world/world-session.js";
import { runImageExport, useImageExportStore } from "../src/world/image-export-session.js";
import { writerSource } from "./support/export-source.js";
import { menu } from "./support/shell.js";
import "../src/styles.css";

afterEach(() => {
  useImageExportStore.setState({ open: false, scope: "world", scale: 1, style: "map", format: "png", progress: null });
  vi.unstubAllGlobals();
});

/** An empty world of `width` × `height`: every column is one run of empty tiles (2-byte RLE). */
function emptyWorld(width: number, height: number): File {
  const column = [0x80, (height - 1) & 0xff, (height - 1) >> 8];
  return new File([writerSource(width, height, Array.from({ length: width }, () => column).flat())], "Empty.wld");
}

/** A save picker double: what Export writes ends up in `written`. */
function stubPicker(): { readonly written: Blob[] } {
  const written: Blob[] = [];
  vi.stubGlobal("showSaveFilePicker", vi.fn(() => Promise.resolve({
    createWritable: () => Promise.resolve({ write: (data: Blob) => { written.push(data); return Promise.resolve(); }, close: () => Promise.resolve() }),
  })));
  return { written };
}

async function pngSize(blob: Blob): Promise<readonly [number, number]> {
  const view = new DataView(await blob.slice(16, 24).arrayBuffer());
  return [view.getUint32(0), view.getUint32(4)];
}

test("File ▸ Export ▸ Map Image exports the whole world at the chosen scale and shows progress in the job cell", async () => {
  await page.viewport(1280, 800);
  await render(<App />);
  await getDefaultWorldSession().open(emptyWorld(40, 30));
  const { written } = stubPicker();
  await menu("File", "Export", "Map Image…");
  const dialog = page.getByRole("dialog", { name: "Export Map Image" });
  await expect.element(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Selection" }).click();
  await expect.element(dialog).toMatchTextContent("Select an area first");
  await dialog.getByRole("button", { name: "Whole world" }).click();
  await dialog.getByRole("button", { name: "Textures" }).click();
  await expect.element(dialog).toMatchTextContent("Connect the game's Images folder to export textures");
  expect(useImageExportStore.getState().scale).toBe(16);
  await dialog.getByRole("button", { name: "Map colours" }).click();
  await dialog.getByRole("slider", { name: "Pixels per block" }).fill("2");
  await expect.poll(() => page.getByTestId("export-image-size").element().textContent).toMatch(/^80 × 60 px · /);
  await dialog.getByRole("button", { name: "Export" }).click();
  await expect.poll(() => written.length).toBe(1);
  expect(await pngSize(written[0] ?? new Blob())).toEqual([80, 60]);
  await expect.element(page.getByTestId("background-job")).toHaveTextContent("Idle");
});

test("exporting a Large world at 1 px per tile causes no main-thread task over 50 ms", { timeout: 120_000 }, async () => {
  await render(<App />);
  await getDefaultWorldSession().open(emptyWorld(8400, 2400));
  // Let the initial renderer upload finish before measuring the export.
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const { written } = stubPicker();
  const tasks: PerformanceEntry[] = [];
  const observer = new PerformanceObserver((list) => { tasks.push(...list.getEntries()); });
  observer.observe({ type: "longtask" });
  const start = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await runImageExport();
  const end = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 0));
  tasks.push(...observer.takeRecords());
  observer.disconnect();
  expect(Math.max(0, ...tasks.filter((entry) => entry.startTime >= start && entry.startTime < end).map((entry) => entry.duration))).toBeLessThanOrEqual(50);
  expect(await pngSize(written[0] ?? new Blob())).toEqual([8400, 2400]);
});
