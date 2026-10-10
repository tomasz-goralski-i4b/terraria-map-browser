// @module-tag perf -- UI flows starve on shared CI runners; skipped in CI (docs/tooling.md).
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { readWorldMetadata } from "@studio/world-codec";
import type { Tile } from "@studio/world-model";
import { App } from "../src/App.js";
import { worldFieldGroups } from "../src/panels/world-fields.js";
import { DEFAULT_LAYOUT, type LayoutStorage } from "../src/shell/layout-store.js";
import { parseZoomPercent, StatusBar, type StatusWorld } from "../src/shell/StatusBar.js";
import { useViewStore } from "../src/shell/view-store.js";
import "../src/styles.css";
import "./support/commands.js";
import { dockTab, menu } from "./support/shell.js";

class MemoryStorage implements LayoutStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

let storage: MemoryStorage;

beforeEach(async () => {
  storage = new MemoryStorage();
  await page.viewport(1280, 800);
});

afterEach(() => {
  vi.restoreAllMocks();
  useViewStore.setState({ hoverTile: null, tool: "pan", helpOpen: false, paletteOpen: false });
});

async function fixtureBytes(file: string): Promise<Uint8Array<ArrayBuffer>> {
  const binary = atob(await commands.readWorldFixture(file));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function openFixture(file: string): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = await fixtureBytes(file);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("no file input in the app");
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], file));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return bytes;
}

function sectionToggle(name: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>(".section-toggle")]
    .find((candidate) => candidate.querySelector(".section-title")?.textContent === name);
  if (button === undefined) throw new Error(`no section ${name}`);
  return button;
}

test("the World panel shows exactly the decoded metadata fields with their values", async () => {
  await render(<App layoutStorage={storage} />);
  const bytes = await openFixture("SCCO1.wld");
  const world = page.getByRole("region", { name: "World", exact: true });
  await expect.element(world.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("SCCR1");

  const identity = page.getByRole("region", { name: "Identity", exact: true });
  await expect.element(identity.getByRole("textbox", { name: "Seed", exact: true })).toHaveValue("948580918");
  const size = page.getByRole("region", { name: "Size & layers", exact: true });
  await expect.element(size.getByRole("spinbutton", { name: "Size width", exact: true })).toHaveValue(4200);
  await expect.element(size.getByRole("spinbutton", { name: "Size height", exact: true })).toHaveValue(1200);
  await expect.element(size).toMatchTextContent("Small");
  const generation = page.getByRole("region", { name: "Generation", exact: true });
  await expect.element(generation).toMatchTextContent("Classic");
  await expect.element(generation).toMatchTextContent("Corruption");

  // Values checked against the codec's own result, not against the panel's row builder.
  const decoded = readWorldMetadata(bytes);
  const shown = new Map([...document.querySelectorAll(".world-panel .property-row")].map((row) => [
    row.querySelector("dt")?.textContent ?? "",
    [...row.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")].map((control) => control instanceof HTMLInputElement && control.type === "checkbox" ? control.checked ? "Yes" : "No" : control.value).join(", ") || (row.querySelector("dd")?.textContent ?? ""),
  ]));
  const yesNo = (flag: boolean): string => (flag ? "Yes" : "No");
  const { metadata, details } = decoded;
  const spawn = details.spawnAndLandmarks.spawn;
  expect(Object.fromEntries(shown)).toMatchObject({
    "Name": metadata.name,
    "Seed": metadata.seed,
    "GUID": metadata.guid,
    "World ID": String(metadata.worldId),
    "Format version": String(decoded.header.version),
    "Surface level": String(metadata.surfaceLevel),
    "Rock level": String(metadata.rockLevel),
    "Hardmode": yesNo(details.progression.hardmode),
    "Moon Lord": yesNo(details.progression.bosses.moonLord),
    "Blood moon": yesNo(details.timeAndWeather.bloodMoon),
    "Party (genuine)": yesNo(details.timeAndWeather.party.genuine),
    "Pillar active: Nebula": yesNo(details.progression.activePillars.nebula),
    "Unlocked: Merchant": yesNo(details.progression.unlockedNpcs.merchant),
    "Altars smashed": String(details.progression.altarCount),
    "Moon type": String(details.generation.moonType),
    "World-gen version": details.generation.worldGenVersion,
    "Spawn": `${String(spawn.x)}, ${String(spawn.y)}`,
  });
  // Every row has a distinct label, and the rows are exactly the fields the builder covers (its coverage of every
  // decoded value is proven in world-fields.test.ts against the codec's own object).
  const rows = document.querySelectorAll(".world-panel .property-row").length;
  expect(shown.size).toBe(rows);
  expect(rows).toBe(worldFieldGroups({ ...decoded, fileSize: bytes.length }).flatMap((group) => group.fields).length);
});

test("Collapse all and Expand all toggle every World group", async () => {
  await render(<App layoutStorage={storage} />);
  await openFixture("SCCO1.wld");
  await expect.element(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("SCCR1");
  const groupToggles = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>(".world-panel .section-toggle")];
  await page.getByRole("button", { name: "Collapse all groups" }).click();
  await expect.poll(() => groupToggles().map((toggle) => toggle.getAttribute("aria-expanded"))).toEqual(groupToggles().map(() => "false"));
  expect(groupToggles().length).toBeGreaterThan(5);
  await page.getByRole("button", { name: "Expand all groups" }).click();
  await expect.poll(() => groupToggles().every((toggle) => toggle.getAttribute("aria-expanded") === "true")).toBe(true);
});

test("collapsed sections, a resized and a hidden dock persist across a reload", async () => {
  const first = await render(<App layoutStorage={storage} />);
  await dockTab("View");
  sectionToggle("Layers").click();
  await expect.element(sectionToggle("Layers")).toHaveAttribute("aria-expanded", "false");
  const splitter = page.getByRole("separator", { name: "Resize panels" });
  (splitter.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
  await expect.element(splitter).toHaveAttribute("aria-valuenow", String(DEFAULT_LAYOUT.dockWidth + 32));
  await page.getByRole("button", { name: "Show panels" }).click();
  await expect.element(page.getByRole("complementary", { name: "Panels" })).not.toBeInTheDocument();
  await first.unmount();

  await render(<App layoutStorage={storage} />);
  await expect.element(page.getByRole("complementary", { name: "Panels" })).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Show panels" })).toHaveAttribute("aria-pressed", "false");
  await userEvent.keyboard("p");
  await expect.element(page.getByRole("complementary", { name: "Panels" })).toBeVisible();
  await expect.element(page.getByRole("separator", { name: "Resize panels" })).toHaveAttribute("aria-valuenow", String(DEFAULT_LAYOUT.dockWidth + 32));
  // The chosen tab is remembered too.
  await expect.element(page.getByRole("tab", { name: "View" })).toHaveAttribute("aria-selected", "true");
  expect(sectionToggle("Layers").getAttribute("aria-expanded")).toBe("false");
  await dockTab("World");
  expect(sectionToggle("World").getAttribute("aria-expanded")).toBe("true");
});

test("with localStorage throwing the app renders the default layout and keeps working", async () => {
  const blocked = (): never => {
    throw new DOMException("blocked", "SecurityError");
  };
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
  await render(<App />);
  await expect.element(page.getByRole("main", { name: "Map" })).toBeVisible();
  await expect.element(page.getByRole("complementary", { name: "Panels" })).toBeVisible();
  expect(sectionToggle("World").getAttribute("aria-expanded")).toBe("true");
  sectionToggle("World").click();
  await expect.element(sectionToggle("World")).toHaveAttribute("aria-expanded", "false");
});

test("Reset layout restores the default sections and dock", async () => {
  await render(<App layoutStorage={storage} />);
  sectionToggle("World").click();
  await expect.element(sectionToggle("World")).toHaveAttribute("aria-expanded", "false");
  await menu("View", "Reset layout");
  await expect.element(sectionToggle("World")).toHaveAttribute("aria-expanded", "true");
  expect(storage.items.size).toBe(0);
});

function statusWorld(): StatusWorld {
  const tile: Tile = { wires: 0, actuator: false };
  return { height: 1200, surfaceLevel: 300, rockLevel: 450, tileAt: () => tile };
}

test.each([
  [10, "sky"],
  [200, "surface"],
  [350, "underground"],
  [700, "caverns"],
  [1100, "underworld"],
] as const)("the status bar labels row %i as %s", async (y, label) => {
  await render(<StatusBar world={statusWorld()} />);
  useViewStore.getState().setHoverTile({ x: 42, y });
  await expect.element(page.getByTestId("cursor-tile")).toHaveTextContent(`42, ${String(y)}`);
  await expect.element(page.getByTestId("depth")).toHaveTextContent(label);
  await expect.element(page.getByTestId("tile-under-cursor")).toHaveTextContent("Empty");
});

test("tools, sections and dialogs are operable from the keyboard", async () => {
  await render(<App layoutStorage={storage} />);
  await userEvent.keyboard("i");
  await expect.element(page.getByRole("button", { name: "Inspect" })).toHaveAttribute("aria-pressed", "true");
  await expect.element(page.getByRole("region", { name: "Tool options" })).toMatchTextContent("Inspect");
  await userEvent.keyboard("h");
  await expect.element(page.getByRole("button", { name: "Pan" })).toHaveAttribute("aria-pressed", "true");
  // An edit tool that is not available yet is announced as disabled and ignores its shortcut.
  await userEvent.keyboard("b");
  await expect.element(page.getByRole("button", { name: "Brush" })).toHaveAttribute("aria-disabled", "true");
  await expect.element(page.getByRole("button", { name: "Pan" })).toHaveAttribute("aria-pressed", "true");

  sectionToggle("Content").focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(sectionToggle("Content")).toHaveAttribute("aria-expanded", "true");

  await userEvent.keyboard("{Shift>}?{/Shift}");
  await expect.element(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();

  await userEvent.keyboard("{Control>}k{/Control}");
  await expect.element(page.getByRole("combobox", { name: "Command" })).toHaveFocus();
  await userEvent.keyboard("show panels{Enter}");
  await expect.element(page.getByRole("complementary", { name: "Panels" })).not.toBeInTheDocument();
});

function tabbableTools(): string[] {
  return [...document.querySelectorAll<HTMLButtonElement>(".tool-rail button")].filter((button) => button.tabIndex === 0)
    .map((button) => button.getAttribute("aria-label") ?? "");
}

test("the tool rail is one Tab stop; arrows move it and a tool change moves it to the active tool", async () => {
  await render(<App layoutStorage={storage} />);
  expect(tabbableTools()).toEqual(["Pan"]);
  page.getByRole("button", { name: "Pan" }).element().focus();
  await userEvent.keyboard("{ArrowDown}{ArrowDown}");
  await expect.element(page.getByRole("button", { name: "Brush" })).toHaveFocus();
  expect(tabbableTools()).toEqual(["Brush"]);
  await userEvent.keyboard("{ArrowUp}");
  await expect.element(page.getByRole("button", { name: "Inspect" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("button", { name: "Inspect" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.keyboard("{ArrowDown}{ArrowDown}");
  await userEvent.keyboard("h");
  await expect.element(page.getByRole("button", { name: "Pan" })).toHaveAttribute("aria-pressed", "true");
  expect(tabbableTools()).toEqual(["Pan"]);
  expect(page.getByRole("toolbar", { name: "Tools" }).element().getAttribute("aria-orientation")).toBe("vertical");
});

test("the menu bar works from the keyboard: Alt+letter, arrows between menus and into submenus, Escape", async () => {
  await render(<App layoutStorage={storage} />);
  await userEvent.keyboard("{Alt>}f{/Alt}");
  await expect.element(page.getByRole("menuitem", { name: "Open World…" })).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(page.getByRole("menuitem", { name: "Undo", exact: true })).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(page.getByRole("menuitemcheckbox", { name: "Show panels" })).toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
  await expect.element(page.getByRole("menuitem", { name: "Open World…" })).toHaveFocus();
  // Open World…, Open Folder…, Worlds, Open Recent.
  await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
  await expect.element(page.getByRole("menuitem", { name: "Open Recent" })).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(page.getByRole("menu", { name: "Open Recent" }).getByRole("menuitem", { name: "No recent worlds" })).toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(page.getByRole("menuitem", { name: "Open Recent" })).toHaveFocus();
  await expect.element(page.getByRole("menu", { name: "Open Recent" })).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("menubar").getByRole("menuitem", { name: "File" })).toHaveFocus();
  await expect.element(page.getByRole("menu")).not.toBeInTheDocument();

  // A modal dialog owns the keyboard: Alt+letter opens no menu behind it.
  await userEvent.keyboard("{Shift>}?{/Shift}");
  await expect.element(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await userEvent.keyboard("{Alt>}f{/Alt}");
  expect(document.querySelector("[role=menu]")).toBeNull();
});

test("the zoom in the status bar takes a typed percentage; Escape keeps the zoom", async () => {
  expect([parseZoomPercent("250"), parseZoomPercent(" 62,5 % "), parseZoomPercent("abc"), parseZoomPercent("0"), parseZoomPercent("")])
    .toEqual([2.5, 0.625, null, null, null]);
  await render(<App layoutStorage={storage} />);
  await openFixture("SCCO1.wld");
  const zoom = page.getByRole("button", { name: /^Zoom \d+%, click to type a zoom$/ });
  await expect.element(zoom).toBeVisible();
  const before = useViewStore.getState().zoom;
  await zoom.click();
  const field = page.getByRole("textbox", { name: /^Zoom in percent/ });
  await expect.element(field).toHaveFocus();
  await userEvent.keyboard("{Control>}a{/Control}12345{Escape}");
  await expect.element(field).not.toBeInTheDocument();
  expect(useViewStore.getState().zoom).toBe(before);
  await zoom.click();
  await userEvent.keyboard("{Control>}a{/Control}300{Enter}");
  await expect.poll(() => useViewStore.getState().zoom, { timeout: 5000 }).toBeCloseTo(3, 3);
  await expect.element(page.getByTestId("zoom")).toHaveTextContent("300%");
});

test("the dock tabs follow the arrow keys, Home and End", async () => {
  await render(<App layoutStorage={storage} />);
  const world = page.getByRole("tab", { name: "World" });
  const view = page.getByRole("tab", { name: "View" });
  (world.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(view).toHaveFocus();
  await expect.element(view).toHaveAttribute("aria-selected", "true");
  await expect.element(page.getByRole("tabpanel")).toMatchTextContent("Layers");
  await userEvent.keyboard("{Home}");
  await expect.element(world).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{End}");
  await expect.element(page.getByRole("tab", { name: "Swatches" })).toHaveAttribute("aria-selected", "true");
  await expect.element(page.getByRole("tabpanel")).toMatchTextContent("Open a vanilla world first");
  // The Inspector stays visible with any tab.
  await expect.element(page.getByRole("region", { name: "Inspector" })).toBeVisible();
});

test("every dock section opens and closes from the keyboard", async () => {
  await render(<App layoutStorage={storage} />);
  for (const [tab, name] of [["World", "World"], ["World", "Content"], ["World", "Entities"], ["World", "Inspector"], ["View", "Layers"], ["View", "Inspector"], ["Swatches", "Swatches"]] as const) {
    await dockTab(tab);
    const toggle = sectionToggle(name);
    const before = toggle.getAttribute("aria-expanded");
    toggle.focus();
    await userEvent.keyboard(" ");
    await expect.poll(() => sectionToggle(name).getAttribute("aria-expanded")).toBe(before === "true" ? "false" : "true");
    sectionToggle(name).focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => sectionToggle(name).getAttribute("aria-expanded")).toBe(before);
  }
});

test("the command palette keeps the active option in view and closes without running anything", async () => {
  await render(<App layoutStorage={storage} />);
  await userEvent.keyboard("{Control>}k{/Control}");
  const list = page.getByRole("listbox", { name: "Commands" }).element() as HTMLElement;
  for (let step = 0; step < 19; step++) await userEvent.keyboard("{ArrowDown}");
  const active = list.querySelector<HTMLElement>("[aria-selected=true]");
  if (active === null) throw new Error("no active option");
  const listBox = list.getBoundingClientRect();
  const optionBox = active.getBoundingClientRect();
  expect(optionBox.top).toBeGreaterThanOrEqual(listBox.top - 1);
  expect(optionBox.bottom).toBeLessThanOrEqual(listBox.bottom + 1);

  await userEvent.keyboard("zzzz no such command");
  await expect.element(page.getByRole("option", { name: "No matching command" })).toBeVisible();
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("button", { name: "Close" }).click();
  await expect.element(page.getByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  await expect.element(page.getByRole("complementary", { name: "Panels" })).toBeVisible();

  await userEvent.keyboard("{Control>}k{/Control}");
  const dialog = page.getByRole("dialog", { name: "Command palette" }).element() as HTMLDialogElement;
  // A click on the backdrop targets the dialog element itself.
  dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await expect.element(page.getByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
});

test("at 320 px nothing overflows: secondary actions stay in the menus", async () => {
  await page.viewport(320, 568);
  await render(<App layoutStorage={storage} />);
  await openFixture("SCCO1.wld");
  await expect.element(page.getByRole("main", { name: "Map" })).toBeVisible();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  for (const button of document.querySelectorAll<HTMLElement>(".top-bar button")) {
    if (button.offsetParent === null) continue; // hidden at this width
    const box = button.getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(320);
  }
  await expect.element(page.getByRole("button", { name: "Show panels" })).toBeVisible();
  await expect.element(page.getByRole("menubar", { name: "Main menu" }).getByRole("menuitem", { name: "File" })).toBeVisible();
  await menu("View", "Theme");
  const dark = page.getByRole("menuitemcheckbox", { name: "Theme: dark" });
  await expect.element(dark).toBeVisible();
  // On a phone the submenu opens under its item, inside the screen.
  expect(dark.element().getBoundingClientRect().right).toBeLessThanOrEqual(320);
  await menu("Help");
  await expect.element(page.getByRole("menuitem", { name: "Keyboard shortcuts" })).toBeVisible();
  expect(page.getByRole("toolbar", { name: "Tools" }).element().getAttribute("aria-orientation")).toBe("horizontal");
});

test("the main screen with a loaded world has no accessibility violations", async () => {
  await render(<App layoutStorage={storage} />);
  await openFixture("SCCO1.wld");
  await expect.element(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("SCCR1");
  sectionToggle("Content").click();
  await expect.element(page.getByRole("grid", { name: "Content" })).toBeVisible();
  for (const theme of ["dark", "light"] as const) {
    document.documentElement.dataset["theme"] = theme;
    const results = await axe.run(document, { resultTypes: ["violations"] });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
  }
  delete document.documentElement.dataset["theme"];
});

test("below 1024 px the rail runs along the top, the dock sits under the map and the map keeps half the screen", async () => {
  await page.viewport(800, 700);
  await render(<App layoutStorage={storage} />);
  await expect.element(page.getByRole("complementary", { name: "Panels" })).toBeVisible();
  const map = document.querySelector("main")?.getBoundingClientRect();
  const dock = document.querySelector("aside")?.getBoundingClientRect();
  const rail = document.querySelector(".tool-rail")?.getBoundingClientRect();
  if (map === undefined || dock === undefined || rail === undefined) throw new Error("layout regions missing");
  expect(dock.top).toBeGreaterThanOrEqual(map.bottom - 1);
  expect(rail.bottom).toBeLessThanOrEqual(map.top + 1);
  expect(map.height).toBeGreaterThanOrEqual(700 / 2 - 1);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(800);
});

test("the Inspector's top edge resizes it against the tabs, by dragging or the keys, and the height persists", async () => {
  const first = await render(<App layoutStorage={storage} />);
  const splitter = page.getByRole("separator", { name: "Resize Inspector" });
  await expect.element(splitter).toHaveAttribute("aria-orientation", "horizontal");
  const inspector = document.querySelector<HTMLElement>(".dock-inspector");
  if (inspector === null) throw new Error("The Inspector is missing");
  const start = inspector.getBoundingClientRect().height;
  const handle = splitter.element() as HTMLElement;
  const box = handle.getBoundingClientRect();
  const at = (type: string, dy: number): void => {
    handle.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 3, clientX: box.left + 10, clientY: box.top + dy }));
  };
  at("pointerdown", 0);
  at("pointermove", -30);
  at("pointerup", -30);
  await expect.poll(() => Math.round(inspector.getBoundingClientRect().height)).toBe(Math.round(start + 30));
  handle.focus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.poll(() => Math.round(inspector.getBoundingClientRect().height)).toBe(Math.round(start + 30 - 16));
  await first.unmount();
  await render(<App layoutStorage={storage} />);
  await expect.poll(() => Math.round(document.querySelector<HTMLElement>(".dock-inspector")?.getBoundingClientRect().height ?? 0)).toBe(Math.round(start + 14));
});

test("a right click opens no browser menu, except in text fields", async () => {
  await render(<App layoutStorage={storage} />);
  const click = (target: Element): boolean => {
    const event = new MouseEvent("contextmenu", { button: 2, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(click(page.getByRole("tab", { name: "World" }).element())).toBe(true);
  expect(click(document.body)).toBe(true);
  await page.getByRole("button", { name: "Command palette" }).click();
  expect(click(page.getByRole("combobox", { name: "Command" }).element())).toBe(false);
});
