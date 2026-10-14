import { afterEach, expect, test, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import axe from "axe-core";
import { createWorld } from "@studio/world-model";
import { packSheets, terrariaItems } from "@studio/assets";
import { readWorldEntities } from "@studio/world-codec";
import { buildChestItemIndex } from "../src/world/chest-search.js";
import { ChestDialog } from "../src/panels/ChestDialog.js";
import { MapView } from "../src/components/MapView.js";
import { useCommands, useGlobalShortcuts } from "../src/shell/commands.js";
import { useChestNavigation } from "../src/world/chest-navigation.js";
import { getDefaultWorldSession, resetDefaultWorldSession } from "../src/world/world-session.js";
import { EntitiesPanel } from "../src/panels/EntitiesPanel.js";
import { hydrateLayout } from "../src/shell/layout-store.js";
import { getMapController, registerMapController, useViewStore } from "../src/shell/view-store.js";
import { createAssetSession, setDefaultAssetSession, useAssetStore } from "../src/assets/asset-session.js";
import "../src/styles.css";
import "./support/commands.js";

afterEach(() => { registerMapController(null); setDefaultAssetSession(undefined); useAssetStore.setState({ status: { kind: "none" } }); useViewStore.getState().setPinnedTile(null); useChestNavigation.setState({ query: "", areas: [], selected: null }); });

const mining = { x: 12, y: 18, name: "Mining supplies", slotCount: 40, items: [{ slot: 2, itemId: 8, stack: 15, prefix: 0 }] };
const lights = { x: 32, y: 18, name: "Spare lights", slotCount: 40, items: [{ slot: 39, itemId: 8, stack: 25, prefix: 0 }] };
const empty = { x: 52, y: 18, name: "", slotCount: 40, items: [] };

function chestWorld(): ReturnType<typeof createWorld> {
  const world = createWorld(80, 40);
  for (const chest of [mining, lights, empty]) for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) world.setTile(chest.x + dx, chest.y + dy, { block: { kind: "vanilla", id: 21 }, frameX: dx * 18, frameY: dy * 18, wires: 0, actuator: false });
  return world;
}

test("Entities lists counts, centres rows, pins on Enter, and finds Torch stacks", async () => {
  hydrateLayout(null);
  const tiles = chestWorld();
  const centerOn = vi.fn();
  registerMapController({ centerOn, fitWorld: vi.fn(), actualSize: vi.fn(), zoomTo: vi.fn(), jumpTo: vi.fn(), renderNow: vi.fn(), stats: () => { throw new Error("No stats requested"); } });
  await render(<EntitiesPanel source={{ width: tiles.width, height: tiles.height, chests: [mining, lights, empty], tileAt: (x, y) => tiles.tileAt(x, y) }} />);
  await expect.element(page.getByRole("grid", { name: "Chests" })).toBeVisible();
  await page.getByRole("row").filter({ hasText: "Mining supplies" }).click();
  expect(centerOn).toHaveBeenCalledWith(13, 19);
  await userEvent.keyboard("{Enter}");
  expect(useViewStore.getState().pinnedTile).toEqual({ x: 12, y: 18 });
  await page.getByRole("textbox", { name: "Items in chests" }).fill("torch");
  await expect.element(page.getByText("Torch: 40 in 2 chests")).toBeVisible();
  await expect.element(page.getByRole("grid", { name: "Matching chests" })).toBeVisible();
  await page.getByRole("grid", { name: "Matching chests" }).getByRole("row").filter({ hasText: "Spare lights" }).click();
  expect(useViewStore.getState().pinnedTile).toEqual({ x: 32, y: 18 });
  await userEvent.keyboard("{Enter}");
});

test("a chest draws connected inventory pixels, labels all slots and passes axe", async () => {
  hydrateLayout(null);
  const frame = terrariaItems.items[8]?.frame;
  if (frame === null || frame === undefined) throw new Error("Torch inventory frame missing");
  const rgba = new Uint8Array(frame.width * frame.height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) rgba.set([232, 174, 52, 255], offset);
  const atlas = packSheets([{ kind: "item", id: 8, width: frame.width, height: frame.height, rgba }], { pageSize: 256 });
  const result = { atlas, fingerprint: "local-terraria-inventory", missing: [], fromCache: false };
  const session = createAssetSession({ builder: { build: () => Promise.resolve(result), loadCached: () => Promise.resolve(null), clearCache: () => Promise.resolve() }, remembered: { load: () => Promise.resolve(null), save: () => Promise.resolve(), forget: () => Promise.resolve() }, pickDirectory: null, openFolderInput: () => undefined });
  setDefaultAssetSession(session);
  await session.connectFiles([new File(["Terraria Content"], "Item_8.xnb")]);
  await render(<ChestDialog chest={mining} title="Chest" onClose={() => undefined} />);
  await expect.poll(() => document.querySelectorAll(".chest-item-sprite").length).toBe(1);
  const canvas = document.querySelector<HTMLCanvasElement>(".chest-item-sprite");
  expect([...(canvas?.getContext("2d")?.getImageData(0, 0, 1, 1).data ?? [])]).toEqual([232, 174, 52, 255]);
  expect(document.querySelectorAll(".chest-slot")).toHaveLength(40);
  expect((await axe.run(document.querySelector("dialog") ?? document.body)).violations).toEqual([]);
});

test("closing a world removes its decoded chest rows and cannot republish its old search highlights", async () => {
  const bytes = Uint8Array.from(atob(await commands.readWorldFixture("SCCO1.wld")), (character) => character.charCodeAt(0));
  await getDefaultWorldSession().open(new File([bytes], "SCCO1.wld"));
  await render(<EntitiesPanel />);
  await page.getByRole("textbox", { name: "Items in chests" }).fill("Torch");
  await expect.element(page.getByText("Torch: 995 in 51 chests")).toBeVisible();
  resetDefaultWorldSession();
  await expect.element(page.getByRole("grid", { name: "Chests" })).not.toBeInTheDocument();
  await expect.element(page.getByText("Open a world to inspect its chests.")).toBeVisible();
  expect(useChestNavigation.getState().areas).toEqual([]);
});

function SearchShortcuts(): null { useGlobalShortcuts(useCommands()); return null; }

test("search highlights two chest footprints on the GPU, overview markers survive zoom and F3 steps both ways", async () => {
  hydrateLayout(null);
  const world = chestWorld();
  await render(<><SearchShortcuts /><div style={{ position: "relative", width: 640, height: 320 }}><MapView renderer="@studio/renderer" world={{ ...world, surfaceY: 10 }} /></div><EntitiesPanel source={{ width: world.width, height: world.height, chests: [mining, lights, empty], tileAt: (x, y) => world.tileAt(x, y) }} /></>);
  await expect.poll(() => getMapController()).not.toBeNull();
  await page.getByRole("textbox", { name: "Items in chests" }).fill("8");
  await expect.poll(() => useChestNavigation.getState().areas.length).toBe(2);
  const controller = getMapController();
  if (controller === null) throw new Error("Map controller was not mounted");
  controller.jumpTo({ x: 0, y: 0, zoom: 8 });
  await new Promise((resolve) => requestAnimationFrame(resolve));
  controller.renderNow();
  const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="World map"]');
  const gl = canvas?.getContext("webgl2");
  if (canvas === null || gl === null || gl === undefined) throw new Error("WebGL map is missing");
  const pixel = (x: number, y: number): number[] => { const rgba = new Uint8Array(4); gl.readPixels(x, canvas.height - y - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba); return [...rgba]; };
  expect(pixel(12 * 8, 19 * 8)[0]).toBeGreaterThan(240);
  expect(pixel(32 * 8, 19 * 8)[0]).toBeGreaterThan(240);
  expect(pixel(52 * 8, 19 * 8)[0]).toBeLessThan(240);
  // Function keys also work while the query field has focus.
  await userEvent.keyboard("{F3}");
  expect(useViewStore.getState().pinnedTile).toEqual({ x: 12, y: 18 });
  await expect.element(page.getByRole("grid", { name: "Matching chests" }).getByRole("row").filter({ hasText: "Mining supplies" })).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{F3}");
  expect(useViewStore.getState().pinnedTile).toEqual({ x: 32, y: 18 });
  await expect.element(page.getByRole("grid", { name: "Matching chests" }).getByRole("row").filter({ hasText: "Spare lights" })).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Shift>}{F3}{/Shift}");
  expect(useViewStore.getState().pinnedTile).toEqual({ x: 12, y: 18 });
  useChestNavigation.setState({ selected: null });
  controller.jumpTo({ x: 0, y: 0, zoom: 0.5 });
  await new Promise((resolve) => requestAnimationFrame(resolve));
  controller.renderNow();
  // World centring can clamp the camera; read it back before locating the marker.
  const camera = JSON.parse(canvas.dataset["camera"] ?? "{}") as { x: number; y: number; zoom: number };
  const density = canvas.width / canvas.clientWidth;
  const reds: number[] = [];
  for (let offsetX = -3; offsetX <= 3; offsetX++) for (let offsetY = -3; offsetY <= 3; offsetY++) reds.push(pixel(Math.floor((13 - camera.x) * camera.zoom + offsetX * density), Math.floor((19 - camera.y) * camera.zoom + offsetY * density))[0] ?? 0);
  expect(Math.max(...reds)).toBeGreaterThan(240);
});

test("SCCO1's actual Entities table retains all 190 records and renders recorded empty and populated counts", async () => {
  const bytes = Uint8Array.from(atob(await commands.readWorldFixture("SCCO1.wld")), (character) => character.charCodeAt(0));
  await getDefaultWorldSession().open(new File([bytes], "SCCO1.wld"));
  await render(<EntitiesPanel mode="entities" />);
  const table = page.getByRole("grid", { name: "Chests" });
  await expect.element(table).toHaveAttribute("aria-rowcount", "191");
  await expect.element(table.getByRole("row").filter({ hasText: "2655, 1072" })).toMatchTextContent("0/40");
  await expect.element(table.getByRole("row").filter({ hasText: "3708, 651" })).toMatchTextContent("7/40");
  const populated = document.querySelector('[id$="-row-2"]');
  expect([...populated?.querySelectorAll('[role="gridcell"]') ?? []].map((cell) => cell.textContent)).toContain("71");
  await table.click();
  await userEvent.keyboard("{End}");
  await expect.poll(() => document.querySelector('[id$="-row-189"]')).not.toBeNull();
  const last = getDefaultWorldSession().getLoadedWorld()?.entities.Chests.data?.entries[189];
  if (last === undefined) throw new Error("SCCO1 final chest missing");
  const cells = [...document.querySelector('[id$="-row-189"]')?.querySelectorAll('[role="gridcell"]') ?? []].map((cell) => cell.textContent);
  expect(cells).toContain(`${String(last.items.length)}/40`);
  expect(cells).toContain(String(last.items.reduce((sum, item) => sum + item.stack, 0)));
  resetDefaultWorldSession();
});

test("real idle indexing of the largest corpus chest collection creates no 50 ms long task", { tags: ["perf"] }, async () => {
  const bytes = Uint8Array.from(atob(await commands.readWorldFixture("SCCO1.wld")), (character) => character.charCodeAt(0));
  const entries = readWorldEntities(bytes).Chests.data?.entries;
  if (entries === undefined) throw new Error("SCCO1 chest section missing");
  const tasks: PerformanceEntry[] = [];
  const observer = new PerformanceObserver((list) => { tasks.push(...list.getEntries()); });
  observer.observe({ type: "longtask" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const start = performance.now();
  await buildChestItemIndex(entries);
  const end = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 0));
  tasks.push(...observer.takeRecords()); observer.disconnect();
  expect(Math.max(0, ...tasks.filter((task) => task.startTime >= start && task.startTime < end).map((task) => task.duration))).toBeLessThan(50);
});

test("list item inspection updates the same name and ID detail as the grid", async () => {
  hydrateLayout(null);
  const chest = { ...mining, items: [...mining.items, { slot: 39, itemId: 22, stack: 12, prefix: 0 }] };
  await render(<ChestDialog chest={chest} title="Chest" onClose={() => undefined} />);
  await page.getByRole("button", { name: "List view" }).click();
  await page.getByRole("row").filter({ hasText: "Iron Bar" }).hover();
  await expect.element(page.getByText("Iron Bar × 12 · Item ID 22", { exact: true })).toBeVisible();
});
