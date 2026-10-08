import { useEffect, useMemo, useState } from "react";
import type { MapRendererStats } from "@studio/renderer";
import type { Tile } from "@studio/world-model";
import { useAppStore } from "../store.js";
import { canonicalWorldOf } from "../world/canonical-world.js";
import { describeTile } from "../world/content-names.js";
import { depthLabel, type DepthLevels } from "../world/depth.js";
import { getDefaultWorldSession } from "../world/world-session.js";
import { getMapController, useViewStore } from "./view-store.js";

/** What the status bar reads of a world: its levels and the tile view at a coordinate. */
export interface StatusWorld extends DepthLevels {
  readonly tileAt: (x: number, y: number) => Tile;
}

function sessionStatusWorld(): StatusWorld | null {
  const loaded = getDefaultWorldSession().getLoadedWorld();
  if (loaded === null) return null;
  const { height, surfaceLevel, rockLevel } = loaded.metadata;
  return { height, surfaceLevel, rockLevel, tileAt: (x, y) => canonicalWorldOf(loaded).tileAt(x, y) };
}

const STATS_INTERVAL_MS = 500;

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

/**
 * The bottom bar: cursor tile, its depth band, what is at it, zoom, and render stats on demand. Values are tabular
 * numerals in fixed-width cells, so the bar never shifts while the pointer moves.
 */
export function StatusBar({ world }: { readonly world?: StatusWorld | null }): React.JSX.Element {
  const summary = useAppStore((state) => state.summary);
  const hover = useViewStore((state) => state.hoverTile);
  const zoom = useViewStore((state) => state.zoom);
  const statsVisible = useViewStore((state) => state.statsVisible);
  // A new summary means a newly loaded world; the session is not reactive, the store is.
  const sessionWorld = useMemo(() => (summary === null ? null : sessionStatusWorld()), [summary]);
  const shown = world === undefined ? sessionWorld : world;
  const inWorld = hover !== null && shown !== null && hover.y >= 0 && hover.y < shown.height;

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
      <span className="status-spacer" />
      {statsVisible && <RenderStats />}
      <span className="status-cell status-zoom" title="Zoom" data-testid="zoom">
        {zoom === null ? "" : `${String(Math.round(zoom * 100))}%`}
      </span>
    </footer>
  );
}
