import { useState } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ContentRef } from "@studio/world-model";
import { CONTENT_COLUMNS, ContentPanel, contentRows, type ContentRow, type ContentWorld } from "../src/panels/ContentPanel.js";
import { countContent } from "../src/world/content-counts.js";
import { hydrateLayout, type LayoutStorage } from "../src/shell/layout-store.js";
import { Table } from "../src/ui/Table.js";
import "../src/styles.css";

const NONE = 0xffff;

function memoryStorage(): LayoutStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

beforeEach(() => {
  hydrateLayout(memoryStorage());
});

afterEach(() => {
  hydrateLayout(memoryStorage());
});

/** 4 × 3 world: stone and dirt ×4 each, stone wall ×2 and unknown wall ×3, every liquid kind. */
const world: ContentWorld = {
  planes: {
    block: Uint16Array.from([0, 0, NONE, 1, NONE, 0, 1, 1, 1, NONE, NONE, 0]),
    wall: Uint16Array.from([0, NONE, 2, 2, NONE, NONE, 0, NONE, NONE, NONE, 2, NONE]),
    liquid: Uint8Array.from([0, 1, 1, 0, 2, 0, 0, 3, 4, 4, 4, 0]),
  },
  palette: [{ kind: "vanilla", id: 1 }, { kind: "vanilla", id: 0 }, { kind: "unknown", runtimeId: 9 }],
};

function bodyRows(): string[][] {
  return [...document.querySelectorAll(".table-body [role=row]")]
    .sort((a, b) => Number(a.getAttribute("aria-rowindex")) - Number(b.getAttribute("aria-rowindex")))
    .map((row) => [...row.querySelectorAll("[role=gridcell]")].map((cell) => cell.textContent));
}

function headers(): string[] {
  return [...document.querySelectorAll("[role=columnheader]")].map((cell) => cell.textContent);
}

test("lists every palette entry and liquid with its exact tile count, most tiles first", async () => {
  await render(<ContentPanel world={world} />);
  await expect.element(page.getByRole("grid", { name: "Content" })).toBeVisible();
  expect(headers()).toEqual(["Content", "Kind", "Tiles", "Share"]);
  // The palette key column is hidden by default; showing it lists each entry's key.
  await page.getByRole("button", { name: "Columns of Content" }).click();
  await page.getByRole("menuitemcheckbox", { name: "ID" }).click();
  await expect.poll(headers).toEqual(["Content", "Kind", "ID", "Tiles", "Share"]);
  const rows = bodyRows().map(([name, kind, id, count]) => [name, kind, id, count]);
  expect(rows).toEqual([
    ["Stone Block", "Block", "vanilla:1", "4"],
    ["Dirt Block", "Block", "vanilla:0", "4"],
    ["unknown:9", "Wall", "unknown:9", "3"],
    ["Shimmer", "Liquid", "liquid:4", "3"],
    ["Stone Wall", "Wall", "vanilla:1", "2"],
    ["Water", "Liquid", "liquid:1", "2"],
    ["Lava", "Liquid", "liquid:2", "1"],
    ["Honey", "Liquid", "liquid:3", "1"],
  ]);
});

test("sorting by a header cycles ascending, descending and unsorted", async () => {
  await render(<ContentPanel world={world} />);
  const header = page.getByRole("columnheader").filter({ hasText: "Content" });
  await page.getByRole("button", { name: "Content", exact: true }).click();
  await expect.element(header).toHaveAttribute("aria-sort", "ascending");
  expect(bodyRows().map((row) => row[0])).toEqual(["Dirt Block", "Honey", "Lava", "Shimmer", "Stone Block", "Stone Wall", "unknown:9", "Water"]);
  await page.getByRole("button", { name: "Content", exact: true }).click();
  await expect.element(header).toHaveAttribute("aria-sort", "descending");
  expect(bodyRows()[0]?.[0]).toBe("Water");
  await page.getByRole("button", { name: "Content", exact: true }).click();
  await expect.element(header).toHaveAttribute("aria-sort", "none");
  // Unsorted: palette order (blocks and walls per entry), then liquids.
  expect(bodyRows().map((row) => row[0])).toEqual(["Stone Block", "Stone Wall", "Dirt Block", "unknown:9", "Water", "Lava", "Honey", "Shimmer"]);
});

test("filtering by text and by kind", async () => {
  await render(<ContentPanel world={world} />);
  await page.getByRole("searchbox", { name: "Filter Content" }).fill("wall");
  await expect.poll(() => bodyRows().map((row) => row[0])).toEqual(["Stone Wall"]);
  await page.getByRole("searchbox", { name: "Filter Content" }).fill("Dirt");
  await expect.poll(() => bodyRows().map((row) => row[0])).toEqual(["Dirt Block"]);
  await page.getByRole("searchbox", { name: "Filter Content" }).fill("vanilla:0");
  await expect.poll(() => bodyRows().map((row) => row[0])).toEqual(["Dirt Block"]);
  expect(headers()).not.toContain("ID");
  await page.getByRole("searchbox", { name: "Filter Content" }).fill("");
  await page.getByRole("combobox", { name: "Kind" }).selectOptions("liquid");
  await expect.poll(() => bodyRows().map((row) => row[1])).toEqual(["Liquid", "Liquid", "Liquid", "Liquid"]);
});

test("the default columns fit the default dock width", async () => {
  await render(<div style={{ width: 320 }}><ContentPanel world={world} /></div>);
  const scroller = page.getByRole("grid", { name: "Content" }).element() as HTMLElement;
  await expect.poll(() => scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth);
});

test("hiding a column from the column menu removes it and is remembered", async () => {
  const view = await render(<ContentPanel world={world} />);
  expect(headers()).toContain("Share");
  await page.getByRole("button", { name: "Columns of Content" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Share" }).click();
  await expect.poll(headers).not.toContain("Share");
  await expect.element(page.getByRole("menuitemcheckbox", { name: "Content" })).toHaveAttribute("aria-disabled", "true");
  await view.unmount();
  await render(<ContentPanel world={world} />);
  await expect.poll(headers).not.toContain("Share");
});

/**
 * A world with `entries` palette entries, one block tile each (vanilla ids, every tenth entry an unknown id as a modded
 * or newer world has), so the Content table has one row per entry: what a large modded world looks like.
 */
function contentRowsOf(entries: number): ContentRow[] {
  const palette = Array.from({ length: entries }, (_, index): ContentRef =>
    (index % 10 === 9 ? { kind: "unknown", runtimeId: 5000 + index } : { kind: "vanilla", id: index }));
  const planes = { block: Uint16Array.from({ length: entries }, (_, index) => index), wall: new Uint16Array(entries).fill(NONE), liquid: new Uint8Array(entries) };
  return contentRows({ planes, palette }, countContent(planes, entries));
}

test("5,000 content rows render through a virtualised body with a bounded DOM", async () => {
  const rows = contentRowsOf(5000);
  await render(<Table id="content" label="Content" columns={CONTENT_COLUMNS} rows={rows} rowKey={(row) => row.key} />);
  const grid = page.getByRole("grid", { name: "Content" });
  await expect.element(grid).toHaveAttribute("aria-rowcount", "5001");
  expect(document.querySelectorAll(".table-body [role=row]").length).toBeLessThan(60);
  const scroller = grid.element() as HTMLElement;
  scroller.scrollTop = scroller.scrollHeight;
  scroller.dispatchEvent(new Event("scroll"));
  await expect.poll(() => bodyRows().at(-1)?.[0]).toBe("unknown:9999");
  expect(document.querySelectorAll(".table-body [role=row]").length).toBeLessThan(60);
});

function selectedRow(): string | undefined {
  return document.querySelector(".table-body [role=row][aria-selected=true] [role=gridcell]")?.textContent ?? undefined;
}

test("the keyboard moves a controlled selection row by row, keeps it in view and activates it", async () => {
  const rows = contentRowsOf(500);
  const activated: string[] = [];
  await render(<SelectableTable rows={rows} onActivate={(key) => { activated.push(key); }} />);
  const grid = page.getByRole("grid", { name: "Content" });
  (grid.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.poll(selectedRow).toBe("Dirt Block");
  await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
  await expect.poll(selectedRow).toBe("vanilla:3");
  await userEvent.keyboard("{ArrowUp}");
  await expect.poll(selectedRow).toBe("vanilla:2");
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(document.querySelector(".table-body [aria-selected=true]")?.id);
  await userEvent.keyboard("{Enter}");
  expect(activated).toEqual(["block:2"]);
  await userEvent.keyboard("{End}");
  await expect.poll(selectedRow).toBe("unknown:5499");
  await userEvent.keyboard("{PageUp}");
  await expect.poll(selectedRow).not.toBe("unknown:5499");
  await userEvent.keyboard("{Home}");
  await expect.poll(selectedRow).toBe("Dirt Block");
});

test("sortable headers work from the keyboard", async () => {
  await render(<ContentPanel world={world} />);
  const button = page.getByRole("button", { name: "Tiles", exact: true });
  (button.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  // Tiles starts descending; the next step is unsorted, then ascending.
  await expect.element(page.getByRole("columnheader").filter({ hasText: "Tiles" })).toHaveAttribute("aria-sort", "none");
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("columnheader").filter({ hasText: "Tiles" })).toHaveAttribute("aria-sort", "ascending");
});

test("resizing the flexible first column starts from its displayed width and applies the new width", async () => {
  await render(<div style={{ width: 640 }}><ContentPanel world={world} /></div>);
  const header = (): HTMLElement => {
    const cell = page.getByRole("columnheader").filter({ hasText: "Content" }).element();
    return cell as HTMLElement;
  };
  const handle = page.getByRole("separator", { name: "Resize Content column" });
  const displayed = Math.round(header().getBoundingClientRect().width);
  expect(displayed).toBeGreaterThan(200);
  await expect.element(handle).toHaveAttribute("aria-valuenow", String(displayed));
  (handle.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.poll(() => Math.round(header().getBoundingClientRect().width)).toBe(displayed + 8);
  for (const expected of [displayed, displayed - 8, displayed - 16]) {
    await userEvent.keyboard("{ArrowLeft}");
    await expect.poll(() => Math.round(header().getBoundingClientRect().width)).toBe(expected);
  }
  await expect.element(handle).toHaveAttribute("aria-valuenow", String(displayed - 16));
  // A narrower first column stays at the width the user chose (it no longer takes the space left over).
  await expect.poll(() => Math.round(header().getBoundingClientRect().width)).toBeLessThan(displayed);
});

function SelectableTable({ rows, onActivate }: { readonly rows: readonly ContentRow[]; readonly onActivate: (key: string) => void }): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <Table
      id="content" label="Content" columns={CONTENT_COLUMNS} rows={rows} rowKey={(row) => row.key}
      selectedKey={selected}
      onSelect={(row) => { setSelected(row.key); }}
      onActivate={(row) => { onActivate(row.key); }}
    />
  );
}

test("switching worlds shows each world's own counts, cached on return", async () => {
  const other: ContentWorld = {
    planes: { block: Uint16Array.from([0, 0, 0]), wall: Uint16Array.from([NONE, NONE, NONE]), liquid: new Uint8Array(3) },
    palette: [{ kind: "vanilla", id: 7 }],
  };
  const view = await render(<ContentPanel world={world} />);
  await expect.poll(() => bodyRows()[0]?.[0]).toBe("Stone Block");
  await view.rerender(<ContentPanel world={other} />);
  await expect.poll(() => bodyRows().map(([name, , count]) => [name, count])).toEqual([["Copper", "3"]]);
  await view.rerender(<ContentPanel world={world} />);
  // Cached: the rows are there in the same render, with no counting progress shown.
  expect(document.querySelector("progress")).toBeNull();
  await expect.poll(() => bodyRows().length).toBe(8);
});
