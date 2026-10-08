import { useMemo } from "react";
import type { Tile } from "@studio/world-model";
import { useLayoutStore } from "../shell/layout-store.js";
import { useViewStore, type TilePoint } from "../shell/view-store.js";
import { useAppStore } from "../store.js";
import { IconButton } from "../ui/IconButton.js";
import { PropertyGrid, type Property } from "../ui/PropertyGrid.js";
import { canonicalWorldOf } from "../world/canonical-world.js";
import { contentKey, contentName, paintName } from "../world/content-names.js";
import { getDefaultWorldSession } from "../world/world-session.js";

/** What the Inspector reads of a world: its size and the `tileAt` view (docs/cwm.md). */
export interface InspectorWorld {
  readonly width: number;
  readonly height: number;
  readonly tileAt: (x: number, y: number) => Tile;
}

function sessionInspectorWorld(): InspectorWorld | null {
  const loaded = getDefaultWorldSession().getLoadedWorld();
  if (loaded === null) return null;
  const { width, height } = loaded.metadata;
  return { width, height, tileAt: (x, y) => canonicalWorldOf(loaded).tileAt(x, y) };
}

const NONE = "None";
const WIRE_NAMES = ["Red", "Blue", "Green", "Yellow"] as const;
const SHAPE_NAMES: Readonly<Record<NonNullable<Tile["shape"]>, string>> = {
  full: "Full", half: "Half block", slopeTopRight: "Slope, top right", slopeTopLeft: "Slope, top left",
  slopeBottomRight: "Slope, bottom right", slopeBottomLeft: "Slope, bottom left",
};

const optionalNumber = (value: number | undefined): string => (value === undefined ? NONE : String(value));
const optionalPaint = (value: number | undefined): string => (value === undefined ? NONE : `${paintName(value)} (${String(value)})`);

/**
 * The fields of the tile's `tileAt` view. With `showAll`, every field in fixed rows (absent parts read "None", false
 * flags "No"), so rows do not jump between tiles. Otherwise only what the tile has: the keys present in its view,
 * wires when there are any, and flags that are set. A present liquid with amount 0 is shown either way.
 */
export function tileProperties(point: TilePoint, tile: Tile, showAll = true): Property[] {
  const wires = WIRE_NAMES.filter((_, bit) => (tile.wires & (1 << bit)) !== 0);
  const flag = (label: string, value: boolean | undefined): Property => ({ kind: "flag", label, value: value ?? false });
  const all: Property[] = [
    { kind: "text", label: "Position", value: `${String(point.x)}, ${String(point.y)}` },
    { kind: "text", label: "Block", value: tile.block === undefined ? NONE : `${contentName(tile.block, "block", tile)} (${contentKey(tile.block)})` },
    { kind: "text", label: "Wall", value: tile.wall === undefined ? NONE : `${contentName(tile.wall, "wall")} (${contentKey(tile.wall)})` },
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
  return all.filter((property) => property.kind === "flag" ? property.value : property.value !== NONE);
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

  if (shown === null) return <p className="panel-empty">Open a world to inspect its tiles.</p>;
  if (point === null || point.x < 0 || point.y < 0 || point.x >= shown.width || point.y >= shown.height) {
    return <p className="panel-empty">Hover a tile to preview it. With the Inspect tool (I), click a tile or press Enter to pin it.</p>;
  }
  return (
    <div className="inspector-panel">
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
    </div>
  );
}
