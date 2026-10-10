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
import * as blockFraming from "../src/world/block-framing.js";
import { PropertyGrid } from "../src/ui/PropertyGrid.js";
import * as thumbnailSession from "../src/assets/thumbnail-session.js";
import "../src/styles.css";

vi.mock("../src/world/block-framing.js", { spy: true });
vi.mock("../src/assets/thumbnail-session.js", { spy: true });

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

/** Let visibility notifications and both idle stages complete before checking for unwanted extra work. */
async function settleThumbnails(): Promise<void> {
  await new Promise<void>((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
  await new Promise<void>((resolve) => { requestIdleCallback(() => { resolve(); }, { timeout: 300 }); });
  await new Promise<void>((resolve) => { requestIdleCallback(() => { resolve(); }, { timeout: 300 }); });
}

afterEach(() => {
  useAssetStore.setState({ status: { kind: "none" } });
  setBrushWorld(null);
  useViewStore.setState({ pinnedTile: null, tool: "pan" });
  useViewStore.getState().setLayers({ sprites: true });
  vi.restoreAllMocks();
  vi.mocked(blockFraming.getBlockFraming).mockReset();
  vi.mocked(thumbnailSession.getThumbnailSource).mockReset();
});

test("Swatches tooltips anchor to the hovered material instead of the panel", async () => {
  setBrushWorld(readWorldTiles(brushSource()));
  useSwatchesView.setState({ category: "block", source: "all", mode: "grid", query: "" });
  const screen = await render(<div style={{ width: 320 }}><SwatchesPanel /></div>);
  const dirt = page.getByRole("button", { name: "Dirt Block", exact: true });
  await dirt.hover();
  const button = screen.container.querySelector<HTMLElement>('.swatch-button[aria-label="Dirt Block"]');
  if (button === null) throw new Error("Dirt Block swatch missing");
  expect(getComputedStyle(button).position).toBe("relative");
  const tooltip = getComputedStyle(button, "::after");
  expect(tooltip.content).toContain("Dirt Block");
  expect(tooltip.position).toBe("absolute");
  expect(parseFloat(tooltip.bottom)).toBeCloseTo(button.getBoundingClientRect().height + 6, 0);
});

test("fallback, paint and accessible names survive connecting and disconnecting assets", async () => {
  const screen = await render(<button aria-label="Dirt Block"><MaterialSwatch color={0x976b4b} layer="block" content={{ kind: "vanilla", id: 0 }} paint={0xff0000} /></button>);
  const swatch = screen.container.querySelector<HTMLElement>(".material-swatch");
  expect(swatch?.style.backgroundColor).toBe("rgb(151, 107, 75)");
  expect(swatch?.querySelector("canvas")).toBeNull();
  await act(async () => { connect(); await Promise.resolve(); });
  await expect.poll(() => swatch?.querySelector("canvas")).not.toBeNull();
  expect(swatch?.querySelector<HTMLElement>(".material-swatch-paint")?.style.borderTopColor).toBe("rgb(255, 0, 0)");
  await expect.element(page.getByRole("button", { name: "Dirt Block", exact: true })).toBeVisible();
  await act(async () => { useAssetStore.setState({ status: { kind: "none" } }); await Promise.resolve(); });
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
  await expect.poll(() => screen.container.querySelectorAll("canvas").length, { timeout: 10_000 }).toBe(1);
  expect(material.mock.calls.map(([layer]) => layer)).toEqual(["block"]);
  const pixels = screen.container.querySelector("canvas");
  await screen.rerender(view(1));
  expect(screen.container.querySelector("canvas")).toBe(pixels);
  const scroll = screen.container.firstElementChild;
  if (!(scroll instanceof HTMLElement)) throw new Error("Swatch scroll container missing");
  scroll.scrollTop = scroll.scrollHeight;
  await expect.poll(() => screen.container.querySelectorAll("canvas").length, { timeout: 10_000 }).toBe(2);
  scroll.scrollTop = 0;
  await settleThumbnails();
  expect(material).toHaveBeenCalledTimes(2);
});

test("Swatches grid builds only visible cells once across scrolling, filtering and rerendering", async () => {
  const framing = await blockFraming.getBlockFraming();
  const builds = vi.spyOn(framing, "frameBlock");
  setBrushWorld(readWorldTiles(brushSource()));
  useSwatchesView.setState({ category: "block", source: "all", query: "", mode: "grid" });
  connect();
  const screen = await render(<div style={{ width: 240, height: 200, overflow: "auto" }}><SwatchesPanel /></div>);
  const scroll = screen.container.firstElementChild;
  if (!(scroll instanceof HTMLElement)) throw new Error("Swatches grid scroll container missing");
  await expect.poll(() => builds.mock.calls.length).toBeGreaterThan(0);
  await settleThumbnails();
  const initial = builds.mock.calls.length;
  expect(initial).toBeLessThan(screen.container.querySelectorAll(".swatch-button").length);
  scroll.scrollTop = scroll.scrollHeight;
  await expect.poll(() => builds.mock.calls.length).toBeGreaterThan(initial);
  await settleThumbnails();
  scroll.scrollTop = 0;
  await settleThumbnails();
  await act(async () => { useSwatchesView.setState({ query: "Dirt Block" }); await Promise.resolve(); });
  await settleThumbnails();
  await act(async () => { useSwatchesView.setState({ query: "" }); await Promise.resolve(); });
  await settleThumbnails();
  const ids = builds.mock.calls.map(([input]) => input.type);
  expect(new Set(ids).size).toBe(ids.length);
});

test("framing pending preserves the exact map colour until ready", async () => {
  const framing = await blockFraming.getBlockFraming();
  let finish: ((value: typeof framing) => void) | undefined;
  const pending = new Promise<typeof framing>((resolve) => { finish = resolve; });
  vi.mocked(blockFraming.getBlockFraming).mockReturnValueOnce(pending);
  connect();
  const screen = await render(<MaterialSwatch color={0x976b4b} layer="block" content={{ kind: "vanilla", id: 0 }} />);
  await settleThumbnails();
  expect(screen.container.querySelector<HTMLElement>(".material-swatch")?.style.backgroundColor).toBe("rgb(151, 107, 75)");
  expect(screen.container.querySelector("canvas")).toBeNull();
  finish?.(framing);
  await expect.poll(() => screen.container.querySelector("canvas")).not.toBeNull();
});

test("Swatches, Brush chips and Inspector switch together without changing their names", async () => {
  const materialBuilds = vi.spyOn(ThumbnailSource.prototype, "material");
  const tileBuilds = vi.spyOn(ThumbnailSource.prototype, "tile");
  setBrushWorld(readWorldTiles(brushSource()));
  useBrushStore.setState({ blockId: 0, wallId: 1, layer: BRUSH_LAYER.both });
  useViewStore.setState({ tool: "brush", pinnedTile: { x: 1, y: 1 } });
  useSwatchesView.setState({ category: "block", source: "all", query: "Dirt Block" });
  const world = createWorld(3, 3);
  world.setTile(1, 1, { block: { kind: "vanilla", id: 0 }, wall: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  const screen = await render(<><SwatchesPanel /><ToolOptions /><InspectorPanel world={{ width: 3, height: 3, tileAt: (x, y) => world.tileAt(x, y), framingWorld: world }} /></>);
  const names = [...screen.container.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.textContent);
  expect(screen.container.querySelectorAll("canvas")).toHaveLength(0);
  await act(async () => { connect(); await Promise.resolve(); });
  await expect.poll(() => screen.container.querySelectorAll("canvas").length).toBe(5);
  const materialCount = materialBuilds.mock.calls.length;
  const tileCount = tileBuilds.mock.calls.length;
  expect([...screen.container.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual(names);
  await act(async () => { useViewStore.getState().setLayers({ sprites: false }); await Promise.resolve(); });
  expect(screen.container.querySelectorAll("canvas")).toHaveLength(0);
  expect(screen.container.querySelector<HTMLElement>(".swatch-button .material-swatch")?.style.backgroundColor).toBe("rgb(151, 107, 75)");
  await act(async () => { useViewStore.getState().setLayers({ sprites: true }); await Promise.resolve(); });
  expect(screen.container.querySelectorAll("canvas")).toHaveLength(5);
  await settleThumbnails();
  expect(materialBuilds).toHaveBeenCalledTimes(materialCount);
  expect(tileBuilds).toHaveBeenCalledTimes(tileCount);
  await act(async () => { useSwatchesView.setState({ category: "wall", query: "Stone Wall" }); await Promise.resolve(); });
  await expect.poll(() => screen.container.querySelectorAll(".swatch-button canvas").length).toBe(1);
  await act(async () => { useAssetStore.setState({ status: { kind: "none" } }); await Promise.resolve(); });
  expect(screen.container.querySelectorAll("canvas")).toHaveLength(0);
});

test("missing sheets and an unconnected atlas keep the checkerboard and wall shape", async () => {
  const attempted = vi.spyOn(ThumbnailSource.prototype, "material");
  connect();
  const screen = await render(<><MaterialSwatch color={null} layer="wall" content={{ kind: "vanilla", id: 2 }} /><MaterialSwatch color={0x808080} layer="block" content={{ kind: "vanilla", id: 1 }} /></>);
  const swatch = screen.container.querySelector<HTMLElement>(".material-swatch");
  await expect.poll(() => getComputedStyle(swatch ?? screen.container).borderRadius).toBe("50%");
  expect(swatch?.dataset["empty"]).toBe("true");
  await expect.poll(() => attempted.mock.calls.length).toBe(2);
  expect(swatch?.querySelector("canvas")).toBeNull();
  expect(screen.container.querySelectorAll<HTMLElement>(".material-swatch")[1]?.style.backgroundColor).toBe("rgb(128, 128, 128)");
  expect(screen.container.querySelector("canvas")).toBeNull();
});

test("wall sprites fill the original square grid swatches and retain theme borders", async () => {
  setBrushWorld(readWorldTiles(brushSource()));
  useSwatchesView.setState({ category: "wall", source: "all", query: "Stone Wall", mode: "grid" });
  connect();
  const screen = await render(<SwatchesPanel />);
  await expect.poll(() => screen.container.querySelector("canvas")).not.toBeNull();
  const swatch = screen.container.querySelector<HTMLCanvasElement>("canvas")?.parentElement;
  if (swatch === null || swatch === undefined) throw new Error("Stone Wall sprite swatch missing");
  expect(getComputedStyle(swatch).borderRadius).toBe("3px");
  const canvas = screen.container.querySelector("canvas");
  expect(canvas?.getBoundingClientRect().width).toBe(swatch.getBoundingClientRect().width);
  expect(canvas?.getBoundingClientRect().height).toBe(swatch.getBoundingClientRect().height);
  for (const theme of ["light", "dark"]) {
    document.documentElement.dataset["theme"] = theme;
    expect(getComputedStyle(swatch, "::after").boxShadow).not.toBe("none");
  }
  delete document.documentElement.dataset["theme"];
});

test("PropertyGrid decorative swatch preserves copy text and the accessible name", async () => {
  const copied = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(copied);
  await render(<PropertyGrid label="Tile" properties={[{ kind: "text", label: "Block", value: "Dirt Block", icon: <MaterialSwatch color={0x976b4b} /> }]} />);
  const value = page.getByRole("button", { name: "Dirt Block", exact: true });
  await value.click();
  expect(copied).toHaveBeenCalledWith("Dirt Block");
});

test("Inspector keeps its previous sprite while an edit's thumbnail is pending", async () => {
  const world = createWorld(3, 3);
  world.setTile(1, 1, { block: { kind: "vanilla", id: 0 }, wires: 0, actuator: false });
  connect();
  const source = { world, x: 1, y: 1, tile: world.tileAt(1, 1) };
  const screen = await render(<MaterialSwatch color={0x976b4b} layer="block" content={{ kind: "vanilla", id: 0 }} actual={source} revision={0} />);
  await expect.poll(() => screen.container.querySelector("canvas")).not.toBeNull();
  const canvas = screen.container.querySelector("canvas");
  const original = await thumbnailSession.getThumbnailSource();
  let resume: ((source: ThumbnailSource) => void) | undefined;
  const pending = new Promise<ThumbnailSource>((resolve) => { resume = resolve; });
  vi.mocked(thumbnailSession.getThumbnailSource).mockClear();
  vi.mocked(thumbnailSession.getThumbnailSource).mockReturnValueOnce(pending);
  await screen.rerender(<MaterialSwatch color={0x976b4b} layer="block" content={{ kind: "vanilla", id: 0 }} actual={{ ...source }} revision={1} />);
  await settleThumbnails();
  expect(screen.container.querySelector("canvas")).toBe(canvas);
  await expect.poll(() => vi.mocked(thumbnailSession.getThumbnailSource).mock.calls.length).toBe(1);
  if (original !== null) resume?.(original);
  await settleThumbnails();
});

test("Inspector without a framing world keeps map colour and paint, and unknown content stays text", async () => {
  useViewStore.setState({ pinnedTile: { x: 1, y: 1 } });
  const world = createWorld(3, 3);
  world.setTile(1, 1, { block: { kind: "vanilla", id: 0 }, paint: 1, wall: { kind: "unknown", runtimeId: 900 }, wires: 0, actuator: false });
  connect();
  const source = vi.spyOn(ThumbnailSource.prototype, "material");
  const screen = await render(<InspectorPanel world={{ width: 3, height: 3, tileAt: (x, y) => world.tileAt(x, y) }} />);
  await settleThumbnails();
  expect(screen.container.querySelector("canvas")).toBeNull();
  expect(source).not.toHaveBeenCalled();
  expect(screen.container.querySelectorAll(".material-swatch")).toHaveLength(1);
  expect(screen.container.querySelector<HTMLElement>(".material-swatch-paint")?.style.borderTopColor).toBe("rgb(255, 0, 0)");
  await expect.element(page.getByRole("button", { name: "unknown:900", exact: true })).toBeVisible();
});

test("reconnecting owns a new cache and disconnecting releases the source", async () => {
  connect();
  const first = await thumbnailSession.getThumbnailSource();
  const ref = { kind: "vanilla", id: 0 } as const;
  const firstPixels = first?.material("block", ref);
  expect(firstPixels).not.toBeNull();
  await act(async () => { useAssetStore.setState({ status: { kind: "none" } }); await Promise.resolve(); });
  expect(thumbnailSession.getThumbnailSource()).toBeNull();
  connect();
  const second = await thumbnailSession.getThumbnailSource();
  expect(second === first).toBe(false);
  expect(second?.material("block", ref)).not.toBe(firstPixels);
});

test("a ready connection with an atlas delayed by one idle callback retries without scrolling", async () => {
  connect();
  vi.mocked(getDefaultAssetSession().getAtlas).mockReturnValueOnce(null);
  const screen = await render(<MaterialSwatch color={0x976b4b} layer="block" content={{ kind: "vanilla", id: 0 }} />);
  await expect.poll(() => screen.container.querySelector("canvas")).not.toBeNull();
});

test("switching back to cached materials draws immediately without observer or idle jobs", async () => {
  connect();
  const view = (layer: "block" | "wall") => <MaterialSwatch key={layer} color={0x976b4b} layer={layer} content={{ kind: "vanilla", id: layer === "block" ? 0 : 1 }} />;
  const screen = await render(view("block"));
  await expect.poll(() => screen.container.querySelector("canvas")).not.toBeNull();
  await screen.rerender(view("wall"));
  await expect.poll(() => screen.container.querySelector("canvas")).not.toBeNull();
  const jobs = vi.mocked(thumbnailSession.scheduleThumbnail);
  jobs.mockClear();
  await screen.rerender(view("block"));
  const canvas = screen.container.querySelector("canvas");
  expect(canvas).not.toBeNull();
  expect(canvas?.getContext("2d")?.getImageData(0, 0, 1, 1).data[3]).toBe(255);
  expect(jobs).not.toHaveBeenCalled();
});

test("Sprites disabled before connecting keeps colours and does not build thumbnails", async () => {
  useViewStore.getState().setLayers({ sprites: false });
  const builds = vi.spyOn(ThumbnailSource.prototype, "material");
  connect();
  const screen = await render(<MaterialSwatch color={0x976b4b} layer="block" content={{ kind: "vanilla", id: 0 }} />);
  await settleThumbnails();
  expect(screen.container.querySelector("canvas")).toBeNull();
  expect(screen.container.querySelector<HTMLElement>(".material-swatch")?.style.backgroundColor).toBe("rgb(151, 107, 75)");
  expect(builds).not.toHaveBeenCalled();
});

test("disconnecting and reconnecting a different atlas never shows the previous pixels", async () => {
  connect();
  const screen = await render(<MaterialSwatch color={0x976b4b} layer="block" content={{ kind: "vanilla", id: 0 }} />);
  await expect.poll(() => screen.container.querySelector("canvas")).not.toBeNull();
  expect(screen.container.querySelector("canvas")?.getContext("2d")?.getImageData(0, 0, 1, 1).data[0]).toBe(255);
  await act(async () => { useAssetStore.setState({ status: { kind: "none" } }); await Promise.resolve(); });
  expect(screen.container.querySelector("canvas")).toBeNull();
  const rgba = new Uint8Array(288 * 270 * 4);
  for (let index = 0; index < rgba.length; index += 4) rgba.set([151, 107, 75, 255], index);
  const replacement = packSheets([{ kind: "tile", id: 0, width: 288, height: 270, rgba }], { pageSize: 512 });
  vi.mocked(getDefaultAssetSession().getAtlas).mockReturnValue(replacement);
  await act(async () => { useAssetStore.setState({ status: { ...ready, wallSheets: 0 } }); await Promise.resolve(); });
  expect(screen.container.querySelector("canvas")).toBeNull();
  await expect.poll(() => screen.container.querySelector("canvas")?.getContext("2d")?.getImageData(0, 0, 1, 1).data[0]).toBe(151);
});
