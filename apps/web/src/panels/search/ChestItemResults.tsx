import type { WorldChest } from "@studio/world-codec";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildChestItemIndex, type ChestItemIndex, type ChestItemTotal, type ChestMatch } from "../../world/chest-search.js";
import { useChestNavigation } from "../../world/chest-navigation.js";
import { HIGHLIGHT_DELAY_MS, stepSearch, useSearchStore } from "../../world/search-store.js";
import { itemLabel } from "../../world/items.js";
import { Table, type Column } from "../../ui/Table.js";
import { ItemSprite } from "../ItemSprite.js";
import {
  chestName, ChestName, chestPosition, chestRows, NoChests, positionOrder, useChestActions, useLoadedChestSource,
  type ChestRow, type EntitiesSource,
} from "../chest-list.js";

interface MatchRow extends ChestMatch { readonly row: ChestRow }

const matchColumns: readonly Column<MatchRow>[] = [
  { id: "name", title: "Chest", width: 110, sortValue: (match) => chestName(match.row), render: (match) => <ChestName row={match.row} />, hideable: false },
  { id: "position", title: "Position", width: 84, sortValue: (match) => positionOrder(match.chest), render: (match) => chestPosition(match.chest), defaultHidden: true },
  {
    id: "items", title: "Found", width: 120,
    render: (match) => match.items.map((item) => `${itemLabel(item.itemId)} × ${item.stack.toLocaleString("en-US")}`).join(", "),
  },
  { id: "total", title: "Count", width: 56, align: "end", sortValue: (match) => match.totalStack, render: (match) => match.totalStack.toLocaleString("en-US") },
];

/** One item index per chest list, built in idle slices on first search. */
const indices = new WeakMap<readonly WorldChest[], Promise<ChestItemIndex>>();

/**
 * The "Items in chests" scope: a summary, the matching items with their totals (choosing one narrows the chests and
 * the map highlights to it) and the chests holding them, highlighted on the map with outlines and overview markers.
 */
export function ChestItemResults({ source }: { readonly source?: EntitiesSource }): React.JSX.Element {
  const loaded = useLoadedChestSource();
  const shown = source ?? loaded;
  const rows = useMemo(() => (shown === null ? [] : chestRows(shown)), [shown]);
  const query = useSearchStore((state) => state.query);
  const itemFilter = useChestNavigation((state) => state.itemFilter);
  const selected = useChestNavigation((state) => state.selectedIndex);
  const areas = useChestNavigation((state) => state.areas);
  const actions = useChestActions(shown, rows);
  const chests = shown?.chests ?? null;
  const [ready, setReady] = useState<{ readonly chests: readonly WorldChest[]; readonly index: ChestItemIndex } | null>(null);
  useEffect(() => {
    if (chests === null) return undefined;
    let cancelled = false;
    let pending = indices.get(chests);
    if (pending === undefined) { pending = buildChestItemIndex(chests); indices.set(chests, pending); }
    void pending.then((index) => { if (!cancelled) setReady({ chests, index }); });
    return () => { cancelled = true; };
  }, [chests]);
  const index = ready !== null && ready.chests === chests ? ready.index : null;
  const found = useMemo(() => index?.search(query) ?? { matches: [], totals: [] }, [index, query]);
  const totals = useMemo(() => [...found.totals].sort((a, b) => b.totalStack - a.totalStack || a.itemId - b.itemId), [found]);
  const matches = useMemo((): readonly MatchRow[] => found.matches.flatMap((match) => {
    const row = rows[match.chestIndex];
    if (row === undefined) return [];
    if (itemFilter === null) return [{ ...match, row }];
    const items = match.items.filter((item) => item.itemId === itemFilter);
    return items.length === 0 ? [] : [{ ...match, row, items, totalStack: items.reduce((sum, item) => sum + item.stack, 0) }];
  }), [found, rows, itemFilter]);
  // Map markers follow the results once the query rests (narrowing to one item applies at once), as content does.
  const applied = useRef<string | null>(null);
  useEffect(() => {
    const apply = (): void => {
      applied.current = query;
      useChestNavigation.setState({ areas: matches.flatMap((match) => (match.row.area === null ? [] : [match.row.area])) });
      // Enter typed before the markers were shown: the step is taken now.
      const pending = useSearchStore.getState().stepPending;
      if (pending !== 0) { useSearchStore.setState({ stepPending: 0 }); stepSearch(pending); }
    };
    if (applied.current === query || query.trim() === "") { apply(); return undefined; }
    const timer = window.setTimeout(apply, HIGHLIGHT_DELAY_MS);
    return () => { window.clearTimeout(timer); };
  }, [matches, query]);

  if (shown === null) return <NoChests />;
  const searching = query.trim() !== "";
  // Where F3 is, for screen readers too (stepping does not move focus).
  const stopAt = selected === null ? -1 : areas.findIndex((area) => area.chestIndex === selected);
  const stop = stopAt < 0 ? "" : ` · chest ${String(stopAt + 1)} of ${String(areas.length)}`;
  const chestCount = matches.length;
  const stackCount = matches.reduce((sum, match) => sum + match.totalStack, 0);
  // One item (or the one chosen) is named; several are counted. Stacks of every prefix of an item add up.
  const single = itemFilter ?? (totals.length === 1 ? totals[0]?.itemId ?? null : null);
  const what = single === null ? `${String(totals.length)} items` : itemLabel(single);
  const summary = index === null ? "Indexing chest items…"
    : !searching ? "Type an item name or an exact item ID."
    : totals.length === 0 ? "No chest holds a matching item."
    : `${what}: ${stackCount.toLocaleString("en-US")} in ${String(chestCount)} ${chestCount === 1 ? "chest" : "chests"}${stop}`;

  return (
    <>
      <p className="search-summary" role="status">{summary}</p>
      {index !== null && totals.length > 1 && <ItemTotals totals={totals} filter={itemFilter} />}
      {index !== null && searching && totals.length > 0 && (
        <Table
          id="chest-matches" label="Matching chests" columns={matchColumns} rows={matches} rowKey={(match) => String(match.chestIndex)}
          selectedKey={selected === null ? null : String(selected)}
          onSelect={(match) => { actions.select(match.row); }}
          onActivate={(match) => { actions.goTo(match.row); }}
          onContextMenu={(match, at) => { actions.showMenu(match.row, at); }}
          emptyMessage="No chests contain matching items" fitRows
        />
      )}
      {actions.overlays}
    </>
  );
}

/** Every matching item with its total; choosing one narrows the chests (and the map highlights) to it. */
function ItemTotals({ totals, filter }: { readonly totals: readonly ChestItemTotal[]; readonly filter: number | null }): React.JSX.Element {
  return (
    <ul className="search-entries" aria-label="Matching items">
      {totals.map((total) => (
        <li key={total.itemId}>
          <button
            type="button" className="search-entry" aria-pressed={filter === total.itemId}
            title={filter === total.itemId ? "Show every matching item" : `Show only ${itemLabel(total.itemId)}`}
            onClick={() => { useChestNavigation.setState({ itemFilter: filter === total.itemId ? null : total.itemId, selected: null, selectedIndex: null }); }}
          >
            <span className="search-entry-icon"><ItemSprite itemId={total.itemId} fallback={false} /></span>
            <span className="search-entry-name">{itemLabel(total.itemId)}</span>
            <span className="search-entry-count">{`${total.totalStack.toLocaleString("en-US")} · ${String(total.chestCount)} ${total.chestCount === 1 ? "chest" : "chests"}`}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
