import { useMemo } from "react";
import { useChestNavigation } from "../world/chest-navigation.js";
import { Table, type Column } from "../ui/Table.js";
import {
  chestName, ChestName, chestPosition, chestRows, NoChests, positionOrder, STATUS_TEXT, useChestActions, useLoadedChestSource,
  type ChestRow, type EntitiesSource,
} from "./chest-list.js";

export type { EntitiesSource } from "./chest-list.js";

const chestColumns: readonly Column<ChestRow>[] = [
  { id: "name", title: "Chest", width: 120, sortValue: chestName, render: (row) => <ChestName row={row} />, hideable: false },
  { id: "type", title: "Type", width: 100, sortValue: (row) => row.type, render: (row) => row.type, defaultHidden: true },
  { id: "position", title: "Position", width: 84, sortValue: (row) => positionOrder(row.chest), render: (row) => chestPosition(row.chest) },
  { id: "filled", title: "Slots", width: 52, align: "end", sortValue: (row) => row.chest.items.length, render: (row) => `${String(row.chest.items.length)}/${String(row.chest.slotCount)}` },
  { id: "stack", title: "Items", width: 56, align: "end", sortValue: (row) => row.totalStack, render: (row) => row.totalStack.toLocaleString("en-US"), defaultHidden: true },
  { id: "issue", title: "Issue", width: 120, sortValue: (row) => STATUS_TEXT[row.status], render: (row) => STATUS_TEXT[row.status], defaultHidden: true },
];

/**
 * Every decoded chest record. A click selects (map highlight and Inspector, the camera stays), Enter or a
 * double-click goes to the chest (at once, zoomed in) and the context menu also opens its inventory. Finding the
 * chests that hold an item is the Search section's "Items in chests" scope.
 */
export function EntitiesPanel({ source }: { readonly source?: EntitiesSource }): React.JSX.Element {
  const loaded = useLoadedChestSource();
  const shown = source ?? loaded;
  const rows = useMemo(() => (shown === null ? [] : chestRows(shown)), [shown]);
  const selected = useChestNavigation((state) => state.selectedIndex);
  const actions = useChestActions(shown, rows);
  if (shown === null) return <NoChests />;
  return (
    <div className="entities-chests">
      <Table
        id="chests" label="Chests" columns={chestColumns} rows={rows} rowKey={(row) => String(row.chestIndex)}
        filterText={(row) => `${row.chest.name} ${row.type} ${chestPosition(row.chest)}`}
        selectedKey={selected === null ? null : String(selected)}
        onSelect={actions.select} onActivate={actions.goTo} onContextMenu={actions.showMenu}
        emptyMessage="This world has no chests"
      />
      {actions.overlays}
    </div>
  );
}
