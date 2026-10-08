import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { readWorldMetadata } from "@studio/world-codec";
import type { Tile } from "@studio/world-model";
import { App } from "../src/App.js";
import { worldFieldGroups } from "../src/panels/world-fields.js";
import { DEFAULT_LAYOUT, type LayoutStorage } from "../src/shell/layout-store.js";
import { StatusBar, type StatusWorld } from "../src/shell/StatusBar.js";
import { useViewStore } from "../src/shell/view-store.js";
import "../src/styles.css";
import "./support/commands.js";

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
  await expect.element(world).toMatchTextContent("SCCR1");

  const identity = page.getByRole("region", { name: "Identity", exact: true });
  await expect.element(identity).toMatchTextContent("948580918");
  const size = page.getByRole("region", { name: "Size & layers", exact: true });
  await expect.element(size).toMatchTextContent("4200 × 1200 tiles");
  await expect.element(size).toMatchTextContent("Small");
  const generation = page.getByRole("region", { name: "Generation", exact: true });
  await expect.element(generation).toMatchTextContent("Classic");
  await expect.element(generation).toMatchTextContent("Corruption");

  // Values checked against the codec's own result, not against the panel's row builder.
  const decoded = readWorldMetadata(bytes);
  const shown = new Map([...document.querySelectorAll(".world-panel .property-row")].map((row) => [
    row.querySelector("dt")?.textContent ?? "",
    row.querySelector("dd")?.textContent ?? "",
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

test("Collapse all and Expand all toggle every World group", { tags: ["perf"] }, async () => {
  await render(<App layoutStorage={storage} />);
  await openFixture("SCCO1.wld");
  await expect.element(page.getByRole("region", { name: "World", exact: true })).toMatchTextContent("SCCR1");
  const groupToggles = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>(".world-panel .section-toggle")];
  await page.getByRole("button", { name: "Collapse all groups" }).click();
  await expect.poll(() => groupToggles().map((toggle) => toggle.getAttribute("aria-expanded"))).toEqual(groupToggles().map(() => "false"));
  expect(groupToggles().length).toBeGreaterThan(5);
  await page.getByRole("button", { name: "Expand all groups" }).click();
  await expect.poll(() => groupToggles().every((toggle) => toggle.getAttribute("aria-expanded") === "true")).toBe(true);
});

test("collapsed sections, a resized and a hidden dock persist across a reload", async () => {
  const first = await render(<App layoutStorage={storage} />);
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
  expect(sectionToggle("Layers").getAttribute("aria-expanded")).toBe("false");
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
  await page.getByRole("button", { name: "App menu" }).click();
  await page.getByRole("menuitem", { name: "Reset layout" }).click();
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

test("every dock section opens and closes from the keyboard", async () => {
  await render(<App layoutStorage={storage} />);
  for (const name of ["World", "Layers", "Inspector", "Content", "Entities"]) {
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

test("at 320 px nothing overflows: secondary actions move to the app menu", async () => {
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
  await expect.element(page.getByRole("button", { name: "Open .wld world" })).toBeVisible();
  await page.getByRole("button", { name: "App menu" }).click();
  await expect.element(page.getByRole("menuitemcheckbox", { name: "Theme: dark" })).toBeVisible();
  await expect.element(page.getByRole("menuitem", { name: /Keyboard shortcuts/ })).toBeVisible();
  expect(page.getByRole("toolbar", { name: "Tools" }).element().getAttribute("aria-orientation")).toBe("horizontal");
});

test("the main screen with a loaded world has no accessibility violations", async () => {
  await render(<App layoutStorage={storage} />);
  await openFixture("SCCO1.wld");
  await expect.element(page.getByRole("region", { name: "World", exact: true })).toMatchTextContent("SCCR1");
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
