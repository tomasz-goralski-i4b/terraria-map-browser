import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import axe from "axe-core";
import { ContentPanel, type ContentWorld } from "../src/panels/ContentPanel.js";
import { SearchPanel } from "../src/panels/search/SearchPanel.js";
import { hydrateLayout } from "../src/shell/layout-store.js";
import { getMapController, registerMapController, useViewStore } from "../src/shell/view-store.js";
import { createWorld } from "@studio/world-model";
import { MapView } from "../src/components/MapView.js";
import { clearSearch, findContentOnMap, HIGHLIGHT_DELAY_MS, openSearch, stepSearch, useSearchStore } from "../src/world/search-store.js";
import { useCommands, useGlobalShortcuts } from "../src/shell/commands.js";
import { StatusBar } from "../src/shell/StatusBar.js";
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
  // The map follows only once typing rests, so it does not flash per keystroke.
  expect(useSearchStore.getState().highlight).toBeNull();
  await expect.poll(() => useSearchStore.getState().highlight).toEqual({ blocks: [0], walls: [0], liquids: [] });
  await page.getByRole("list", { name: "Matching content" }).getByRole("button", { name: /Block/ }).click();
  await expect.element(page.getByText(/^Stone Block: 4 tiles/)).toBeVisible();
  expect(useSearchStore.getState().highlight).toEqual({ blocks: [0], walls: [], liquids: [] });
  // Narrowing applies at once. Stops are vertical runs: (0,0)–(0,1), (1,2) and (3,2).
  expect(useSearchStore.getState().highlight).toEqual({ blocks: [0], walls: [], liquids: [] });
  await expect.poll(() => useSearchStore.getState().stepIndex?.total).toBe(3);
  await box.click();
  await userEvent.keyboard("{Enter}");
  expect(goTo).toHaveBeenLastCalledWith(0.5, 0.5, GO_TO_ZOOM);
  await expect.element(page.getByText("Stone Block: 4 tiles · match 1 of 3")).toBeVisible();
  await userEvent.keyboard("{Enter}");
  // (0,1) continues the run at (0,0); the next run starts at (1,2).
  expect(goTo).toHaveBeenLastCalledWith(1.5, 2.5, GO_TO_ZOOM);
  await expect.element(page.getByText("Stone Block: 4 tiles · match 2 of 3")).toBeVisible();
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

test("a content search outlines its tiles on the GPU map and dims the rest until it is cleared", async () => {
  registerMapController(null);
  const tiles = createWorld(40, 20);
  for (let x = 0; x < 40; x++) for (let y = 10; y < 20; y++) tiles.setTile(x, y, { block: { kind: "vanilla", id: x >= 20 && x < 24 && y >= 12 && y < 16 ? 1 : 0 }, wires: 0, actuator: false });
  const world = { ...tiles, surfaceY: 5 };
  await render(<><div style={{ position: "relative", width: 640, height: 320 }}><MapView renderer="@studio/renderer" world={world} /></div><SearchPanel content={world} /></>);
  await expect.poll(() => getMapController()).not.toBeNull();
  const controller = getMapController();
  const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="World map"]');
  const gl = canvas?.getContext("webgl2");
  if (controller === null || canvas === null || gl === null || gl === undefined) throw new Error("WebGL map is missing");
  // A tile's pixel (fractions of a tile inside it); world centring can clamp the camera, so it is read back.
  const pixel = (tileX: number, tileY: number): number[] => {
    const camera = JSON.parse(canvas.dataset["camera"] ?? "{}") as { x: number; y: number; zoom: number };
    const x = Math.floor((tileX - camera.x) * camera.zoom), y = Math.floor((tileY - camera.y) * camera.zoom);
    const rgba = new Uint8Array(4); gl.readPixels(x, canvas.height - y - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba); return [...rgba];
  };
  const draw = async (): Promise<void> => { controller.jumpTo({ x: 0, y: 0, zoom: 8 }); await new Promise((resolve) => requestAnimationFrame(resolve)); controller.renderNow(); };
  await draw();
  const dirt = pixel(4.5, 12.5);
  await page.getByRole("searchbox", { name: "Search Content" }).fill("stone block");
  await expect.poll(() => useSearchStore.getState().highlight).toEqual({ blocks: [expect.any(Number)], walls: [], liquids: [] });
  await draw();
  // The stone's left edge is outlined in the highlight colour; dirt away from it is darkened.
  expect(pixel(20.05, 13.5).slice(0, 3)).toEqual([255, 214, 64]);
  const dimmed = pixel(4.5, 12.5);
  expect(dimmed[0] ?? 0).toBeLessThan((dirt[0] ?? 0) * 0.6);
  // F3 frames the match it went to in white, over the yellow outlines of the others.
  stepSearch(1);
  await expect.poll(() => useSearchStore.getState().position).toMatchObject({ x: 20, y: 12 });
  await draw();
  expect(pixel(20.02, 12.5).slice(0, 3)).toEqual([255, 255, 255]);
  expect(pixel(20.02, 13.5).slice(0, 3)).toEqual([255, 214, 64]);
  await userEvent.keyboard("{Escape}");
  await draw();
  expect(pixel(4.5, 12.5)).toEqual(dirt);
});

function Shortcuts(): null { useGlobalShortcuts(useCommands()); return null; }

test("Enter typed before the matches are shown still goes to the first one, and F3 steps globally with wrap", async () => {
  await render(<><Shortcuts /><SearchPanel content={world} /><StatusBar world={null} /></>);
  const box = page.getByRole("searchbox", { name: "Search Content" });
  await box.fill("dirt block");
  // Before the highlight delay has passed: the step waits for the index instead of being lost.
  await userEvent.keyboard("{Enter}");
  expect(goTo).not.toHaveBeenCalled();
  await expect.poll(() => goTo.mock.calls.length).toBe(1);
  expect(goTo).toHaveBeenLastCalledWith(1.5, 0.5, GO_TO_ZOOM);
  await expect.element(page.getByTestId("search-position")).toHaveTextContent("1 of 2 matches");
  // Dirt runs: (1,0) and (2,0)–(2,2). F3 from the box, then wrap around.
  await userEvent.keyboard("{F3}");
  expect(goTo).toHaveBeenLastCalledWith(2.5, 0.5, GO_TO_ZOOM);
  await userEvent.keyboard("{F3}");
  expect(goTo).toHaveBeenLastCalledWith(1.5, 0.5, GO_TO_ZOOM);
  await userEvent.keyboard("{Shift>}{F3}{/Shift}");
  expect(goTo).toHaveBeenLastCalledWith(2.5, 0.5, GO_TO_ZOOM);
});

test("Find focuses the box, while the section mounting again keeps focus, the index and the position", async () => {
  const { rerender } = await render(<><button type="button">Elsewhere</button><SearchPanel content={world} /></>);
  openSearch();
  await expect.element(page.getByRole("searchbox", { name: "Search Content" })).toHaveFocus();
  await page.getByRole("searchbox", { name: "Search Content" }).fill("stone block");
  await expect.poll(() => useSearchStore.getState().stepIndex?.total).toBe(3);
  stepSearch(1); stepSearch(1);
  const index = useSearchStore.getState().stepIndex;
  // Collapsing the section unmounts it; the map keeps its highlight and F3 keeps working.
  await rerender(<><button type="button">Elsewhere</button></>);
  expect(useSearchStore.getState().highlight).not.toBeNull();
  await page.getByRole("button", { name: "Elsewhere" }).click();
  await rerender(<><button type="button">Elsewhere</button><SearchPanel content={world} /></>);
  await new Promise((resolve) => setTimeout(resolve, HIGHLIGHT_DELAY_MS + 100));
  await expect.element(page.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  expect(useSearchStore.getState().stepIndex).toBe(index);
  expect(useSearchStore.getState().position).toMatchObject({ ordinal: 2 });
});

test("Find on map for the same entry again goes back to its first match", async () => {
  await render(<SearchPanel content={world} />);
  findContentOnMap("Dirt Block", "block:1");
  await expect.poll(() => goTo.mock.calls.length).toBe(1);
  stepSearch(1);
  expect(goTo).toHaveBeenLastCalledWith(2.5, 0.5, GO_TO_ZOOM);
  findContentOnMap("Dirt Block", "block:1");
  expect(goTo).toHaveBeenLastCalledWith(1.5, 0.5, GO_TO_ZOOM);
  expect(useSearchStore.getState().stepPending).toBe(0);
});
