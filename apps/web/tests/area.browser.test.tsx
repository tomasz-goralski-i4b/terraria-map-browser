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
import { setBrushWorld } from "../src/world/brush-session.js";
import { copySelection, selectArea, startPaste, cancelArea, setAreaWorld, useAreaStore } from "../src/world/area-session.js";
import { canonicalWorldOf } from "../src/world/canonical-world.js";
import { toRenderableWorld } from "../src/world/renderable-world.js";
import { brushSource } from "./support/brush-source.js";
import axe from "axe-core";
import { App } from "../src/App.js";
import { getDefaultWorldSession } from "../src/world/world-session.js";
import "./support/commands.js";
import "../src/styles.css";

function ShortcutHost(): React.JSX.Element {
  const commands = useCommands(); useGlobalShortcuts(commands);
  return <ToolOptions commands={commands} />;
}
afterEach(() => { setAreaWorld(null); setBrushWorld(null); useViewStore.setState({ tool: "pan", hoverTile: null }); useAppStore.setState({ phase: "idle", unsavedChanges: false }); });

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
  await userEvent.keyboard("{Enter}");
  expect(view.tileAt(10, 10).block).toEqual({ kind: "vanilla", id: 1 });
  await userEvent.keyboard("{Control>}z{/Control}"); expect(view.tileAt(10, 10).block).toBeUndefined();
  await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}"); expect(view.tileAt(10, 10).block).toEqual({ kind: "vanilla", id: 1 });
  await userEvent.keyboard("{Control>}v{/Control}"); await userEvent.keyboard("{Escape}");
  expect(useAreaStore.getState().pasting).toBe(false);
  await page.getByRole("textbox", { name: "Sign text" }).fill("Welcome to the forest village");
  await userEvent.keyboard("{Control>}v{/Control}"); expect(useAreaStore.getState().pasting).toBe(false);
  await expect.element(page.getByRole("group", { name: "Copy layers" })).toBeVisible();
  startPaste(); await expect.element(page.getByRole("combobox", { name: "Paste air" })).toBeVisible();
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
      await expect.element(page.getByRole("combobox", { name: "Paste liquids" })).toBeVisible();
      const pasteBounds = options.element().getBoundingClientRect();
      expect(pasteBounds.bottom).toBeLessThanOrEqual(canvas.getBoundingClientRect().top + 1);
      for (const field of options.element().querySelectorAll("input, select, button")) {
        if ((field as HTMLElement).offsetParent === null) continue;
        const rectangle = field.getBoundingClientRect(); expect(rectangle.right).toBeLessThanOrEqual(width); expect(rectangle.bottom).toBeLessThanOrEqual(pasteBounds.bottom);
      }
      if (width === 1440 || width === 360) await page.screenshot({ path: `.tdd/paste-${theme}-${String(width)}.png` });
    }
  }
  delete document.documentElement.dataset["theme"];
  await page.viewport(1280, 720);
});
