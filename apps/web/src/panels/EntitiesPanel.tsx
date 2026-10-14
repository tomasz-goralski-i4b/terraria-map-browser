import type { WorldChest } from "@studio/world-codec";
import type { Tile } from "@studio/world-model";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store.js";
import { getDefaultWorldSession } from "../world/world-session.js";
import { canonicalWorldOf } from "../world/canonical-world.js";
import { buildChestItemIndex, type ChestItemIndex, type ChestMatch } from "../world/chest-search.js";
import { chestKind, useChestNavigation, visitChest, type ChestArea } from "../world/chest-navigation.js";
import { itemLabel } from "../world/items.js";
import { Table, type Column } from "../ui/Table.js";
import { chestAnchorStatus, chestFootprints, type ChestWorld } from "../world/chests.js";

export interface EntitiesSource extends ChestWorld { readonly chests: readonly WorldChest[] }
interface ChestRow { readonly chestIndex: number; readonly chest: WorldChest; readonly kind: string; readonly anchor: string; readonly totalStack: number; readonly area: ChestArea | null }
const chestColumns: readonly Column<ChestRow>[] = [
  { id: "name", title: "Name", width: 130, sortValue: (row) => row.chest.name || "Unnamed", render: (row) => row.chest.name || "Unnamed", hideable: false },
  { id: "position", title: "Position", width: 90, sortValue: (row) => row.chest.x, render: (row) => `${String(row.chest.x)}, ${String(row.chest.y)}` },
  { id: "kind", title: "Kind", width: 80, sortValue: (row) => row.kind, render: (row) => row.kind },
  { id: "filled", title: "Filled slots", width: 80, sortValue: (row) => row.chest.items.length, render: (row) => `${String(row.chest.items.length)}/${String(row.chest.slotCount)}` },
  { id: "stack", title: "Total items", width: 80, sortValue: (row) => row.totalStack, render: (row) => String(row.totalStack) },
  { id: "anchor", title: "Anchor status", width: 110, sortValue: (row) => row.anchor, render: (row) => row.anchor },
];
const matchColumns: readonly Column<ChestMatch>[] = [
  { id: "name", title: "Chest", width: 130, render: (row) => row.chest.name || "Unnamed", hideable: false, sortValue: (row) => row.chest.name },
  { id: "position", title: "Position", width: 90, render: (row) => `${String(row.chest.x)}, ${String(row.chest.y)}` },
  { id: "items", title: "Matching items", width: 160, render: (row) => row.items.map((item) => `${itemLabel(item.itemId)} × ${String(item.stack)}`).join(", ") },
  { id: "total", title: "Matched stack", width: 100, render: (row) => String(row.totalStack), sortValue: (row) => row.totalStack },
];
const indices = new WeakMap<readonly WorldChest[], Promise<ChestItemIndex>>();

export function EntitiesPanel({ source, mode = "all" }: { readonly source?: EntitiesSource; readonly mode?: "all" | "entities" | "search" }): React.JSX.Element {
  const revision = useAppStore((state) => state.worldRevision);
  const hasWorld = useAppStore((state) => state.summary !== null);
  const loadedSource = useMemo(() => {
    if (!hasWorld) return null;
    const loaded = getDefaultWorldSession().getLoadedWorld();
    const chests = loaded?.entities.Chests.data?.entries;
    return loaded === null || chests === undefined ? null : { revision, width: loaded.metadata.width, height: loaded.metadata.height, chests, tileAt: (x: number, y: number): Tile => x < 0 || y < 0 || x >= loaded.metadata.width || y >= loaded.metadata.height ? { wires: 0, actuator: false } : canonicalWorldOf(loaded).tileAt(x, y) };
  }, [revision, hasWorld]);
  const shown = source ?? loadedSource;
  const [ready, setReady] = useState<{ readonly chests: readonly WorldChest[]; readonly index: ChestItemIndex } | null>(null);
  if (ready !== null && ready.chests !== shown?.chests) setReady(null);
  const query = useChestNavigation((state) => state.query);
  const selected = useChestNavigation((state) => state.selectedIndex);
  const input = useRef<HTMLInputElement>(null);
  const request = useChestNavigation((state) => state.searchRequested);
  useEffect(() => { if (request > 0) input.current?.focus(); }, [request]);
  useEffect(() => {
    if (shown === null || mode === "entities") return;
    let cancelled = false;
    let pending = indices.get(shown.chests);
    if (pending === undefined) { pending = buildChestItemIndex(shown.chests); indices.set(shown.chests, pending); }
    void pending.then((index) => { if (!cancelled) setReady({ chests: shown.chests, index }); });
    return () => { cancelled = true; };
  }, [shown, mode]);
  const rows = useMemo(() => {
    if (shown === null) return [];
    const footprints = chestFootprints(shown.chests, shown);
    return shown.chests.map((chest, chestIndex) => {
      const footprint = footprints[chestIndex] ?? null;
      const status = chestAnchorStatus(chest, shown);
      return { chest, chestIndex, kind: chest.x < 0 || chest.y < 0 || chest.x >= shown.width || chest.y >= shown.height ? "Unknown" : chestKind(shown.tileAt(chest.x, chest.y)), anchor: status === "valid" && footprint === null ? "ambiguous" : status, totalStack: chest.items.reduce((sum, item) => sum + item.stack, 0), area: footprint === null ? null : { ...footprint, chestIndex } };
    });
  }, [shown]);
  const index = ready?.chests === shown?.chests ? ready?.index : null;
  const found = useMemo(() => index?.search(query) ?? { matches: [], totals: [] }, [index, query]);
  useEffect(() => {
    if (mode === "entities") return;
    useChestNavigation.setState({ areas: shown === null ? [] : found.matches.flatMap((match) => { const area = rows[match.chestIndex]?.area; return area === null || area === undefined ? [] : [area]; }) });
  }, [found, shown, mode, rows]);
  if (shown === null) {
    const section = getDefaultWorldSession().getLoadedWorld()?.entities.Chests;
    return <p className="panel-empty">{section?.error === undefined ? "Open a world to inspect its chests." : "The chest section could not be decoded."}</p>;
  }
  const select = (row: ChestRow | ChestMatch, pin: boolean): void => { visitChest(row.chest, shown, pin, row.chestIndex, rows[row.chestIndex]?.area ?? null); };
  return <div className="entities-chests">
    {mode !== "search" && <Table id="chests" label="Chests" columns={chestColumns} rows={rows} rowKey={(row) => String(row.chestIndex)} filterText={(row) => `${row.chest.name || "Unnamed"} ${row.kind} ${String(row.chest.x)} ${String(row.chest.y)}`} selectedKey={selected === null ? null : String(selected)} onSelect={(row) => { select(row, false); }} onActivate={(row) => { select(row, true); }} />}
    {mode !== "entities" && <>
    <h3>Find items</h3>
    <label className="chest-search-label">Items in chests<input ref={input} aria-label="Items in chests" type="text" value={query} placeholder="Item name or ID" onChange={(event) => { useChestNavigation.setState({ query: event.target.value, selected: null, selectedIndex: null }); }} /></label>
    {index === null ? <p role="status">Indexing chest items…</p> : <>
      <div role="status">{found.totals.map((total) => <p key={total.itemId}>{`${itemLabel(total.itemId)}: ${String(total.totalStack)} in ${String(total.chestCount)} chests`}</p>)}</div>
      {query.trim() !== "" && <Table id="chest-matches" label="Matching chests" columns={matchColumns} rows={found.matches} rowKey={(row) => String(row.chestIndex)} selectedKey={selected === null ? null : String(selected)} onSelect={(row) => { select(row, true); }} onActivate={(row) => { select(row, true); }} emptyMessage="No chests contain matching items" />}
    </>}
    </>}
  </div>;
}
