// @module-tag perf -- UI flows starve on shared CI runners; skipped in CI (docs/tooling.md).
import { useEffect } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../src/App.js";
import { useCommands, type Command } from "../src/shell/commands.js";
import { type LayoutStorage } from "../src/shell/layout-store.js";
import { getMapController, useViewStore, type ToolId } from "../src/shell/view-store.js";
import { getWorkbench } from "../src/shell/workbench-api.js";
import { useBrushStore } from "../src/world/brush-session.js";
import { getDefaultWorldSession } from "../src/world/world-session.js";
import "../src/styles.css";
import "./support/commands.js";
import { menu, hoverSubmenu } from "./support/shell.js";

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
  useViewStore.setState({ tool: "pan", familyTools: {}, plannedDialog: null, pinnedTile: null });
});

/** The commands as the app has them right now, read through a component that renders nothing. */
const probe: { commands: readonly Command[] } = { commands: [] };
function CommandProbe(): null {
  const commands = useCommands();
  useEffect(() => { probe.commands = commands; });
  return null;
}

async function openWorld(): Promise<void> {
  const bytes = Uint8Array.from(atob(await commands.readWorldFixture("SCCO1.wld")), (character) => character.charCodeAt(0));
  await getDefaultWorldSession().open(new File([bytes], "SCCO1.wld"));
  await expect.poll(() => document.querySelector("canvas[aria-label='World map']") !== null).toBe(true);
  // The map takes input once its renderer is up.
  await expect.poll(() => getMapController() !== null).toBe(true);
}

function railButton(name: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>(".tool-rail button")].find((candidate) => candidate.getAttribute("aria-label") === name);
  if (button === undefined) throw new Error(`no rail button ${name}`);
  return button;
}

function canvas(): HTMLCanvasElement {
  const element = document.querySelector<HTMLCanvasElement>("canvas[aria-label='World map']");
  if (element === null) throw new Error("no map");
  return element;
}

/** A right-button click on the map without moving: the quick menu's gesture. */
function rightClick(x: number, y: number): void {
  const rect = canvas().getBoundingClientRect();
  for (const type of ["pointerdown", "pointerup"]) {
    canvas().dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, pointerType: "mouse", isPrimary: true, button: 2,
      buttons: type === "pointerdown" ? 2 : 0, clientX: rect.left + x, clientY: rect.top + y,
    }));
  }
}

test("a tool family's other tools open from its button by right-click, and each unavailable one says why", async () => {
  await render(<App layoutStorage={storage} />);
  const select = railButton("Rectangle select");
  expect(select.getAttribute("aria-haspopup")).toBe("menu");
  select.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
  const flyout = page.getByRole("menu", { name: "Selection tools" });
  await expect.element(flyout).toBeVisible();
  for (const name of ["Rectangle select", "Ellipse select", "Lasso select", "Magic wand", "Move"]) {
    await expect.element(flyout.getByRole("menuitem", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await expect.element(flyout.getByRole("menuitem", { name: /^Lasso select/ })).toHaveAttribute("aria-disabled", "true");
  await expect.element(flyout).toMatchTextContent("Planned for later");
  await expect.element(flyout).toMatchTextContent("Not available yet");
  await userEvent.keyboard("{Escape}");
  await expect.element(flyout).not.toBeInTheDocument();
});

test("from the keyboard → opens a family's tools and Enter picks one; the family keeps it as its last tool", async () => {
  await render(<App layoutStorage={storage} />);
  await openWorld();
  railButton("Rectangle select").focus();
  await userEvent.keyboard("{ArrowRight}");
  const flyout = page.getByRole("menu", { name: "Selection tools" });
  await expect.element(flyout).toBeVisible();
  await expect.element(flyout.getByRole("menuitem", { name: /^Rectangle select/ })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => useViewStore.getState().tool).toBe("select");
  expect(useViewStore.getState().familyTools["select"]).toBe("select");
  expect(railButton("Rectangle select").getAttribute("aria-pressed")).toBe("true");
});

test("a long press opens the family's tools without picking the tool under the finger", async () => {
  await render(<App layoutStorage={storage} />);
  await openWorld();
  const button = railButton("Rectangle select");
  const box = button.getBoundingClientRect();
  button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, buttons: 1, pointerId: 4, clientX: box.left + 5, clientY: box.top + 5 }));
  await expect.element(page.getByRole("menu", { name: "Selection tools" })).toBeVisible();
  button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 4, clientX: box.left + 5, clientY: box.top + 5 }));
  button.click();
  expect(useViewStore.getState().tool).toBe("pan");
});

test("a family with nothing available yet opens its list on click, instead of doing nothing", async () => {
  await render(<App layoutStorage={storage} />);
  railButton("Rectangle").click();
  const flyout = page.getByRole("menu", { name: "Shape tools" });
  await expect.element(flyout).toBeVisible();
  for (const name of ["Rectangle", "Ellipse", "Polygon"]) await expect.element(flyout.getByRole("menuitem", { name: new RegExp(`^${name}`) })).toHaveAttribute("aria-disabled", "true");
  expect(useViewStore.getState().tool).toBe("pan");
});

test("no two enabled commands share a key, whichever tool is active", async () => {
  await render(<><App layoutStorage={storage} /><CommandProbe /></>);
  await openWorld();
  for (const tool of ["pan", "inspect", "ruler", "select", "brush", "erase"] as const satisfies readonly ToolId[]) {
    useViewStore.getState().setTool(tool);
    await expect.poll(() => probe.commands.find((command) => command.id === `tool.${tool}`)?.checked).toBe(true);
    const keys = probe.commands.filter((command) => command.enabled && command.shortcut !== undefined).map((command) => command.shortcut?.toLowerCase());
    const repeated = keys.filter((key, index) => keys.indexOf(key) !== index);
    expect(repeated, tool).toEqual([]);
  }
});

test("every key belongs to one command, enabled or not, apart from the ones whose meaning depends on the context", async () => {
  await render(<><App layoutStorage={storage} /><CommandProbe /></>);
  await expect.poll(() => probe.commands.length).toBeGreaterThan(0);
  // Enter, Escape and Delete act on whatever is in front (a paste, a pin, a measurement); each use is enabled alone.
  const contextual = new Set(["enter", "escape", "delete"]);
  const keys = probe.commands.flatMap((command) => (command.shortcut === undefined ? [] : [command.shortcut.toLowerCase()])).filter((key) => !contextual.has(key));
  expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
});

test("the new menus list their commands; the ones not connected yet are disabled and say so", async () => {
  await render(<App layoutStorage={storage} />);
  await openWorld();
  await menu("Select");
  for (const name of ["All", "Deselect", "Invert", "Expand to Complete Objects"]) {
    await expect.element(page.getByRole("menuitem", { name: new RegExp(`^${name}`) })).toHaveAttribute("aria-disabled", "true");
  }
  await expect.element(page.getByRole("menu")).toMatchTextContent("Not available yet");
  await userEvent.keyboard("{Escape}");
  await menu("World");
  await expect.element(page.getByRole("menuitem", { name: /^Add Bookmark/ })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await menu("File");
  await hoverSubmenu("Export");
  await expect.element(page.getByRole("menu", { name: "Export" }).getByRole("menuitem", { name: /^Map Image/ })).not.toHaveAttribute("aria-disabled");
  await userEvent.keyboard("{Escape}{Escape}");
  // The Window menu is gone: panels are under View.
  expect([...document.querySelectorAll("[role=menubar] [role=menuitem]")].map((item) => item.textContent)).toEqual(["File", "Edit", "Select", "View", "World", "Assets", "Help"]);
});

test.each([
  ["Edit", ["Replace…"], "Replace"],
  ["File", ["Import", "Image as Pixel Art…"], "Import Image as Pixel Art"],
  ["File", ["Export", "Selection as Schematic…"], "Save Selection as Schematic"],
] as const)("%s > %s opens its dialog, whose action says it is not available yet", async (title, path, dialogTitle) => {
  await render(<App layoutStorage={storage} />);
  await openWorld();
  await menu(title, ...path);
  const dialog = page.getByRole("dialog", { name: dialogTitle });
  await expect.element(dialog).toBeVisible();
  const action = dialog.getByRole("button").last();
  await expect.element(action).toHaveAttribute("aria-disabled", "true");
  await expect.element(dialog).toMatchTextContent("not available yet");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  expect(useViewStore.getState().plannedDialog).toBeNull();
});

test("the status bar shows background work, recovery and whether the world can be edited, without shifting", async () => {
  await render(<App layoutStorage={storage} />);
  await expect.element(page.getByTestId("background-job")).toHaveTextContent("Idle");
  await expect.element(page.getByTestId("recovery")).toHaveTextContent("Recovery off");
  expect(document.querySelector("[data-testid=capability]")).toBeNull();
  const recovery = page.getByTestId("recovery").element().getBoundingClientRect().width;
  await openWorld();
  await expect.element(page.getByTestId("capability")).toHaveTextContent("Editable");
  expect(page.getByTestId("recovery").element().getBoundingClientRect().width).toBe(recovery);
});

test("a right click on the map opens the quick menu for the tool; Inspect this tile pins it and shows Properties", async () => {
  await render(<App layoutStorage={storage} />);
  await openWorld();
  getWorkbench()?.getPanel("properties")?.group.api.setVisible(false);
  // The middle of the map is over the world (its edges can be outside it after Fit world).
  const box = canvas().getBoundingClientRect();
  rightClick(box.width / 2, box.height / 2);
  const quick = page.getByRole("menu", { name: "Map" });
  await expect.element(quick).toBeVisible();
  await expect.element(quick).toMatchTextContent(/^Pan · \d+, \d+/);
  await quick.getByRole("menuitem", { name: "Inspect this tile" }).click();
  await expect.poll(() => useViewStore.getState().pinnedTile).not.toBeNull();
  await expect.poll(() => getWorkbench()?.getPanel("properties")?.group.api.isVisible).toBe(true);
});

test("with Brush the quick menu offers the brush's settings and picking materials at the pointer", async () => {
  await render(<App layoutStorage={storage} />);
  await openWorld();
  await userEvent.keyboard("b");
  await expect.poll(() => useViewStore.getState().tool).toBe("brush");
  rightClick(200, 150);
  const quick = page.getByRole("menu", { name: "Map" });
  for (const name of ["Larger brush", "Smaller brush", "Toggle square and round brush", "Pick materials here", "Choose material…", "Undo", "Fit world"]) {
    await expect.element(quick.getByRole("menuitem", { name: new RegExp(`^${name.replace(/[…]/g, ".")}`) })).toBeVisible();
  }
  const size = useBrushStore.getState().size;
  await quick.getByRole("menuitem", { name: /^Larger brush/ }).click();
  expect(useBrushStore.getState().size).toBeGreaterThan(size);
});

test("a short readout over the map shows the brush size while it changes, then goes", async () => {
  await render(<App layoutStorage={storage} />);
  await openWorld();
  await userEvent.keyboard("b");
  await userEvent.keyboard("]");
  const size = useBrushStore.getState().size;
  await expect.element(page.getByText(`Brush ${String(size)} × ${String(size)}`)).toBeVisible();
  await expect.poll(() => document.querySelector(".gesture-hud"), { timeout: 3000 }).toBeNull();
});
