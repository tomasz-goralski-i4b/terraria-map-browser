import { useMemo } from "react";
import type { RenderableWorld } from "@studio/renderer";
import { useAppStore } from "../store.js";
import { toRenderableWorld } from "../world/renderable-world.js";
import { getDefaultWorldSession } from "../world/world-session.js";
import { MapCanvas } from "./MapCanvas.js";

/**
 * Session messages stay above the canvas of a previously loaded world (which fills the view) and keep receiving
 * pointer input; inline so this holds without the app stylesheet, like the map overlays.
 */
const MESSAGE_STYLE: React.CSSProperties = { position: "relative", zIndex: 2 };

function loadedRenderableWorld(): RenderableWorld | null {
  const loaded = getDefaultWorldSession().getLoadedWorld();
  return loaded === null ? null : toRenderableWorld(loaded);
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
  // A new summary means a newly loaded world; the session is not reactive, the store is.
  const sessionWorld = useMemo(() => (summary === null ? null : loadedRenderableWorld()), [summary]);
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
        <p style={MESSAGE_STYLE}>
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
        <p role="alert" style={MESSAGE_STYLE}>
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
