import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_ZOOM, MIN_ZOOM, type MapRendererStats } from "@studio/renderer";
import type { WorldChest } from "@studio/world-codec";
import type { Tile } from "@studio/world-model";
import { chestTitle } from "../panels/chest-fields.js";
import { useAppStore } from "../store.js";
import { canonicalWorldOf } from "../world/canonical-world.js";
import { useBrushStore } from "../world/brush-session.js";
import { chestLookupOf } from "../world/chests.js";
import { describeTile } from "../world/content-names.js";
import { depthLabel, type DepthLevels } from "../world/depth.js";
import { getDefaultWorldSession } from "../world/world-session.js";
import { getMapController, useViewStore } from "./view-store.js";

/** What the status bar reads of a world: its levels, the tile view at a coordinate and the chest standing there. */
export interface StatusWorld extends DepthLevels {
  readonly tileAt: (x: number, y: number) => Tile;
  readonly chestAt?: (x: number, y: number) => WorldChest | null;
}

function sessionStatusWorld(): StatusWorld | null {
  const loaded = getDefaultWorldSession().getLoadedWorld();
  if (loaded === null) return null;
  const { height, surfaceLevel, rockLevel } = loaded.metadata;
  return { height, surfaceLevel, rockLevel, tileAt: (x, y) => canonicalWorldOf(loaded).tileAt(x, y), chestAt: chestLookupOf(loaded) };
}

const STATS_INTERVAL_MS = 500;

/** "Chest: Ores · 2 of 40 slots": the object, its name when it has one, and how many slots are filled. */
function describeChest(chest: WorldChest, origin: Tile): string {
  const title = chestTitle(origin);
  return `${chest.name.length > 0 ? `${title}: ${chest.name}` : title} · ${String(chest.items.length)} of ${String(chest.slotCount)} slots`;
}

function RenderStats(): React.JSX.Element {
  const [stats, setStats] = useState<MapRendererStats | null>(null);
  useEffect(() => {
    const read = (): void => {
      setStats(getMapController()?.stats() ?? null);
    };
    read();
    const timer = window.setInterval(read, STATS_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  if (stats === null) return <span className="status-cell muted">No renderer</span>;
  return (
    <span className="status-cell status-stats" title="Render stats" data-testid="render-stats">
      {Object.entries(stats).map(([name, value]) => `${name} ${String(Array.isArray(value) ? value.length : value)}`).join(" · ")}
    </span>
  );
}

/** "250", "250 %", "62,5%" → 2.5 / 0.625 pixels per tile; anything else is not a zoom. */
export function parseZoomPercent(text: string): number | null {
  const value = Number(text.replace(/%/g, "").replace(",", ".").trim());
  return text.trim().length > 0 && Number.isFinite(value) && value > 0 ? value / 100 : null;
}

const ZOOM_RANGE = `${String(MIN_ZOOM * 100)} %–${String(MAX_ZOOM * 100)} %`;

/**
 * The zoom in the bottom-right corner, as in image editors: a click turns it into a field; Enter (or leaving the
 * field) zooms to the typed percentage around the centre of the view, clamped to what the map supports; Escape
 * leaves it unchanged.
 */
function ZoomField({ zoom }: { readonly zoom: number | null }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  if (zoom === null) return <span className="status-cell status-zoom" title="Zoom" data-testid="zoom" />;
  const shown = `${String(Math.round(zoom * 100))}%`;
  const commit = (): void => {
    setEditing(false);
    const next = parseZoomPercent(text);
    if (next !== null) getMapController()?.zoomTo(next);
  };
  if (!editing) {
    return (
      <button
        type="button" className="status-cell status-zoom status-zoom-button" data-testid="zoom"
        aria-label={`Zoom ${shown}, click to type a zoom`} title={`Zoom: click to type a value (${ZOOM_RANGE})`}
        onClick={() => {
          setText(String(Math.round(zoom * 100)));
          setEditing(true);
        }}
      >
        {shown}
      </button>
    );
  }
  return (
    <input
      ref={input}
      className="status-zoom-input"
      aria-label={`Zoom in percent (${ZOOM_RANGE})`}
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setText("");
          setEditing(false);
        }
      }}
    />
  );
}

/**
 * The bottom bar: cursor tile, its depth band, what is at it, zoom, and render stats on demand. Values are tabular
 * numerals in fixed-width cells, so the bar never shifts while the pointer moves.
 */
export function StatusBar({ world }: { readonly world?: StatusWorld | null }): React.JSX.Element {
  useBrushStore((state) => state.revision);
  const summary = useAppStore((state) => state.summary);
  const worldRevision = useAppStore((state) => state.worldRevision);
  const hasWorld = summary !== null;
  const hover = useViewStore((state) => state.hoverTile);
  const zoom = useViewStore((state) => state.zoom);
  const statsVisible = useViewStore((state) => state.statsVisible);
  // A new summary means a newly loaded world; the session is not reactive, the store is.
  const sessionWorld = useMemo(() => (hasWorld ? sessionStatusWorld() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild on new tiles, not on metadata edits
    [hasWorld, worldRevision]);
  const shown = world === undefined ? sessionWorld : world;
  const inWorld = hover !== null && shown !== null && hover.y >= 0 && hover.y < shown.height;
  const chest = inWorld ? shown.chestAt?.(hover.x, hover.y) ?? null : null;
  const chestText = inWorld && chest !== null ? describeChest(chest, shown.tileAt(chest.x, chest.y)) : "";

  return (
    <footer className="status-bar">
      <span className="status-cell status-cursor" title="Tile under the pointer" data-testid="cursor-tile">
        {hover === null ? "—" : `${String(hover.x)}, ${String(hover.y)}`}
      </span>
      <span className="status-cell status-depth" title="Depth" data-testid="depth">
        {inWorld ? depthLabel(hover.y, shown) : ""}
      </span>
      <span className="status-cell status-tile" title="Block, wall and liquid under the pointer" data-testid="tile-under-cursor">
        {inWorld ? describeTile(shown.tileAt(hover.x, hover.y)) : ""}
      </span>
      <span className="status-cell status-chest" title="Chest under the pointer" data-testid="chest-under-cursor">
        {chestText}
      </span>
      <span className="status-spacer" />
      {statsVisible && <RenderStats />}
      <ZoomField zoom={zoom} />
    </footer>
  );
}
