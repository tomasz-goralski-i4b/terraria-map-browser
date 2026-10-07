import type { RenderableWorld } from "@studio/renderer";
import { useAppStore } from "../store.js";
import { getDefaultWorldSession } from "../world/world-session.js";

export interface MapViewProps {
  readonly renderer: string;
  /** World to draw, by reference; defaults to the world loaded by the default session. */
  readonly world?: RenderableWorld | null;
}

// The canvas, camera input and status bar land here (issue #87).
export function MapView({ renderer }: MapViewProps): React.JSX.Element {
  const phase = useAppStore((state) => state.phase);
  const loadingFileName = useAppStore((state) => state.loadingFileName);
  const summary = useAppStore((state) => state.summary);
  const error = useAppStore((state) => state.error);

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
      {summary === null ? (
        phase === "idle" && <p>No world loaded. Open a .wld file or drop it here.</p>
      ) : (
        <section aria-label="World summary">
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
