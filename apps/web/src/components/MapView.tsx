import { useMemo } from "react";
import type { MapPalette, RenderableWorld } from "@studio/renderer";
import { useAppStore } from "../store.js";
import { getDefaultWorldSession } from "../world/world-session.js";
import { MapCanvas } from "./MapCanvas.js";
import { getDefaultMapPaletteImporter } from "../world/map-palette-importer.js";

/** The world metadata does not carry the surface row yet; Terraria puts it at roughly 30 % of the height. */
const SURFACE_FRACTION = 0.3;

/** The loaded world's planes and palette by reference; nothing is copied. */
function loadedRenderableWorld(mapPalette: MapPalette | null): RenderableWorld | null {
  const loaded = getDefaultWorldSession().getLoadedWorld();
  if (loaded === null) return null;
  const { width, height } = loaded.metadata;
  return {
    width, height, surfaceY: Math.round(height * SURFACE_FRACTION), planes: loaded.planes, palette: loaded.palette,
    ...(mapPalette === null ? {} : { mapPalette }),
  };
}

export interface MapViewProps {
  readonly renderer: string;
  /** World to draw, by reference; defaults to the world loaded by the default session. */
  readonly world?: RenderableWorld | null;
}

export function MapView({ renderer, world }: MapViewProps): React.JSX.Element {
  const phase = useAppStore((state) => state.phase);
  const loadingFileName = useAppStore((state) => state.loadingFileName);
  const summary = useAppStore((state) => state.summary);
  const error = useAppStore((state) => state.error);
  useAppStore((state) => state.paletteRevision);
  const mapPalette = getDefaultMapPaletteImporter().load();
  // A new summary means a newly loaded world; the session is not reactive, the store is.
  const sessionWorld = useMemo(() => (summary === null ? null : loadedRenderableWorld(mapPalette)), [summary, mapPalette]);
  const drawn = world === undefined ? sessionWorld : world;

  return (
    <main
      className="map-view"
      aria-label="Map"
      data-renderer={renderer}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file !== undefined) void getDefaultWorldSession().open(file);
      }}
    >
      {phase === "loading" && (
        <p>
          Loading {loadingFileName}…{" "}
          <button
            type="button"
            onClick={() => {
              getDefaultWorldSession().cancel();
            }}
          >
            Cancel
          </button>
        </p>
      )}
      {phase === "failed" && error !== null && (
        <p role="alert">
          Could not open {error.fileName}: {error.code} at offset {error.offset}. {error.message}
        </p>
      )}
      {drawn !== null && <MapCanvas world={drawn} />}
      {summary === null ? (
        phase === "idle" && <p>No world loaded. Open a .wld file or drop it here.</p>
      ) : (
        <section aria-label="World summary" className="world-summary">
          <h2>{summary.name}</h2>
          <dl>
            <dt>Size</dt>
            <dd>
              {summary.width} × {summary.height}
            </dd>
            <dt>Seed</dt>
            <dd>{summary.seed}</dd>
            <dt>Game mode</dt>
            <dd>{summary.mode}</dd>
            <dt>Evil</dt>
            <dd>{summary.evil}</dd>
            <dt>Format version</dt>
            <dd>{summary.formatVersion}</dd>
            <dt>Palette size</dt>
            <dd>{summary.paletteSize}</dd>
          </dl>
        </section>
      )}
    </main>
  );
}
