import type { WorldChest } from "@studio/world-codec";
import type { Tile } from "@studio/world-model";
import { useCallback, useMemo, useState } from "react";
import { useAppStore } from "../store.js";
import { getDefaultWorldSession } from "../world/world-session.js";
import { canonicalWorldOf } from "../world/canonical-world.js";
import { goToChest, selectChest, type ChestArea } from "../world/chest-navigation.js";
import { chestRecords, type ChestRecordStatus, type ChestWorld } from "../world/chests.js";
import { Icon } from "../ui/Icon.js";
import { ContextMenu, type ContextMenuState } from "../ui/ContextMenu.js";
import { notify } from "../shell/notification-store.js";
import { chestTitle } from "./chest-fields.js";
import { ChestDialog } from "./ChestDialog.js";

/** The chests a list shows and the tiles that tell what object each record sits on. */
export interface EntitiesSource extends ChestWorld { readonly chests: readonly WorldChest[] }

/** One decoded record with what the lists show about it; `area` is its map target, null when it has none. */
export interface ChestRow {
  readonly chestIndex: number;
  readonly chest: WorldChest;
  /** The object's name on the map ("Gold Chest", "Dresser"), from the tile at the record's position. */
  readonly type: string;
  readonly status: ChestRecordStatus;
  readonly totalStack: number;
  readonly area: ChestArea | null;
}

export const STATUS_TEXT: Readonly<Record<ChestRecordStatus, string>> = {
  valid: "",
  outOfBounds: "Outside the world",
  mismatch: "No complete chest at this position",
  unknown: "The tile here is not a chest",
  ambiguous: "Overlaps another chest record",
};

export const chestName = (row: ChestRow): string => row.chest.name || row.type;
export const chestPosition = (chest: WorldChest): string => `${String(chest.x)}, ${String(chest.y)}`;
/** Sorts positions top to bottom, then left to right. */
export const positionOrder = (chest: WorldChest): number => chest.y * 1e5 + chest.x;

/** The record's name, or its object type when unnamed; records without a map target carry a warning. */
export function ChestName({ row }: { readonly row: ChestRow }): React.JSX.Element {
  const issue = STATUS_TEXT[row.status];
  return (
    <span className="chest-name" title={issue === "" ? undefined : issue}>
      {issue !== "" && <span className="chest-issue" role="img" aria-label={issue}><Icon name="warning" /></span>}
      {row.chest.name === "" ? <span className="muted">{row.type}</span> : row.chest.name}
    </span>
  );
}

/** One model per chest list, shared by the Entities list and the item search. */
const models = new WeakMap<readonly WorldChest[], readonly ChestRow[]>();

export function chestRows(source: EntitiesSource): readonly ChestRow[] {
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

/** The loaded world's chests, or null without a world or a decoded chest section. */
export function useLoadedChestSource(): EntitiesSource | null {
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

export function NoChests(): React.JSX.Element {
  const section = getDefaultWorldSession().getLoadedWorld()?.entities.Chests;
  return <p className="panel-empty">{section?.error === undefined ? "Open a world to inspect its chests." : "The chest section could not be decoded."}</p>;
}

/**
 * What every chest list does with a row: a click selects it (map highlight and Inspector, the camera stays), Enter or
 * a double-click goes to it (at once, zoomed in), and its context menu also opens the inventory or copies the position.
 */
export function useChestActions(source: EntitiesSource | null, rows: readonly ChestRow[]): {
  readonly select: (row: ChestRow) => void;
  readonly goTo: (row: ChestRow) => void;
  readonly showMenu: (row: ChestRow, at: ContextMenuState) => void;
  readonly overlays: React.JSX.Element;
} {
  const [menu, setMenu] = useState<(ContextMenuState & { readonly row: ChestRow }) | null>(null);
  const [open, setOpen] = useState<ChestRow | null>(null);
  const closeMenu = useCallback(() => { setMenu(null); }, []);
  const closeDialog = useCallback(() => { setOpen(null); }, []);
  // A new world drops the old one's open inventory and menu.
  if (open !== null && rows[open.chestIndex] !== open) setOpen(null);
  if (menu !== null && rows[menu.row.chestIndex] !== menu.row) setMenu(null);
  const goTo = (row: ChestRow): void => { if (source !== null) goToChest(row.chest, source, row.chestIndex, row.area); };
  const copy = (row: ChestRow): void => {
    const text = chestPosition(row.chest);
    void navigator.clipboard.writeText(text).then(
      () => { notify({ kind: "success", title: "Position copied", detail: text }); },
      () => { notify({ kind: "error", title: "Position not copied", detail: "The browser refused clipboard access." }); },
    );
  };
  return {
    select: (row) => { selectChest(row.chest, row.chestIndex, row.area); },
    goTo,
    showMenu: (row, at) => { setMenu({ ...at, row }); },
    overlays: (
      <>
        {menu !== null && (
          <ContextMenu
            at={menu} label={`${chestName(menu.row)} actions`} onClose={closeMenu}
            items={[
              { kind: "action", label: "Go to", icon: "target", shortcut: "Enter", onSelect: () => { goTo(menu.row); } },
              { kind: "action", label: "Open inventory", icon: "list", onSelect: () => { setOpen(menu.row); } },
              { kind: "separator" },
              { kind: "action", label: "Copy position", icon: "copy", detail: chestPosition(menu.row.chest), onSelect: () => { copy(menu.row); } },
            ]}
          />
        )}
        {open !== null && <ChestDialog chest={open.chest} title={open.type} onClose={closeDialog} />}
      </>
    ),
  };
}
