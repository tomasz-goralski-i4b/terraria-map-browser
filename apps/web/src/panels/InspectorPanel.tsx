import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorldChest } from "@studio/world-codec";
import type { Tile } from "@studio/world-model";
import { useLayoutStore } from "../shell/layout-store.js";
import { useViewStore, type TilePoint } from "../shell/view-store.js";
import { useAppStore } from "../store.js";
import { IconButton } from "../ui/IconButton.js";
import { PropertyGrid, type Property } from "../ui/PropertyGrid.js";
import { canonicalWorldOf } from "../world/canonical-world.js";
import { chestLookupOf } from "../world/chests.js";
import { contentName, paintName } from "../world/content-names.js";
import { getDefaultWorldSession } from "../world/world-session.js";
import { ChestDialog } from "./ChestDialog.js";
import { chestProperties, chestTitle } from "./chest-fields.js";

/** What the Inspector reads of a world: its size, the `tileAt` view (docs/cwm.md) and the chest standing on a tile. */
export interface InspectorWorld {
  readonly width: number;
  readonly height: number;
  readonly tileAt: (x: number, y: number) => Tile;
  readonly chestAt?: (x: number, y: number) => WorldChest | null;
}

function sessionInspectorWorld(): InspectorWorld | null {
  const loaded = getDefaultWorldSession().getLoadedWorld();
  if (loaded === null) return null;
  const { width, height } = loaded.metadata;
  return { width, height, tileAt: (x, y) => canonicalWorldOf(loaded).tileAt(x, y), chestAt: chestLookupOf(loaded) };
}

const NONE = "None";
const WIRE_NAMES = ["Red", "Blue", "Green", "Yellow"] as const;
const SHAPE_NAMES: Readonly<Record<NonNullable<Tile["shape"]>, string>> = {
  full: "Full", half: "Half block", slopeTopRight: "Slope, top right", slopeTopLeft: "Slope, top left",
  slopeBottomRight: "Slope, bottom right", slopeBottomLeft: "Slope, bottom left",
};

const RAW_FRAME: ReadonlySet<string> = new Set(["Frame X", "Frame Y"]);
const optionalNumber = (value: number | undefined): string => (value === undefined ? NONE : String(value));
const optionalPaint = (value: number | undefined): string => (value === undefined ? NONE : paintName(value));

/**
 * The fields of the tile's `tileAt` view. With `showAll`, every field in fixed rows (absent parts read "None", false
 * flags "No"), so rows do not jump between tiles. Otherwise only what the tile has: the keys present in its view,
 * wires when there are any, and flags that are set. A present liquid with amount 0 is shown either way. The raw
 * frame (sprite-sheet pixels) is shown with `showAll` only, until objects resolve it to a style and part.
 */
export function tileProperties(point: TilePoint, tile: Tile, showAll = true): Property[] {
  const wires = WIRE_NAMES.filter((_, bit) => (tile.wires & (1 << bit)) !== 0);
  const flag = (label: string, value: boolean | undefined): Property => ({ kind: "flag", label, value: value ?? false });
  const all: Property[] = [
    { kind: "text", label: "Position", value: `${String(point.x)}, ${String(point.y)}` },
    { kind: "text", label: "Block", value: tile.block === undefined ? NONE : contentName(tile.block, "block", tile) },
    { kind: "text", label: "Wall", value: tile.wall === undefined ? NONE : contentName(tile.wall, "wall") },
    { kind: "text", label: "Frame X", value: optionalNumber(tile.frameX) },
    { kind: "text", label: "Frame Y", value: optionalNumber(tile.frameY) },
    { kind: "text", label: "Shape", value: tile.shape === undefined ? NONE : SHAPE_NAMES[tile.shape] },
    { kind: "text", label: "Block paint", value: optionalPaint(tile.paint) },
    { kind: "text", label: "Wall paint", value: optionalPaint(tile.wallPaint) },
    { kind: "text", label: "Liquid", value: tile.liquid === undefined ? NONE : tile.liquid.kind.charAt(0).toUpperCase() + tile.liquid.kind.slice(1) },
    { kind: "text", label: "Liquid amount", value: tile.liquid === undefined ? NONE : String(tile.liquid.amount) },
    { kind: "text", label: "Wires", value: wires.length === 0 ? NONE : wires.join(", ") },
    flag("Actuator", tile.actuator),
    flag("Inactive", tile.inactive),
    flag("Invisible block", tile.invisibleBlock),
    flag("Invisible wall", tile.invisibleWall),
    flag("Full-bright block", tile.fullBrightBlock),
    flag("Full-bright wall", tile.fullBrightWall),
  ];
  if (showAll) return all;
  // Shy: drop what the tile does not have.
  return all.filter((property) => property.kind === "flag" ? property.value : property.value !== NONE && !RAW_FRAME.has(property.label));
}

/**
 * Keeps the panel at the tallest height it reached during one hover pass, so the shy view's changing row count does
 * not make the dock below jump on every tile. A pass ends when the pointer leaves the map, a tile is pinned or
 * unpinned, or the empty-field view is toggled; then the panel fits its content again.
 */
function useHoverHeight(reset: string): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const tallest = useRef(0);
  const lastReset = useRef(reset);
  // Leaving the map can be followed by a new hover within one batch, so it is watched on the store, not in render.
  useEffect(() => useViewStore.subscribe((state, previous) => {
    if (state.hoverTile === null && previous.hoverTile !== null) tallest.current = 0;
  }), []);
  useLayoutEffect(() => {
    const panel = ref.current;
    if (panel === null) return;
    if (lastReset.current !== reset) {
      lastReset.current = reset;
      tallest.current = 0;
    }
    panel.style.minHeight = "";
    tallest.current = Math.max(tallest.current, panel.getBoundingClientRect().height);
    panel.style.minHeight = `${String(tallest.current)}px`;
  });
  return ref;
}

/** The tile pinned with the Inspect tool, or a preview of the hovered tile when nothing is pinned. */
export function InspectorPanel({ world }: { readonly world?: InspectorWorld | null }): React.JSX.Element {
  const summary = useAppStore((state) => state.summary);
  const pinned = useViewStore((state) => state.pinnedTile);
  const hover = useViewStore((state) => state.hoverTile);
  const setPinned = useViewStore((state) => state.setPinnedTile);
  const showAll = useLayoutStore((state) => state.inspectorShowAll);
  const setShowAll = useLayoutStore((state) => state.setInspectorShowAll);
  // A new summary means a newly loaded world; the session is not reactive, the store is.
  const sessionWorld = useMemo(() => (summary === null ? null : sessionInspectorWorld()), [summary]);
  const shown = world === undefined ? sessionWorld : world;
  const point = pinned ?? hover;
  const chest = point === null ? null : shown?.chestAt?.(point.x, point.y) ?? null;
  const [openChest, setOpenChest] = useState<WorldChest | null>(null);
  const closeChest = useCallback(() => {
    setOpenChest(null);
  }, []);
  const panelRef = useHoverHeight(`${pinned === null ? "hover" : `${String(pinned.x)},${String(pinned.y)}`}|${String(showAll)}`);

  if (shown === null) return <p className="panel-empty">Open a world to inspect its tiles.</p>;
  if (point === null || point.x < 0 || point.y < 0 || point.x >= shown.width || point.y >= shown.height) {
    return <p className="panel-empty">Hover a tile to preview it. With the Inspect tool (I), click a tile or press Enter to pin it.</p>;
  }
  return (
    <div className="inspector-panel" ref={panelRef}>
      <div className="inspector-header">
        <span className="inspector-state" data-pinned={pinned !== null}>{pinned === null ? "Hover preview" : "Pinned"}</span>
        <span className="inspector-actions">
          {/* The same eye as the Layers rows: pressed (open eye) shows the empty fields too. */}
          <IconButton icon={showAll ? "eye" : "eyeOff"} label="Show empty fields" pressed={showAll} tooltipSide="left" onClick={() => {
            setShowAll(!showAll);
          }} />
          {pinned !== null && (
          <IconButton icon="close" label="Unpin tile" shortcut="Escape" tooltipSide="left" onClick={() => {
              setPinned(null);
            }} />
          )}
        </span>
      </div>
      <PropertyGrid label="Tile" properties={tileProperties(point, shown.tileAt(point.x, point.y), showAll)} />
      {chest !== null && (
        <>
          <h3 className="inspector-subheading">{chestTitle(shown.tileAt(chest.x, chest.y))}</h3>
          <PropertyGrid label="Chest" properties={chestProperties(chest, shown.tileAt(chest.x, chest.y), showAll, () => {
            setOpenChest(chest);
          })} />
        </>
      )}
      {openChest !== null && <ChestDialog chest={openChest} title={chestTitle(shown.tileAt(openChest.x, openChest.y))} onClose={closeChest} />}
    </div>
  );
}
