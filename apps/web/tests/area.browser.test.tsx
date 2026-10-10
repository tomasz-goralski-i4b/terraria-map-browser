import { afterEach, expect, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { readWorldTiles } from "@studio/world-codec";
import type { Camera } from "@studio/renderer";
import { MapCanvas } from "../src/components/MapCanvas.js";
import { ToolOptions } from "../src/shell/ToolOptions.js";
import { useCommands, useGlobalShortcuts } from "../src/shell/commands.js";
import { getMapController, useViewStore } from "../src/shell/view-store.js";
import { useAppStore } from "../src/store.js";
import { setBrushWorld, commitAreaEdit, undoBrush, redoBrush } from "../src/world/brush-session.js";
import { copySelection, selectArea, startPaste, cancelArea, movePaste, setAreaWorld, useAreaStore } from "../src/world/area-session.js";
import { canonicalWorldOf } from "../src/world/canonical-world.js";
import { toRenderableWorld } from "../src/world/renderable-world.js";
import { brushSource } from "./support/brush-source.js";
import axe from "axe-core";
import { App } from "../src/App.js";
import { getDefaultWorldSession } from "../src/world/world-session.js";
import "./support/commands.js";
import "../src/styles.css";
import { copyArea, planAreaPaste, DEFAULT_COPY_LAYERS } from "../src/world/area-clipboard.js";

function ShortcutHost(): React.JSX.Element {
  const commands = useCommands(); useGlobalShortcuts(commands);
  return <ToolOptions commands={commands} />;
}
afterEach(() => { setAreaWorld(null); setBrushWorld(null); useViewStore.setState({ tool: "pan", hoverTile: null }); useAppStore.setState({ phase: "idle", unsavedChanges: false }); });

test("stationary paste pixels follow destination Undo/Redo and invalid preview disables its command", async () => {
  const bytes = brushSource(32, 32, Array.from({ length: 32 }, () => [0x40, 31]).flat());
  bytes[74] = (bytes[74] ?? 0) | 32;
  const world = readWorldTiles(bytes), view = canonicalWorldOf(world);
  view.setTile(2, 2, { wall: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  view.setTile(3, 3, { block: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  view.setTile(12, 12, { block: { kind: "vanilla", id: 21 }, wires: 0, actuator: false });
  setBrushWorld(world); setAreaWorld(world); useViewStore.setState({ tool: "select" }); useAppStore.setState({ phase: "loaded" });
  const edit = planAreaPaste(world, copyArea(world, { x: 3, y: 3, width: 1, height: 1 }), 10, 10);
  commitAreaEdit(world, edit.tiles, edit.apply);
  await render(<><ShortcutHost /><div style={{ position: "relative", width: 512, height: 384 }}><MapCanvas world={toRenderableWorld(world)} /></div></>);
  useAreaStore.setState({ layers: { ...DEFAULT_COPY_LAYERS, blocks: false, objects: false } });
  selectArea({ x: 2, y: 2 }, { x: 2, y: 2 }); copySelection(); startPaste(); movePaste({ x: 10, y: 10 });
  const pixel = (): number[] => Array.from(document.querySelector<HTMLCanvasElement>(".area-paste-preview")?.getContext("2d")?.getImageData(0, 0, 1, 1).data ?? []);
  await expect.poll(() => pixel()[3]).toBe(255);
  const before = pixel(); undoBrush();
  await expect.poll(pixel).not.toEqual(before);
  redoBrush(); await expect.poll(pixel).toEqual(before);
  expect(useAreaStore.getState().position).toEqual({ x: 10, y: 10 });
  cancelArea(); useAreaStore.setState({ layers: DEFAULT_COPY_LAYERS });
  selectArea({ x: 2, y: 2 }, { x: 2, y: 2 }); copySelection(); startPaste(); movePaste({ x: 12, y: 12 });
  await expect.element(page.getByRole("button", { name: "Place paste", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Transparent air" }).click();
  await expect.element(page.getByRole("button", { name: "Place paste", exact: true })).toBeEnabled();
  useAreaStore.setState({ layers: DEFAULT_COPY_LAYERS });
});

test("rectangle drag, copy, read-only coloured preview, Enter placement and Escape cancellation use shared commands", async () => {
  const world = readWorldTiles(brushSource(32, 32, Array.from({ length: 32 }, () => [0x40, 31]).flat()));
  const view = canonicalWorldOf(world);
  view.setTile(2, 2, { block: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  setBrushWorld(world); setAreaWorld(world); useViewStore.setState({ tool: "select" }); useAppStore.setState({ phase: "loaded" });
  await render(<><ShortcutHost /><div style={{ position: "relative", width: 512, height: 384 }}><MapCanvas world={toRenderableWorld(world)} /></div><input aria-label="Sign text" /></>);
  const canvas = document.querySelector<HTMLCanvasElement>("canvas[aria-label='World map']");
  if (canvas === null) throw new Error("World map is missing");
  await expect.poll(() => canvas.dataset["camera"]).toBeDefined();
  getMapController()?.jumpTo({ x: 0, y: 0, zoom: 8 });
  const pointer = (type: string, x: number, y: number, button = 0): void => {
    const camera = JSON.parse(canvas.dataset["camera"] ?? "null") as Camera, rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 11, pointerType: "mouse", isPrimary: true, button, buttons: type === "pointerup" ? 0 : 1,
      clientX: rect.left + (x + 0.5 - camera.x) * camera.zoom * canvas.clientWidth / canvas.width, clientY: rect.top + (y + 0.5 - camera.y) * camera.zoom * canvas.clientHeight / canvas.height }));
  };
  pointer("pointerdown", 3, 3); pointer("pointermove", 2, 2); pointer("pointerup", 2, 2);
  await expect.poll(() => useAreaStore.getState().selection).toEqual({ x: 2, y: 2, width: 2, height: 2 });
  await userEvent.keyboard("{Control>}c{/Control}");
  await expect.poll(() => useAreaStore.getState().hasClipboard).toBe(true);
  pointer("pointermove", 10, 10);
  await userEvent.keyboard("{Control>}v{/Control}");
  await expect.poll(() => document.querySelector<HTMLCanvasElement>(".area-paste-preview")?.hidden).toBe(false);
  expect(view.tileAt(10, 10).block).toBeUndefined();
  const preview = document.querySelector<HTMLCanvasElement>(".area-paste-preview");
  expect(preview?.getContext("2d")?.getImageData(0, 0, 1, 1).data[3]).toBe(255);
  const pixel = (): number[] => Array.from(preview?.getContext("2d")?.getImageData(0, 0, 1, 1).data ?? []);
  const visible = pixel();
  useViewStore.getState().setLayers({ blocks: false });
  await expect.poll(pixel).not.toEqual(visible);
  useViewStore.getState().setLayers({ blocks: true });
  await expect.poll(pixel).toEqual(visible);
  await userEvent.keyboard("{Enter}");
  expect(view.tileAt(10, 10).block).toEqual({ kind: "vanilla", id: 1 });
  await userEvent.keyboard("{Control>}z{/Control}"); expect(view.tileAt(10, 10).block).toBeUndefined();
  await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}"); expect(view.tileAt(10, 10).block).toEqual({ kind: "vanilla", id: 1 });
  await userEvent.keyboard("{Control>}v{/Control}"); await userEvent.keyboard("{Escape}");
  expect(useAreaStore.getState().pasting).toBe(false);
  await page.getByRole("textbox", { name: "Sign text" }).fill("Welcome to the forest village");
  await userEvent.keyboard("{Control>}v{/Control}"); expect(useAreaStore.getState().pasting).toBe(false);
  await expect.element(page.getByRole("group", { name: "Copy layers" })).toBeVisible();
  startPaste(); await expect.element(page.getByRole("button", { name: "Transparent air" })).toBeVisible();
  cancelArea();
  getMapController()?.jumpTo({ x: 0, y: 0, zoom: 8 });
  const rect = canvas.getBoundingClientRect();
  const touch = (type: string, id: number, x: number): void => {
    canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "touch", pointerId: id, isPrimary: id === 21, button: 0, buttons: 1, clientX: rect.left + x, clientY: rect.top + 100 }));
  };
  touch("pointerdown", 21, 100); touch("pointerdown", 22, 200);
  const selection = useAreaStore.getState().selection;
  const zoom = useViewStore.getState().zoom;
  touch("pointermove", 22, 260);
  await expect.poll(() => useViewStore.getState().zoom).not.toBe(zoom);
  expect(useAreaStore.getState().selection).toEqual(selection);
  touch("pointerup", 21, 100); touch("pointerup", 22, 260);
});

test("Select options fit the existing shell in both themes and desktop/tablet/phone widths", async () => {
  await page.viewport(1440, 900);
  await render(<App layoutStorage={null} />);
  const base64 = await commands.readWorldFixture("SCCO1.wld");
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  await getDefaultWorldSession().open(new File([bytes], "ForestWorkshop.wld"));
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const options = page.getByRole("region", { name: "Tool options" });
  for (const width of [1440, 1024, 800, 360]) {
    await page.viewport(width, 900);
    for (const theme of ["dark", "light"] as const) {
      document.documentElement.dataset["theme"] = theme;
      cancelArea();
      await expect.element(page.getByRole("group", { name: "Copy layers" })).toBeVisible();
      const canvas = document.querySelector<HTMLCanvasElement>("canvas[aria-label='World map']");
      if (canvas === null) throw new Error("World map is missing");
      const bounds = options.element().getBoundingClientRect();
      expect(bounds.bottom).toBeLessThanOrEqual(canvas.getBoundingClientRect().top + 1);
      // Desktop: one fixed row, so switching to Select never moves the map.
      if (width >= 1024) expect(bounds.height).toBe(30);
      for (const field of options.element().querySelectorAll("input, select, button")) {
        if ((field as HTMLElement).offsetParent === null) continue;
        const rectangle = field.getBoundingClientRect();
        expect(rectangle.left).toBeGreaterThanOrEqual(0); expect(rectangle.right).toBeLessThanOrEqual(width);
        expect(rectangle.bottom).toBeLessThanOrEqual(bounds.bottom);
      }
      const results = await axe.run(options.element(), { resultTypes: ["violations"] });
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
      if (width === 1440 || width === 360) await page.screenshot({ path: `.tdd/area-${theme}-${String(width)}.png` });
      selectArea({ x: 100, y: 100 }, { x: 109, y: 109 }); copySelection(); startPaste();
      await expect.element(page.getByRole("button", { name: "Merge liquids" })).toBeVisible();
      const pasteBounds = options.element().getBoundingClientRect();
      expect(pasteBounds.bottom).toBeLessThanOrEqual(canvas.getBoundingClientRect().top + 1);
      if (width >= 1024) expect(pasteBounds.height).toBe(30);
      for (const field of options.element().querySelectorAll("input, select, button")) {
        if ((field as HTMLElement).offsetParent === null) continue;
        const rectangle = field.getBoundingClientRect(); expect(rectangle.right).toBeLessThanOrEqual(width); expect(rectangle.bottom).toBeLessThanOrEqual(pasteBounds.bottom);
      }
      if (width === 1440 || width === 360) await page.screenshot({ path: `.tdd/paste-${theme}-${String(width)}.png` });
    }
  }
  await page.viewport(1440, 900);
  const loaded = getDefaultWorldSession().getLoadedWorld();
  if (loaded === null) throw new Error("Forest workshop is missing");
  const x = Math.floor(loaded.metadata.width / 2);
  let y = 100;
  while (y < loaded.metadata.height - 25 && loaded.planes.block[x * loaded.metadata.height + y] === 0xffff) y++;
  getMapController()?.jumpTo({ x: x - 10, y: y - 40, zoom: 8 });
  for (const theme of ["dark", "light"] as const) {
    document.documentElement.dataset["theme"] = theme;
    cancelArea(); selectArea({ x, y }, { x: x + 19, y: y + 19 });
    await page.screenshot({ path: `.tdd/terrain-selection-${theme}.png` });
    document.querySelector("canvas[aria-label='World map']")?.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    copySelection(); startPaste(); movePaste({ x: x + 25, y: y - 25 });
    await expect.poll(() => document.querySelector<HTMLCanvasElement>(".area-paste-preview")?.width).toBe(20);
    await page.screenshot({ path: `.tdd/terrain-paste-${theme}.png` });
  }
  delete document.documentElement.dataset["theme"];
  await page.viewport(1280, 720);
});
