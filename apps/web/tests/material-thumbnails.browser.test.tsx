import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { packSheets } from "@studio/assets";
import { MaterialSwatch } from "../src/panels/material-swatch.js";
import { getDefaultAssetSession, useAssetStore } from "../src/assets/asset-session.js";
import { ThumbnailSource } from "../src/assets/thumbnails.js";
import { readWorldTiles } from "@studio/world-codec";
import { BRUSH_LAYER, createWorld } from "@studio/world-model";
import { SwatchesPanel, useSwatchesView } from "../src/panels/SwatchesPanel.js";
import { ToolOptions } from "../src/shell/ToolOptions.js";
import { InspectorPanel } from "../src/panels/InspectorPanel.js";
import { setBrushWorld, useBrushStore } from "../src/world/brush-session.js";
import { useViewStore } from "../src/shell/view-store.js";
import { brushSource } from "./support/brush-source.js";
import "../src/styles.css";

const ready = { kind: "ready", folderName: "Terraria Content", tileSheets: 1, wallSheets: 1, pages: 1, fromCache: false, missing: [] } as const;

function connect(): void {
  const rgba = new Uint8Array(288 * 270 * 4).fill(255);
  const atlas = packSheets([
    { kind: "tile", id: 0, width: 288, height: 270, rgba },
    { kind: "wall", id: 1, width: 468, height: 468, rgba: new Uint8Array(468 * 468 * 4).fill(255) },
  ], { pageSize: 1024 });
  vi.spyOn(getDefaultAssetSession(), "getAtlas").mockReturnValue(atlas);
  useAssetStore.setState({ status: ready });
}

afterEach(() => { useAssetStore.setState({ status: { kind: "none" } }); setBrushWorld(null); useViewStore.setState({ pinnedTile: null, tool: "pan" }); vi.restoreAllMocks(); });

test("fallback, paint and accessible names survive connecting and disconnecting assets", async () => {
  const screen = await render(<button aria-label="Dirt Block"><MaterialSwatch color={0x976b4b} layer="block" content={{ kind: "vanilla", id: 0 }} paint={0xff0000} /></button>);
  const swatch = screen.container.querySelector<HTMLElement>(".material-swatch");
  expect(swatch?.style.backgroundColor).toBe("rgb(151, 107, 75)");
  expect(swatch?.querySelector("canvas")).toBeNull();
  await act(() => { connect(); });
  await expect.poll(() => swatch?.querySelector("canvas")).not.toBeNull();
  expect(swatch?.querySelector<HTMLElement>(".material-swatch-paint")?.style.borderTopColor).toBe("rgb(255, 0, 0)");
  await expect.element(page.getByRole("button", { name: "Dirt Block", exact: true })).toBeVisible();
  await act(() => { useAssetStore.setState({ status: { kind: "none" } }); });
  expect(swatch?.querySelector("canvas")).toBeNull();
  expect(swatch?.style.backgroundColor).toBe("rgb(151, 107, 75)");
});

test("only visible swatches build, scrolling and rerender reuse the same pixels", async () => {
  const material = vi.spyOn(ThumbnailSource.prototype, "material");
  connect();
  const content = { kind: "vanilla", id: 0 } as const;
  const view = (tick: number) => <div data-tick={tick} style={{ height: 32, overflow: "auto" }}>
    <MaterialSwatch color={0x976b4b} layer="block" content={content} />
    <div style={{ height: 1200 }} />
    <MaterialSwatch color={0x976b4b} layer="wall" content={{ kind: "vanilla", id: 1 }} />
  </div>;
  const screen = await render(view(0));
  await expect.poll(() => screen.container.querySelectorAll("canvas").length).toBe(1);
  expect(material.mock.calls.map(([layer]) => layer)).toEqual(["block"]);
  const pixels = screen.container.querySelector("canvas");
  await screen.rerender(view(1));
  expect(screen.container.querySelector("canvas")).toBe(pixels);
  const scroll = screen.container.firstElementChild;
  if (!(scroll instanceof HTMLElement)) throw new Error("Swatch scroll container missing");
  scroll.scrollTop = scroll.scrollHeight;
  await expect.poll(() => screen.container.querySelectorAll("canvas").length).toBe(2);
  scroll.scrollTop = 0;
  expect(material).toHaveBeenCalledTimes(2);
});

test("Swatches, Brush chips and Inspector switch together without changing their names", async () => {
  setBrushWorld(readWorldTiles(brushSource()));
  useBrushStore.setState({ blockId: 0, wallId: 1, layer: BRUSH_LAYER.both });
  useViewStore.setState({ tool: "brush", pinnedTile: { x: 1, y: 1 } });
  useSwatchesView.setState({ category: "block", source: "all", query: "Dirt Block" });
  const world = createWorld(3, 3);
  world.setTile(1, 1, { block: { kind: "vanilla", id: 0 }, wall: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  const screen = await render(<><SwatchesPanel /><ToolOptions /><InspectorPanel world={{ width: 3, height: 3, tileAt: (x, y) => world.tileAt(x, y), framingWorld: world }} /></>);
  const names = [...screen.container.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.textContent);
  expect(screen.container.querySelectorAll("canvas")).toHaveLength(0);
  await act(() => { connect(); });
  await expect.poll(() => screen.container.querySelectorAll("canvas").length).toBe(5);
  expect([...screen.container.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual(names);
  await act(() => { useSwatchesView.setState({ category: "wall", query: "Stone Wall" }); });
  await expect.poll(() => screen.container.querySelectorAll(".swatch-button canvas").length).toBe(1);
  await act(() => { useAssetStore.setState({ status: { kind: "none" } }); });
  expect(screen.container.querySelectorAll("canvas")).toHaveLength(0);
});

test("missing sheets and an unconnected atlas keep the checkerboard and wall shape", async () => {
  connect();
  const screen = await render(<MaterialSwatch color={null} layer="wall" content={{ kind: "vanilla", id: 2 }} />);
  const swatch = screen.container.querySelector<HTMLElement>(".material-swatch");
  await expect.poll(() => getComputedStyle(swatch ?? screen.container).borderRadius).toBe("50%");
  expect(swatch?.dataset["empty"]).toBe("true");
  expect(swatch?.querySelector("canvas")).toBeNull();
});
