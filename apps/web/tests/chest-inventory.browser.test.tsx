import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import axe from "axe-core";
import { createWorld } from "@studio/world-model";
import { packSheets, terrariaItems } from "@studio/assets";
import { ChestDialog } from "../src/panels/ChestDialog.js";
import { EntitiesPanel } from "../src/panels/EntitiesPanel.js";
import { hydrateLayout } from "../src/shell/layout-store.js";
import { registerMapController, useViewStore } from "../src/shell/view-store.js";
import { createAssetSession, setDefaultAssetSession, useAssetStore } from "../src/assets/asset-session.js";
import "../src/styles.css";

afterEach(() => { registerMapController(null); setDefaultAssetSession(undefined); useAssetStore.setState({ status: { kind: "none" } }); useViewStore.getState().setPinnedTile(null); });

const mining = { x: 12, y: 18, name: "Mining supplies", slotCount: 40, items: [{ slot: 2, itemId: 8, stack: 15, prefix: 0 }] };
const lights = { x: 32, y: 18, name: "Spare lights", slotCount: 40, items: [{ slot: 39, itemId: 8, stack: 25, prefix: 0 }] };
const empty = { x: 52, y: 18, name: "", slotCount: 40, items: [] };

test("Entities lists counts, centres rows, pins on Enter, and finds Torch stacks", async () => {
  hydrateLayout(null);
  const tiles = createWorld(80, 40);
  const centerOn = vi.fn();
  registerMapController({ centerOn, fitWorld: vi.fn(), actualSize: vi.fn(), zoomTo: vi.fn(), jumpTo: vi.fn(), renderNow: vi.fn(), stats: () => { throw new Error("No stats requested"); } });
  await render(<EntitiesPanel source={{ chests: [mining, lights, empty], tileAt: (x, y) => tiles.tileAt(x, y) }} />);
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
