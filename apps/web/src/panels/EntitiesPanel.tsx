import type { WorldChest } from "@studio/world-codec";
import type { Tile } from "@studio/world-model";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store.js";
import { getDefaultWorldSession } from "../world/world-session.js";
import { canonicalWorldOf } from "../world/canonical-world.js";
import { buildChestItemIndex, type ChestItemIndex, type ChestItemTotal, type ChestMatch } from "../world/chest-search.js";
import { goToChest, selectChest, setChestQuery, stepChest, useChestNavigation, type ChestArea } from "../world/chest-navigation.js";
import { itemLabel } from "../world/items.js";
import { Table, type Column } from "../ui/Table.js";
import { Icon } from "../ui/Icon.js";
import { ContextMenu, type ContextMenuState } from "../ui/ContextMenu.js";
import { notify } from "../shell/notification-store.js";
import { chestRecords, type ChestRecordStatus, type ChestWorld } from "../world/chests.js";
import { chestTitle } from "./chest-fields.js";
import { ChestDialog } from "./ChestDialog.js";
import { ItemSprite } from "./ItemSprite.js";

export interface EntitiesSource extends ChestWorld { readonly chests: readonly WorldChest[] }

/** One decoded record with what the lists show about it; `area` is its map target, null when it has none. */
interface ChestRow {
  readonly chestIndex: number;
  readonly chest: WorldChest;
  /** The object's name on the map ("Gold Chest", "Dresser"), from the tile at the record's position. */
  readonly type: string;
  readonly status: ChestRecordStatus;
  readonly totalStack: number;
  readonly area: ChestArea | null;
}
interface MatchRow extends ChestMatch { readonly row: ChestRow }

const STATUS_TEXT: Readonly<Record<ChestRecordStatus, string>> = {
  valid: "",
  outOfBounds: "Outside the world",
  mismatch: "No complete chest at this position",
  unknown: "The tile here is not a chest",
  ambiguous: "Overlaps another chest record",
};

/** The record's name, or its object type when unnamed; records without a map target carry a warning. */
function ChestName({ row }: { readonly row: ChestRow }): React.JSX.Element {
  const issue = STATUS_TEXT[row.status];
  return (
    <span className="chest-name" title={issue === "" ? undefined : issue}>
      {issue !== "" && <span className="chest-issue" role="img" aria-label={issue}><Icon name="warning" /></span>}
      {row.chest.name === "" ? <span className="muted">{row.type}</span> : row.chest.name}
    </span>
  );
}

const chestName = (row: ChestRow): string => row.chest.name || row.type;
const position = (chest: WorldChest): string => `${String(chest.x)}, ${String(chest.y)}`;

const chestColumns: readonly Column<ChestRow>[] = [
  { id: "name", title: "Chest", width: 120, sortValue: chestName, render: (row) => <ChestName row={row} />, hideable: false },
  { id: "type", title: "Type", width: 100, sortValue: (row) => row.type, render: (row) => row.type, defaultHidden: true },
  { id: "position", title: "Position", width: 84, sortValue: (row) => row.chest.y * 1e5 + row.chest.x, render: (row) => position(row.chest) },
  { id: "filled", title: "Slots", width: 52, align: "end", sortValue: (row) => row.chest.items.length, render: (row) => `${String(row.chest.items.length)}/${String(row.chest.slotCount)}` },
  { id: "stack", title: "Items", width: 56, align: "end", sortValue: (row) => row.totalStack, render: (row) => row.totalStack.toLocaleString("en-US"), defaultHidden: true },
  { id: "issue", title: "Issue", width: 120, sortValue: (row) => STATUS_TEXT[row.status], render: (row) => STATUS_TEXT[row.status], defaultHidden: true },
];

const matchColumns: readonly Column<MatchRow>[] = [
  { id: "name", title: "Chest", width: 110, sortValue: (match) => chestName(match.row), render: (match) => <ChestName row={match.row} />, hideable: false },
  { id: "position", title: "Position", width: 84, sortValue: (match) => match.chest.y * 1e5 + match.chest.x, render: (match) => position(match.chest), defaultHidden: true },
  {
    id: "items", title: "Found", width: 120,
    render: (match) => match.items.map((item) => `${itemLabel(item.itemId)} × ${item.stack.toLocaleString("en-US")}`).join(", "),
  },
  { id: "total", title: "Count", width: 56, align: "end", sortValue: (match) => match.totalStack, render: (match) => match.totalStack.toLocaleString("en-US") },
];

/** Per chest list: one model for both sections, and one item index built in idle time. */
const models = new WeakMap<readonly WorldChest[], readonly ChestRow[]>();
const indices = new WeakMap<readonly WorldChest[], Promise<ChestItemIndex>>();

function chestRows(source: EntitiesSource): readonly ChestRow[] {
  const cached = models.get(source.chests);
  if (cached !== undefined) return cached;
  const records = chestRecords(source.chests, source);
  const rows = source.chests.map((chest, chestIndex): ChestRow => {
    const record = records[chestIndex];
    const footprint = record?.footprint ?? null;
    const inWorld = chest.x >= 0 && chest.y >= 0 && chest.x < source.width && chest.y < source.height;
    return {
      chestIndex,
      chest,
      type: inWorld ? chestTitle(source.tileAt(chest.x, chest.y)) : "Chest",
      status: record?.status ?? "unknown",
      totalStack: chest.items.reduce((sum, item) => sum + item.stack, 0),
      area: footprint === null ? null : { ...footprint, chestIndex },
    };
  });
  models.set(source.chests, rows);
  return rows;
}

function useLoadedSource(): EntitiesSource | null {
  const revision = useAppStore((state) => state.worldRevision);
  const hasWorld = useAppStore((state) => state.summary !== null);
  return useMemo(() => {
    if (!hasWorld) return null;
    const loaded = getDefaultWorldSession().getLoadedWorld();
    const chests = loaded?.entities.Chests.data?.entries;
    if (loaded === null || chests === undefined) return null;
    const { width, height } = loaded.metadata;
    const tiles = canonicalWorldOf(loaded);
    const empty: Tile = { wires: 0, actuator: false };
    return { revision, width, height, chests, tileAt: (x: number, y: number): Tile => (x < 0 || y < 0 || x >= width || y >= height ? empty : tiles.tileAt(x, y)) };
  }, [revision, hasWorld]);
}

/**
 * The chest lists. `entities` lists every decoded record; `search` finds the chests holding an item. In both, a click
 * selects (map highlight and Inspector, the camera stays), Enter or a double-click goes to the chest (at once, zoomed
 * in) and the context menu also opens its inventory.
 */
export function EntitiesPanel({ source, mode = "all" }: { readonly source?: EntitiesSource; readonly mode?: "all" | "entities" | "search" }): React.JSX.Element {
  const loadedSource = useLoadedSource();
  const shown = source ?? loadedSource;
  const rows = useMemo(() => (shown === null ? [] : chestRows(shown)), [shown]);
  const selected = useChestNavigation((state) => state.selectedIndex);
  const [menu, setMenu] = useState<(ContextMenuState & { readonly row: ChestRow }) | null>(null);
  const [open, setOpen] = useState<ChestRow | null>(null);
  const closeMenu = useCallback(() => { setMenu(null); }, []);
  const closeDialog = useCallback(() => { setOpen(null); }, []);
  // A new world drops the old one's open inventory and menu.
  if (open !== null && rows[open.chestIndex] !== open) setOpen(null);
  if (menu !== null && rows[menu.row.chestIndex] !== menu.row) setMenu(null);

  if (shown === null) {
    const section = getDefaultWorldSession().getLoadedWorld()?.entities.Chests;
    return <p className="panel-empty">{section?.error === undefined ? "Open a world to inspect its chests." : "The chest section could not be decoded."}</p>;
  }
  const select = (row: ChestRow): void => { selectChest(row.chest, row.chestIndex, row.area); };
  const goTo = (row: ChestRow): void => { goToChest(row.chest, shown, row.chestIndex, row.area); };
  const selectedKey = selected === null ? null : String(selected);
  const showMenu = (row: ChestRow, at: ContextMenuState): void => { setMenu({ ...at, row }); };

  return (
    <div className="entities-chests">
      {mode !== "search" && (
        <Table
          id="chests" label="Chests" columns={chestColumns} rows={rows} rowKey={(row) => String(row.chestIndex)}
          filterText={(row) => `${row.chest.name} ${row.type} ${position(row.chest)}`}
          selectedKey={selectedKey} onSelect={select} onActivate={goTo} onContextMenu={showMenu}
          emptyMessage="This world has no chests"
        />
      )}
      {mode !== "entities" && (
        <ChestSearch
          source={shown} rows={rows} selectedKey={selectedKey}
          onSelect={(match) => { select(match.row); }}
          onActivate={(match) => { goTo(match.row); }}
          onContextMenu={(match, at) => { showMenu(match.row, at); }}
        />
      )}
      {menu !== null && (
        <ContextMenu
          at={menu} label={`${chestName(menu.row)} actions`} onClose={closeMenu}
          items={[
            { kind: "action", label: "Go to", icon: "target", shortcut: "Enter", onSelect: () => { goTo(menu.row); } },
            { kind: "action", label: "Open inventory", icon: "list", onSelect: () => { setOpen(menu.row); } },
            { kind: "separator" },
            {
              kind: "action", label: "Copy position", icon: "copy", detail: position(menu.row.chest), onSelect: () => {
                void navigator.clipboard.writeText(position(menu.row.chest)).then(
                  () => { notify({ kind: "success", title: "Position copied", detail: position(menu.row.chest) }); },
                  () => { notify({ kind: "error", title: "Position not copied", detail: "The browser refused clipboard access." }); },
                );
              },
            },
          ]}
        />
      )}
      {open !== null && <ChestDialog chest={open.chest} title={open.type} onClose={closeDialog} />}
    </div>
  );
}

function ChestSearch({ source, rows, selectedKey, onSelect, onActivate, onContextMenu }: {
  readonly source: EntitiesSource;
  readonly rows: readonly ChestRow[];
  readonly selectedKey: string | null;
  readonly onSelect: (match: MatchRow) => void;
  readonly onActivate: (match: MatchRow) => void;
  readonly onContextMenu: (match: MatchRow, at: ContextMenuState) => void;
}): React.JSX.Element {
  const query = useChestNavigation((state) => state.query);
  const itemFilter = useChestNavigation((state) => state.itemFilter);
  const request = useChestNavigation((state) => state.searchRequested);
  const input = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState<{ readonly chests: readonly WorldChest[]; readonly index: ChestItemIndex } | null>(null);
  useEffect(() => {
    if (request > 0) { input.current?.focus(); input.current?.select(); }
  }, [request]);
  useEffect(() => {
    let cancelled = false;
    let pending = indices.get(source.chests);
    if (pending === undefined) { pending = buildChestItemIndex(source.chests); indices.set(source.chests, pending); }
    void pending.then((index) => { if (!cancelled) setReady({ chests: source.chests, index }); });
    return () => { cancelled = true; };
  }, [source.chests]);
  const index = ready?.chests === source.chests ? ready.index : null;
  const found = useMemo(() => index?.search(query) ?? { matches: [], totals: [] }, [index, query]);
  const totals = useMemo(() => [...found.totals].sort((a, b) => b.totalStack - a.totalStack || a.itemId - b.itemId), [found]);
  const matches = useMemo((): readonly MatchRow[] => found.matches.flatMap((match) => {
    const row = rows[match.chestIndex];
    if (row === undefined) return [];
    if (itemFilter === null) return [{ ...match, row }];
    const items = match.items.filter((item) => item.itemId === itemFilter);
    return items.length === 0 ? [] : [{ ...match, row, items, totalStack: items.reduce((sum, item) => sum + item.stack, 0) }];
  }), [found, rows, itemFilter]);
  useEffect(() => {
    useChestNavigation.setState({ areas: matches.flatMap((match) => (match.row.area === null ? [] : [match.row.area])) });
  }, [matches]);

  const searching = query.trim() !== "";
  const chestCount = matches.length;
  const stackCount = matches.reduce((sum, match) => sum + match.totalStack, 0);
  // One item (or the one chosen) is named; several are counted. Stacks of every prefix of an item add up.
  const single = itemFilter ?? (totals.length === 1 ? totals[0]?.itemId ?? null : null);
  const what = single === null ? `${String(totals.length)} items` : itemLabel(single);
  const summary = !searching ? "Type an item name or an exact item ID."
    : totals.length === 0 ? "No chest holds a matching item."
    : `${what}: ${stackCount.toLocaleString("en-US")} in ${String(chestCount)} ${chestCount === 1 ? "chest" : "chests"}`;

  return (
    <div className="chest-search">
      <div className="chest-search-bar">
        <label className="search-field">
          <Icon name="search" />
          <input
            ref={input} type="search" aria-label="Find items in chests" placeholder="Find items in chests: name or ID" value={query}
            aria-keyshortcuts="Enter Shift+Enter F3 Shift+F3"
            onChange={(event) => { setChestQuery(event.target.value); }}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); stepChest(event.shiftKey ? -1 : 1); }
              else if (event.key === "Escape" && query !== "") { event.preventDefault(); event.stopPropagation(); setChestQuery(""); }
            }}
          />
        </label>
      </div>
      {index === null ? <p className="chest-search-summary" role="status">Indexing chest items…</p> : (
        <>
          <p className="chest-search-summary" role="status">{summary}</p>
          {totals.length > 1 && <ItemTotals totals={totals} filter={itemFilter} />}
          {searching && totals.length > 0 && (
            <Table
              id="chest-matches" label="Matching chests" columns={matchColumns} rows={matches} rowKey={(match) => String(match.chestIndex)}
              selectedKey={selectedKey} onSelect={onSelect} onActivate={onActivate} onContextMenu={onContextMenu}
              emptyMessage="No chests contain matching items" fitRows
            />
          )}
        </>
      )}
    </div>
  );
}

/** Every matching item with its total; choosing one narrows the chests (and the map highlights) to it. */
function ItemTotals({ totals, filter }: { readonly totals: readonly ChestItemTotal[]; readonly filter: number | null }): React.JSX.Element {
  return (
    <ul className="chest-item-totals" aria-label="Matching items">
      {totals.map((total) => (
        <li key={total.itemId}>
          <button
            type="button" className="chest-item-total" aria-pressed={filter === total.itemId}
            title={filter === total.itemId ? "Show every matching item" : `Show only ${itemLabel(total.itemId)}`}
            onClick={() => { useChestNavigation.setState({ itemFilter: filter === total.itemId ? null : total.itemId, selected: null, selectedIndex: null }); }}
          >
            <span className="chest-item-total-sprite"><ItemSprite itemId={total.itemId} fallback={false} /></span>
            <span className="chest-item-total-name">{itemLabel(total.itemId)}</span>
            <span className="chest-item-total-count">{`${total.totalStack.toLocaleString("en-US")} · ${String(total.chestCount)} ${total.chestCount === 1 ? "chest" : "chests"}`}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
