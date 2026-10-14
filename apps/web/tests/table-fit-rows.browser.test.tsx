// A table that fits its rows (fitRows) shows every row below its header, also when its columns are wider than the
// panel and a horizontal scrollbar takes room at the bottom.
import { afterEach, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { hydrateLayout, type LayoutStorage } from "../src/shell/layout-store.js";
import { Table, type Column } from "../src/ui/Table.js";
import "../src/styles.css";

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

interface Row { readonly name: string; readonly count: number }

const COLUMNS: readonly Column<Row>[] = [
  { id: "name", title: "Chest", width: 160, render: (row) => row.name },
  { id: "where", title: "Position", width: 160, render: () => "2489, 427" },
  { id: "count", title: "Count", width: 160, align: "end", render: (row) => String(row.count) },
];

function FitTable({ rows }: { readonly rows: readonly Row[] }): React.JSX.Element {
  return (
    <div style={{ width: "300px" }}>
      <Table id="fit-test" label="Fit" columns={COLUMNS} rows={rows} rowKey={(row) => row.name} fitRows />
    </div>
  );
}

/** How far the scroll area can scroll vertically: 0 when every row fits. */
function verticalOverflow(): number {
  const scroller = document.querySelector<HTMLElement>(".table-scroll");
  if (scroller === null) throw new Error("no table");
  return scroller.scrollHeight - scroller.clientHeight;
}

test("a single row of a table wider than its panel is not hidden under the header", async () => {
  await render(<FitTable rows={[{ name: "Chest", count: 1 }]} />);
  await expect.element(page.getByRole("grid", { name: "Fit" })).toBeVisible();
  await expect.poll(verticalOverflow).toBe(0);
  await expect.element(page.getByText("1 row", { exact: true })).toBeVisible();
});

test("a few rows all fit without vertical scrolling", async () => {
  await render(<FitTable rows={[{ name: "A", count: 1 }, { name: "B", count: 2 }, { name: "C", count: 3 }]} />);
  await expect.element(page.getByRole("grid", { name: "Fit" })).toBeVisible();
  await expect.poll(verticalOverflow).toBe(0);
  await expect.element(page.getByText("3 rows", { exact: true })).toBeVisible();
});
