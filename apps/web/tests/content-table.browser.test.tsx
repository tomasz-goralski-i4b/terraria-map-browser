import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ContentPanel, type ContentWorld } from "../src/panels/ContentPanel.js";
import { hydrateLayout, type LayoutStorage } from "../src/shell/layout-store.js";
import { Table, type Column } from "../src/ui/Table.js";
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

/** 4 × 3 world: blocks vanilla 1 ×4 and vanilla 2 ×4, walls vanilla 1 ×2 and unknown 9 ×3, every liquid kind. */
const world: ContentWorld = {
  planes: {
    block: Uint16Array.from([0, 0, NONE, 1, NONE, 0, 1, 1, 1, NONE, NONE, 0]),
    wall: Uint16Array.from([0, NONE, 2, 2, NONE, NONE, 0, NONE, NONE, NONE, 2, NONE]),
    liquid: Uint8Array.from([0, 1, 1, 0, 2, 0, 0, 3, 4, 4, 4, 0]),
  },
  palette: [{ kind: "vanilla", id: 1 }, { kind: "vanilla", id: 2 }, { kind: "unknown", runtimeId: 9 }],
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
    ["Block 1", "Block", "vanilla:1", "4"],
    ["Block 2", "Block", "vanilla:2", "4"],
    ["Unknown wall 9", "Wall", "unknown:9", "3"],
    ["Shimmer", "Liquid", "liquid:4", "3"],
    ["Wall 1", "Wall", "vanilla:1", "2"],
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
  expect(bodyRows().map((row) => row[0])).toEqual(["Block 1", "Block 2", "Honey", "Lava", "Shimmer", "Unknown wall 9", "Wall 1", "Water"]);
  await page.getByRole("button", { name: "Content", exact: true }).click();
  await expect.element(header).toHaveAttribute("aria-sort", "descending");
  expect(bodyRows()[0]?.[0]).toBe("Water");
  await page.getByRole("button", { name: "Content", exact: true }).click();
  await expect.element(header).toHaveAttribute("aria-sort", "none");
  // Unsorted: palette order (blocks and walls per entry), then liquids.
  expect(bodyRows().map((row) => row[0])).toEqual(["Block 1", "Wall 1", "Block 2", "Unknown wall 9", "Water", "Lava", "Honey", "Shimmer"]);
});

test("filtering by text and by kind", async () => {
  await render(<ContentPanel world={world} />);
  await page.getByRole("searchbox", { name: "Filter Content" }).fill("wall");
  await expect.poll(() => bodyRows().map((row) => row[0])).toEqual(["Unknown wall 9", "Wall 1"]);
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

interface NumberRow {
  readonly id: number;
}

const NUMBER_COLUMNS: readonly Column<NumberRow>[] = [
  { id: "id", title: "Row", width: 80, sortValue: (row) => row.id, render: (row) => String(row.id) },
];

test("5,000 rows render through a virtualised body with a bounded DOM", async () => {
  const rows = Array.from({ length: 5000 }, (_, id) => ({ id }));
  await render(<Table id="numbers" label="Numbers" columns={NUMBER_COLUMNS} rows={rows} rowKey={(row) => String(row.id)} />);
  const grid = page.getByRole("grid", { name: "Numbers" });
  await expect.element(grid).toHaveAttribute("aria-rowcount", "5001");
  expect(document.querySelectorAll(".table-body [role=row]").length).toBeLessThan(60);
  const scroller = grid.element() as HTMLElement;
  scroller.scrollTop = scroller.scrollHeight;
  scroller.dispatchEvent(new Event("scroll"));
  await expect.poll(() => bodyRows().at(-1)?.[0]).toBe("4999");
  expect(document.querySelectorAll(".table-body [role=row]").length).toBeLessThan(60);
});

test("the keyboard moves the selection and keeps it in view", async () => {
  const rows = Array.from({ length: 500 }, (_, id) => ({ id }));
  let selected: string | null = null;
  const view = await render(<SelectableTable rows={rows} onSelect={(key) => { selected = key; }} />);
  const grid = page.getByRole("grid", { name: "Numbers" });
  (grid.element() as HTMLElement).focus();
  await userEvent.keyboard("{End}");
  await expect.poll(() => selected).toBe("499");
  await expect.poll(() => bodyRows().map((row) => row[0])).toContain("499");
  await view.unmount();
});

function SelectableTable({ rows, onSelect }: { readonly rows: readonly NumberRow[]; readonly onSelect: (key: string) => void }): React.JSX.Element {
  return <Table id="numbers" label="Numbers" columns={NUMBER_COLUMNS} rows={rows} rowKey={(row) => String(row.id)} onSelect={(row) => { onSelect(String(row.id)); }} />;
}
