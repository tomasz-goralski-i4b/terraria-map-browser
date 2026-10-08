import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLayoutStore } from "../shell/layout-store.js";
import { Icon } from "./Icon.js";
import { MenuButton } from "./Menu.js";

export interface Column<R> {
  readonly id: string;
  readonly title: string;
  /** Default width in CSS pixels. */
  readonly width: number;
  readonly minWidth?: number;
  readonly align?: "start" | "end";
  /** Sortable when set. */
  readonly sortValue?: (row: R) => number | string;
  readonly render: (row: R) => React.ReactNode;
  /** Columns that identify a row cannot be hidden. */
  readonly hideable?: boolean;
  /** Hidden until the user shows it from the column menu. */
  readonly defaultHidden?: boolean;
}

export type SortDirection = "ascending" | "descending";
export interface SortState {
  readonly column: string;
  readonly direction: SortDirection;
}

export interface TableProps<R> {
  /** Key of the persisted column layout (visibility, widths). */
  readonly id: string;
  readonly label: string;
  readonly columns: readonly Column<R>[];
  readonly rows: readonly R[];
  readonly rowKey: (row: R) => string;
  /** Text the filter box matches (case-insensitive); no filter box without it. */
  readonly filterText?: (row: R) => string;
  /** More filter controls, next to the filter box. */
  readonly filters?: React.ReactNode;
  readonly initialSort?: SortState;
  readonly selectedKey?: string | null;
  readonly onSelect?: (row: R) => void;
  /** Enter or double-click on a row, e.g. "go to on map". */
  readonly onActivate?: (row: R) => void;
  readonly emptyMessage?: string;
}

export const TABLE_ROW_HEIGHT = 24;
const OVERSCAN = 6;
const DEFAULT_MIN_WIDTH = 40;

/** Next state of a header click: ascending → descending → unsorted. */
export function nextSort(current: SortState | null, column: string): SortState | null {
  if (current?.column !== column) return { column, direction: "ascending" };
  return current.direction === "ascending" ? { column, direction: "descending" } : null;
}

function compare(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en", { numeric: true });
}

/**
 * A data table for panels: sortable headers (aria-sort), a text filter, a column menu (show/hide), resizable columns,
 * a sticky header and a virtualised body (only the rows in view, plus a few, are in the DOM). It is an ARIA grid: the
 * body takes focus and the arrows, Page Up/Down, Home and End move the selection; Enter activates the row.
 */
export function Table<R>(props: TableProps<R>): React.JSX.Element {
  const { id, label, columns, rows, rowKey, filterText, filters, initialSort, selectedKey = null, onSelect, onActivate, emptyMessage = "No rows" } = props;
  const domId = useId();
  const layout = useLayoutStore((state) => state.columns[id]);
  const setColumn = useLayoutStore((state) => state.setColumn);
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);
  const [filter, setFilter] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return undefined;
    const measure = (): void => {
      setViewportHeight(element.clientHeight || 400);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const isHidden = (column: Column<R>): boolean => layout?.[column.id]?.hidden ?? column.defaultHidden ?? false;
  const visibleColumns = columns.filter((column) => !isHidden(column));
  const widthOf = (column: Column<R>): number => Math.max(column.minWidth ?? DEFAULT_MIN_WIDTH, layout?.[column.id]?.width ?? column.width);
  // The first column takes the space left over, so a wider dock shows longer names instead of an empty gutter.
  const template = visibleColumns.map((column, index) => (index === 0 ? `minmax(${String(widthOf(column))}px, 1fr)` : `${String(widthOf(column))}px`)).join(" ");

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = needle === "" || filterText === undefined ? [...rows] : rows.filter((row) => filterText(row).toLowerCase().includes(needle));
    const column = sort === null ? undefined : columns.find((candidate) => candidate.id === sort.column);
    const value = column?.sortValue;
    if (sort === null || value === undefined) return filtered;
    const sign = sort.direction === "ascending" ? 1 : -1;
    // Stable: equal values keep their source order in both directions.
    return filtered.map((row, index) => ({ row, index }))
      .sort((a, b) => sign * compare(value(a.row), value(b.row)) || a.index - b.index)
      .map((entry) => entry.row);
  }, [rows, filter, filterText, sort, columns]);

  const first = Math.max(0, Math.floor(scrollTop / TABLE_ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(shown.length, Math.ceil((scrollTop + viewportHeight) / TABLE_ROW_HEIGHT) + OVERSCAN);
  const selectedIndex = selectedKey === null ? -1 : shown.findIndex((row) => rowKey(row) === selectedKey);
  const rowId = (index: number): string => `${domId}-row-${String(index)}`;

  const select = (index: number): void => {
    const row = shown[index];
    if (row === undefined) return;
    onSelect?.(row);
    const element = scroller.current;
    if (element === null) return;
    // Keep the selected row in view below the sticky header.
    const top = index * TABLE_ROW_HEIGHT;
    const viewTop = element.scrollTop;
    const viewBottom = viewTop + element.clientHeight - TABLE_ROW_HEIGHT * 2;
    if (top < viewTop) element.scrollTop = top;
    else if (top > viewBottom) element.scrollTop = top - element.clientHeight + TABLE_ROW_HEIGHT * 2;
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.target !== event.currentTarget) return;
    const page = Math.max(1, Math.floor(viewportHeight / TABLE_ROW_HEIGHT) - 2);
    const next = {
      ArrowDown: selectedIndex + 1, ArrowUp: Math.max(0, selectedIndex - 1), PageDown: selectedIndex + page,
      PageUp: Math.max(0, selectedIndex - page), Home: 0, End: shown.length - 1,
    }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      select(Math.min(shown.length - 1, next));
    } else if (event.key === "Enter" && selectedIndex >= 0) {
      const row = shown[selectedIndex];
      if (row !== undefined) onActivate?.(row);
    }
  };

  const columnItems = columns.map((column) => ({
    kind: "check" as const,
    label: column.title,
    checked: !isHidden(column),
    disabled: column.hideable === false,
    onChange: (checked: boolean) => {
      setColumn(id, column.id, { hidden: !checked });
    },
  }));

  return (
    <div className="table" style={{ "--table-columns": template } as React.CSSProperties}>
      <div className="table-toolbar">
        {filterText !== undefined && (
          <label className="search-field">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Filter"
              aria-label={`Filter ${label}`}
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
              }}
            />
          </label>
        )}
        {filters}
        <MenuButton label={`Columns of ${label}`} icon="columns" items={columnItems} align="end" />
      </div>
      <div className="table-count" aria-live="polite">
        {shown.length === rows.length ? `${rows.length.toLocaleString("en-US")} rows` : `${shown.length.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} rows`}
      </div>
      <div
        ref={scroller}
        className="table-scroll"
        role="grid"
        aria-label={label}
        aria-rowcount={shown.length + 1}
        aria-colcount={visibleColumns.length}
        aria-activedescendant={selectedIndex >= first && selectedIndex < last ? rowId(selectedIndex) : undefined}
        tabIndex={0}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
        }}
        onKeyDown={onKeyDown}
      >
        <div role="rowgroup" className="table-head">
          <div role="row" aria-rowindex={1} className="table-row">
            {visibleColumns.map((column, index) => {
              const direction = sort?.column === column.id ? sort.direction : undefined;
              return (
                <div key={column.id} role="columnheader" aria-colindex={index + 1} aria-sort={column.sortValue === undefined ? undefined : direction ?? "none"} className="table-cell" data-align={column.align ?? "start"}>
                  {column.sortValue === undefined ? (
                    <span className="table-header-text">{column.title}</span>
                  ) : (
                    <button type="button" className="table-sort" onClick={() => {
                      setSort(nextSort(sort, column.id));
                    }}>
                      <span className="table-header-text">{column.title}</span>
                      {direction !== undefined && <Icon name={direction === "ascending" ? "sortAsc" : "sortDesc"} />}
                    </button>
                  )}
                  <ColumnResizer
                    label={`Resize ${column.title} column`}
                    width={widthOf(column)}
                    min={column.minWidth ?? DEFAULT_MIN_WIDTH}
                    onChange={(width) => {
                      setColumn(id, column.id, { width });
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div role="rowgroup" className="table-body" style={{ height: shown.length * TABLE_ROW_HEIGHT }}>
          {shown.slice(first, last).map((row, offset) => {
            const index = first + offset;
            return (
              <div
                key={rowKey(row)}
                id={rowId(index)}
                role="row"
                aria-rowindex={index + 2}
                aria-selected={index === selectedIndex}
                className="table-row"
                style={{ transform: `translateY(${String(index * TABLE_ROW_HEIGHT)}px)` }}
                onClick={() => {
                  select(index);
                }}
                onDoubleClick={() => {
                  onActivate?.(row);
                }}
              >
                {visibleColumns.map((column, columnIndex) => (
                  <div key={column.id} role="gridcell" aria-colindex={columnIndex + 1} className="table-cell" data-align={column.align ?? "start"}>
                    {column.render(row)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      {shown.length === 0 && <p className="table-empty">{emptyMessage}</p>}
    </div>
  );
}

function ColumnResizer({ label, width, min, onChange }: { readonly label: string; readonly width: number; readonly min: number; readonly onChange: (width: number) => void }): React.JSX.Element {
  const drag = useRef<{ readonly x: number; readonly width: number } | null>(null);
  const clamp = (next: number): number => Math.round(Math.min(800, Math.max(min, next)));
  return (
    <div
      className="table-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={800}
      tabIndex={0}
      onPointerDown={(event) => {
        event.stopPropagation();
        drag.current = { x: event.clientX, width };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Dragging still works while the pointer stays over the handle.
        }
      }}
      onPointerMove={(event) => {
        if (drag.current !== null) onChange(clamp(drag.current.width + event.clientX - drag.current.x));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 32 : 8;
        const next = { ArrowLeft: width - step, ArrowRight: width + step }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        onChange(clamp(next));
      }}
    />
  );
}
