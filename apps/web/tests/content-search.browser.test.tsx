import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import axe from "axe-core";
import { ContentPanel, type ContentWorld } from "../src/panels/ContentPanel.js";
import { SearchPanel } from "../src/panels/search/SearchPanel.js";
import { hydrateLayout } from "../src/shell/layout-store.js";
import { registerMapController, useViewStore } from "../src/shell/view-store.js";
import { clearSearch, useSearchStore } from "../src/world/search-store.js";
import { GO_TO_ZOOM } from "../src/world/chest-navigation.js";
import "../src/styles.css";

const NONE = 0xffff;

/** 4 × 3 world, column-major: stone (palette 0) at (0,0) (0,1) (1,2) (3,2); dirt (palette 1) at (1,0) (2,0) (2,1) (2,2). */
const world: ContentWorld & { width: number; height: number } = {
  width: 4,
  height: 3,
  planes: {
    block: Uint16Array.from([0, 0, NONE, 1, NONE, 0, 1, 1, 1, NONE, NONE, 0]),
    wall: Uint16Array.from([0, NONE, 2, 2, NONE, NONE, 0, NONE, NONE, NONE, 2, NONE]),
    liquid: Uint8Array.from([0, 1, 1, 0, 2, 0, 0, 3, 4, 4, 4, 0]),
  },
  palette: [{ kind: "vanilla", id: 1 }, { kind: "vanilla", id: 0 }, { kind: "unknown", runtimeId: 9 }],
};

const goTo = vi.fn();
beforeEach(() => {
  hydrateLayout(null);
  goTo.mockReset();
  registerMapController({ centerOn: vi.fn(), goTo, fitWorld: vi.fn(), actualSize: vi.fn(), zoomTo: vi.fn(), jumpTo: vi.fn(), renderNow: vi.fn(), stats: () => { throw new Error("No stats requested"); } });
  useSearchStore.setState({ scope: "content", dim: true });
  clearSearch();
});
afterEach(() => { registerMapController(null); clearSearch(); useViewStore.getState().setPinnedTile(null); });

test("a content query lists matching entries with exact counts, highlights them and steps through their tiles", async () => {
  await render(<SearchPanel content={world} />);
  const box = page.getByRole("searchbox", { name: "Search Content" });
  await box.fill("stone");
  // Stone as block (4 tiles) and as wall (2 tiles).
  await expect.element(page.getByText("2 entries: 6 tiles")).toBeVisible();
  expect(useSearchStore.getState().highlight).toEqual({ blocks: [0], walls: [0], liquids: [] });
  await page.getByRole("list", { name: "Matching content" }).getByRole("button", { name: /Block/ }).click();
  await expect.element(page.getByText(/^Stone Block: 4 tiles/)).toBeVisible();
  expect(useSearchStore.getState().highlight).toEqual({ blocks: [0], walls: [], liquids: [] });
  await expect.poll(() => useSearchStore.getState().stepIndex?.total).toBe(4);
  await box.click();
  await userEvent.keyboard("{Enter}");
  expect(goTo).toHaveBeenLastCalledWith(0.5, 0.5, GO_TO_ZOOM);
  await expect.element(page.getByText("Stone Block: 4 tiles · 1 of 4")).toBeVisible();
  await userEvent.keyboard("{Enter}");
  // (0,1) continues the run at (0,0); the next run starts at (1,2), the third stone tile.
  expect(goTo).toHaveBeenLastCalledWith(1.5, 2.5, GO_TO_ZOOM);
  await expect.element(page.getByText("Stone Block: 4 tiles · 3 of 4")).toBeVisible();
  await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
  expect(goTo).toHaveBeenLastCalledWith(0.5, 0.5, GO_TO_ZOOM);
  expect((await axe.run(document.querySelector(".search-panel") ?? document.body)).violations).toEqual([]);
  await userEvent.keyboard("{Escape}");
  expect(useSearchStore.getState().query).toBe("");
  expect(useSearchStore.getState().highlight).toBeNull();
});

test("Enter on a Content row finds that entry on the map and goes to its first tile", async () => {
  await render(<><ContentPanel world={world} /><SearchPanel content={world} /></>);
  const table = page.getByRole("grid", { name: "Content" });
  await table.getByRole("row").filter({ hasText: "Dirt" }).filter({ hasText: "Block" }).click();
  expect(useSearchStore.getState().highlight).toBeNull();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => goTo.mock.calls.length).toBe(1);
  expect(goTo).toHaveBeenLastCalledWith(1.5, 0.5, GO_TO_ZOOM);
  expect(useSearchStore.getState()).toMatchObject({ scope: "content", contentFilter: "block:1", highlight: { blocks: [1], walls: [], liquids: [] } });
  await expect.element(page.getByRole("searchbox", { name: "Search Content" })).toHaveValue("Dirt Block");
});
