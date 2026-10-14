// @module-tag perf -- Real viewer/Worker flows and frame timings need a local browser.
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../src/App.js";
import { getDefaultAssetSession, useAssetStore } from "../src/assets/asset-session.js";
import { getMapController, useViewStore } from "../src/shell/view-store.js";
import { hydrateLayout } from "../src/shell/layout-store.js";
import { useAppStore } from "../src/store.js";
import "../src/styles.css";

const originalUrl = location.href;
afterEach(async () => {
  history.replaceState(null, "", originalUrl);
  await getDefaultAssetSession().disconnect();
  useAppStore.setState({ phase: "idle", summary: null, error: null, unsavedChanges: false });
});

test("startup loads a synthetic world and HTTP Images directory without pickers, renders sprites and benchmarks each step", async () => {
  await page.viewport(1280, 800);
  hydrateLayout(null);
  const origin = location.origin.replace("127.0.0.1", "localhost");
  const params = new URLSearchParams({ world: `${origin}/source-fixtures/ForestWorkshop.wld`, content: `${origin}/source-fixtures/content/`, perf: "" });
  history.replaceState(null, "", `?${params.toString()}`);
  const mounted = await render(<App layoutStorage={null} />);
  await expect.poll(() => useAppStore.getState().summary?.fileName, { timeout: 30000 }).toBe("ForestWorkshop.wld");
  await expect.poll(() => useAssetStore.getState().status.kind, { timeout: 30000 }).toBe("ready");
  await expect.element(page.getByLabelText("World map")).toBeVisible();
  getMapController()?.zoomTo(16);
  await expect.poll(() => useViewStore.getState().zoom).toBeCloseTo(16);
  await expect.poll(() => getMapController()?.stats().spritesPreparing, { timeout: 30000 }).toBe(false);
  getMapController()?.renderNow();
  await expect.element(page.getByLabelText("Viewer performance")).toHaveTextContent("sprites");
  const benchmark = window.__studioBench;
  expect(benchmark).toBeDefined();
  if (benchmark === undefined) throw new Error("Dev benchmark unavailable");
  const rows = await benchmark.run({ steps: 3, panMs: 120 });
  expect(rows).toHaveLength(3);
  expect(rows.map((row) => row.step)).toEqual([1, 2, 3]);
  for (const row of rows) {
    expect(row.zoom).toBeGreaterThan(0);
    expect(row.fps).toBeGreaterThan(0);
    expect(row.p95).toBeGreaterThan(0);
    expect(row.maxFrame).toBeGreaterThanOrEqual(row.p95);
    expect(["overview", "chunks", "sprites"]).toContain(row.mode);
    expect(row.uploads).toBeGreaterThanOrEqual(0);
  }
  expect(rows[2]?.zoom).toBeGreaterThan(rows[0]?.zoom ?? 0);
  await expect(benchmark.run({ steps: -1, panMs: 100 })).rejects.toThrow(/steps/);
  const running = benchmark.run({ steps: 1, panMs: 120 });
  await expect(benchmark.run({ steps: 1, panMs: 120 })).rejects.toThrow(/running/i);
  await running;
  const interrupted = benchmark.run({ steps: 1, panMs: 120 });
  const rejected = expect(interrupted).rejects.toThrow(/closed|abort/i);
  await mounted.unmount();
  await rejected;
  expect(window.__studioBench).toBeUndefined();
}, 60000);

test("a rejected dev URL displays a message before any world is loaded", async () => {
  history.replaceState(null, "", "?world=http://example.com/ForestWorkshop.wld&content=http://localhost/content/");
  await render(<App layoutStorage={null} />);
  await expect.element(page.getByText(/only.*localhost|loopback/i)).toBeVisible();
  expect(useAppStore.getState().summary).toBeNull();
});

test("the production bundle ignores source parameters and has no dev benchmark while perf remains available", async () => {
  const frame = document.createElement("iframe");
  frame.src = "/pwa-app/index.html?world=http://example.com/ForestWorkshop.wld&content=invalid&perf";
  document.body.append(frame);
  try {
    await expect.poll(() => frame.contentDocument?.body.textContent, { timeout: 15000 }).toContain("Open World…");
    expect(frame.contentDocument?.querySelector('canvas[aria-label="World map"]')).toBeNull();
    expect(frame.contentDocument?.querySelector('[aria-label="Viewer performance"]')).not.toBeNull();
    expect((frame.contentWindow as Window | null)?.__studioBench).toBeUndefined();
    expect(frame.contentDocument?.body.textContent).not.toMatch(/loopback|localhost/i);
  } finally { frame.remove(); }
});
