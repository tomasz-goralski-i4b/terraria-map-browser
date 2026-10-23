// @module-tag perf -- UI flows starve on shared CI runners; skipped in CI (docs/tooling.md).
import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { DockviewApi, DockviewGroupPanel } from "dockview-react";
import { App } from "../src/App.js";
import { type LayoutStorage, useLayoutStore } from "../src/shell/layout-store.js";
import { showMeasurements } from "../src/shell/RulerOptions.js";
import { getWorkbench } from "../src/shell/workbench-api.js";
import "../src/styles.css";
import { menu } from "./support/shell.js";

class MemoryStorage implements LayoutStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { this.items.set(key, value); }
  removeItem(key: string): void { this.items.delete(key); }
}

let storage: MemoryStorage;

beforeEach(async () => {
  storage = new MemoryStorage();
  await page.viewport(1280, 800);
});

afterEach(() => {
  useLayoutStore.getState().setDockHidden(false);
});

const wait = (ms: number): Promise<void> => new Promise((resolve) => { window.setTimeout(resolve, ms); });

function api(): DockviewApi {
  const workbench = getWorkbench();
  if (workbench === null) throw new Error("the workbench is not ready");
  return workbench;
}

function groupOf(panel: string): DockviewGroupPanel {
  const found = api().getPanel(panel);
  if (found === undefined) throw new Error(`no panel ${panel}`);
  return found.group;
}

function tabsOf(panel: string): string[] {
  return groupOf(panel).panels.map((candidate) => candidate.id);
}

function box(panel: string): DOMRect {
  return groupOf(panel).element.getBoundingClientRect();
}

/** Open: in the layout, its group shown and with room on screen. */
function isOpen(panel: string): boolean {
  const group = api().getPanel(panel)?.group;
  return group !== undefined && group.api.isVisible && group.element.getBoundingClientRect().height > 0 && group.element.getBoundingClientRect().width > 0;
}

function activity(name: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`.activity-button[aria-label="${name}"]`);
  if (button === null) throw new Error(`no activity button ${name}`);
  return button;
}

function pressedIcons(): string[] {
  return [...document.querySelectorAll<HTMLButtonElement>(".activity-button[aria-pressed=true]")].map((button) => button.getAttribute("aria-label") ?? "");
}

async function click(name: string): Promise<void> {
  activity(name).click();
  await wait(100);
}

function strips(): string[] {
  return [...document.querySelectorAll<HTMLElement>(".workbench-edge")].map((strip) => strip.dataset["edge"] ?? "");
}

/** A mouse drag that starts on whatever is at the point (as a real pointer would), moving in small steps. */
async function drag(x: number, y: number, dx: number, dy: number): Promise<void> {
  const target = document.elementFromPoint(x, y);
  if (target === null) throw new Error("nothing under the pointer");
  const event = (type: string, px: number, py: number): PointerEvent => new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: px, clientY: py, pointerId: 1, isPrimary: true, button: 0,
    buttons: type === "pointerup" ? 0 : 1, pointerType: "mouse",
  });
  target.dispatchEvent(event("pointerdown", x, y));
  const receiver = (): EventTarget => (document.body.contains(target) ? target : document);
  for (let step = 1; step <= 20; step++) {
    receiver().dispatchEvent(event("pointermove", x + dx * step / 20, y + dy * step / 20));
    await wait(16);
  }
  receiver().dispatchEvent(event("pointerup", x + dx, y + dy));
  await wait(200);
}

function workbenchBox(): DOMRect {
  const element = document.querySelector(".workbench");
  if (element === null) throw new Error("no workbench");
  return element.getBoundingClientRect();
}

async function mount(): Promise<Awaited<ReturnType<typeof render>>> {
  const view = await render(<App layoutStorage={storage} />);
  await expect.poll(() => getWorkbench()?.getPanel("map") !== undefined).toBe(true);
  await wait(100);
  return view;
}

/** Remounts the app on the same storage, as a reload does, once the arrangement has been stored. */
async function reload(view: Awaited<ReturnType<typeof render>>): Promise<Awaited<ReturnType<typeof render>>> {
  await expect.poll(() => storage.getItem("terraria-map-studio.layout.v1")?.includes("\"workbench\":{") ?? false).toBe(true);
  await wait(400);
  await view.unmount();
  return mount();
}

test("the default arrangement: side bar, details under it, tables folded below the map", async () => {
  await mount();
  expect(strips()).toEqual(["bottom"]);
  expect(tabsOf("world")).toEqual(["world", "layers", "swatches", "library"]);
  expect(tabsOf("properties")).toEqual(["properties", "history", "measurements"]);
  expect(tabsOf("search")).toEqual(["search", "content", "entities", "bookmarks", "statistics"]);
  expect(isOpen("world")).toBe(true);
  expect(isOpen("properties")).toBe(true);
  expect(isOpen("search")).toBe(false);
  expect(Math.round(box("world").width)).toBe(320);
  expect(pressedIcons()).toEqual(["World", "Properties"]);
  // The map has no tab and nothing docks into its group.
  expect(groupOf("map").header.hidden).toBe(true);
  expect(groupOf("map").locked).toBe(true);
});

test("an icon brings its panel to the front; the panel in front folds its area and the next click restores it", async () => {
  await mount();
  await click("Swatches");
  expect(groupOf("swatches").activePanel?.id).toBe("swatches");
  expect(pressedIcons()).toContain("Swatches");
  expect(pressedIcons()).not.toContain("World");
  const width = box("swatches").width;
  await click("Swatches");
  expect(isOpen("swatches")).toBe(false);
  expect(pressedIcons()).not.toContain("Swatches");
  // The details pane is an area of its own and stays.
  expect(isOpen("properties")).toBe(true);
  await click("Swatches");
  expect(isOpen("swatches")).toBe(true);
  expect(box("swatches").width).toBe(width);
});

test("an icon of a folded area's other panel unfolds the area with that panel in front", async () => {
  await mount();
  await click("World");
  expect(isOpen("world")).toBe(false);
  await click("Library");
  expect(isOpen("library")).toBe(true);
  expect(groupOf("library").activePanel?.id).toBe("library");
});

test("Ctrl+J shows and folds the bottom panel", async () => {
  await mount();
  await userEvent.keyboard("{Control>}j{/Control}");
  await wait(100);
  expect(isOpen("search")).toBe(true);
  expect(pressedIcons()).toContain("Search");
  await userEvent.keyboard("{Control>}j{/Control}");
  await wait(100);
  expect(isOpen("search")).toBe(false);
});

test("P hides every area and shows exactly the ones that were open", async () => {
  await mount();
  await click("History");
  await userEvent.keyboard("p");
  await wait(100);
  expect(isOpen("world")).toBe(false);
  expect(isOpen("history")).toBe(false);
  expect(isOpen("map")).toBe(true);
  await userEvent.keyboard("p");
  await wait(100);
  expect(isOpen("world")).toBe(true);
  expect(isOpen("history")).toBe(true);
  // The bottom panel was folded before P and stays folded.
  expect(isOpen("search")).toBe(false);
});

test("a tab's close button closes the panel; View > Panels reopens it next to the panels it was with", async () => {
  await mount();
  await click("Layers");
  const tab = [...groupOf("layers").element.querySelectorAll<HTMLElement>(".dv-tab")].find((candidate) => candidate.textContent.trim() === "Layers");
  const close = tab?.querySelector<HTMLElement>(".workbench-tab-close");
  if (close === null || close === undefined) throw new Error("the Layers tab has no close button");
  close.click();
  await wait(100);
  expect(api().getPanel("layers")).toBeUndefined();
  expect(pressedIcons()).not.toContain("Layers");
  await menu("View", "Panels");
  await expect.element(page.getByRole("menuitemcheckbox", { name: "Layers", exact: true })).toHaveAttribute("aria-checked", "false");
  await page.getByRole("menuitemcheckbox", { name: "Layers", exact: true }).click();
  await wait(100);
  expect(isOpen("layers")).toBe(true);
  expect(groupOf("layers")).toBe(groupOf("world"));
});

test("a closed panel reopens from its activity icon too, and stays closed across a reload", async () => {
  const view = await mount();
  api().getPanel("statistics")?.api.close();
  await wait(100);
  const reloaded = await reload(view);
  expect(getWorkbench()?.getPanel("statistics")).toBeUndefined();
  await click("Statistics");
  expect(isOpen("statistics")).toBe(true);
  await reloaded.unmount();
});

test("the arrangement, the folded areas and the panel in front survive a reload", async () => {
  const view = await mount();
  await click("Swatches");
  await click("Measurements");
  await click("Measurements");
  expect(isOpen("measurements")).toBe(false);
  await reload(view);
  expect(groupOf("swatches").activePanel?.id).toBe("swatches");
  expect(isOpen("swatches")).toBe(true);
  expect(isOpen("measurements")).toBe(false);
  expect(isOpen("search")).toBe(false);
});

test("View > Reset layout brings back the default arrangement, closed panels included", async () => {
  await mount();
  api().getPanel("library")?.api.close();
  await click("Search");
  await wait(100);
  await menu("View", "Reset layout");
  await wait(200);
  expect(tabsOf("world")).toEqual(["world", "layers", "swatches", "library"]);
  expect(isOpen("search")).toBe(false);
});

test("an area never squeezes below its minimum while its edge is dragged", async () => {
  await mount();
  const side = box("world");
  await drag(side.left, side.top + 200, 130, 0);
  expect(isOpen("world")).toBe(true);
  expect(Math.round(box("world").width)).toBe(220);
  expect(Math.round(box("properties").width)).toBe(220);
});

test("dragging an edge past half the minimum snaps the area shut, and its edge strip pulls it out again", async () => {
  await mount();
  const side = box("world");
  const heights = [box("world").height, box("properties").height];
  await drag(side.left, side.top + 200, 330, 0);
  expect(isOpen("world")).toBe(false);
  expect(isOpen("properties")).toBe(false);
  // The folded bottom panel keeps its own strip.
  expect(strips().sort()).toEqual(["bottom", "right"]);
  expect(pressedIcons()).toEqual([]);
  const bench = workbenchBox();
  await drag(bench.right - 3, bench.top + 200, -300, 0);
  expect(isOpen("world")).toBe(true);
  expect(isOpen("properties")).toBe(true);
  expect(Math.abs(box("world").width - 300)).toBeLessThanOrEqual(4);
  // The column keeps the split it had.
  expect(Math.round(box("world").height)).toBe(Math.round(heights[0] ?? 0));
  expect(Math.round(box("properties").height)).toBe(Math.round(heights[1] ?? 0));
  expect(strips()).toEqual(["bottom"]);
});

test("an area folded by dragging comes back at its earlier size from its icon", async () => {
  await mount();
  const side = box("world");
  await drag(side.left, side.top + 200, 330, 0);
  await click("World");
  expect(Math.round(box("world").width)).toBe(Math.round(side.width));
  expect(isOpen("properties")).toBe(true);
});

test("the bottom edge has a grab zone around its line and the bottom panel snaps and pulls out", async () => {
  await mount();
  await click("Search");
  const bottom = box("search");
  expect(document.elementFromPoint(bottom.left + 200, bottom.top - 2)?.classList.contains("dv-sash")).toBe(true);
  await drag(bottom.left + 200, bottom.top - 2, 0, 200);
  expect(isOpen("search")).toBe(false);
  expect(strips()).toEqual(["bottom"]);
  const bench = workbenchBox();
  await drag(bench.left + 300, bench.bottom - 3, 0, -250);
  expect(isOpen("search")).toBe(true);
  expect(Math.abs(box("search").height - 250)).toBeLessThanOrEqual(4);
});

test("a strip pulls out only the area folded against its own edge, also after a reload", async () => {
  const view = await mount();
  api().getPanel("library")?.api.moveTo({ group: groupOf("map"), position: "left" });
  await wait(200);
  const left = box("library");
  await drag(left.right, left.top + 200, -330, 0);
  const side = box("world");
  await drag(side.left, side.top + 200, 330, 0);
  expect(isOpen("library")).toBe(false);
  expect(isOpen("world")).toBe(false);
  expect(strips().sort()).toEqual(["bottom", "left", "right"]);
  await reload(view);
  expect(strips().sort()).toEqual(["bottom", "left", "right"]);
  const bench = workbenchBox();
  await drag(bench.right - 3, bench.top + 200, -300, 0);
  expect(isOpen("world")).toBe(true);
  expect(isOpen("library")).toBe(false);
  // Without a remembered split the column shares its height evenly.
  expect(Math.abs(box("world").height - box("properties").height)).toBeLessThanOrEqual(2);
  await drag(bench.left + 3, bench.top + 200, 260, 0);
  expect(isOpen("library")).toBe(true);
});

test("a tab's menu moves, floats, pops out and closes; a floating panel's icon only brings it forward", async () => {
  await mount();
  await click("Layers");
  const tab = [...groupOf("layers").element.querySelectorAll<HTMLElement>(".dv-tab")].find((candidate) => candidate.textContent.trim() === "Layers");
  if (tab === undefined) throw new Error("no Layers tab");
  tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: tab.getBoundingClientRect().left + 5, clientY: tab.getBoundingClientRect().top + 5 }));
  await wait(100);
  const items = [...document.querySelectorAll<HTMLElement>(".dv-context-menu-item, [role=menuitem]")].map((item) => item.textContent.trim());
  for (const label of ["Move to side bar", "Move to details", "Move to bottom panel", "Float", "Open in New Window", "Close"]) expect(items).toContain(label);
  await userEvent.keyboard("{Escape}");
  api().addFloatingGroup(api().getPanel("layers") ?? groupOf("layers"));
  await wait(100);
  expect(groupOf("layers").api.location.type).toBe("floating");
  await click("Layers");
  await click("Layers");
  expect(groupOf("layers").api.isVisible).toBe(true);
});

test("Move to bottom panel docks a panel with the tables, as the keyboard path for docking", async () => {
  await mount();
  await click("Search");
  const items = (await import("../src/shell/workbench-api.js"));
  items.movePanel("library", "bottom");
  await wait(100);
  expect(groupOf("library")).toBe(groupOf("search"));
});

test("Show measurements opens the Measurements panel", async () => {
  await mount();
  await click("Properties");
  expect(isOpen("measurements")).toBe(false);
  showMeasurements();
  await wait(100);
  expect(isOpen("measurements")).toBe(true);
  expect(groupOf("measurements").activePanel?.id).toBe("measurements");
});
