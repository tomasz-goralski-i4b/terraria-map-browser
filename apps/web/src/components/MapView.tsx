import { useMemo } from "react";
import type { RenderableWorld } from "@studio/renderer";
import { dismissAssetNotice, useAssetStore } from "../assets/asset-session.js";
import { useAppStore } from "../store.js";
import { Icon } from "../ui/Icon.js";
import { toRenderableWorld } from "../world/renderable-world.js";
import { getDefaultWorldSession } from "../world/world-session.js";
import { useExportStore } from "../world/export-world.js";
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
  const assetNotice = useAssetStore((state) => state.notice);
  const exported = useExportStore();
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
        <p className="map-message" style={MESSAGE_STYLE}>
          Loading {loadingFileName}…{" "}
          <button
            type="button"
            className="button"
            onClick={() => {
              getDefaultWorldSession().cancel();
            }}
          >
            Cancel
          </button>
        </p>
      )}
      {phase === "failed" && error !== null && (
        <p role="alert" className="map-message map-message-error" style={MESSAGE_STYLE}>
          Could not open {error.fileName}: {error.code} at offset {error.offset}. {error.message}
        </p>
      )}
      {exported.error !== null && (
        <p role="alert" className="map-message map-message-error" style={MESSAGE_STYLE}>Could not export world: {exported.error}</p>
      )}
      {exported.message !== null && (
        <p role="status" className="map-message" style={MESSAGE_STYLE}>
          {exported.message}{" "}
          {exported.download !== null && <a href={exported.download.url} download={exported.download.name}>Download {exported.download.name}</a>}
        </p>
      )}
      {assetNotice !== null && (
        <p role="alert" className="map-message map-message-error" style={MESSAGE_STYLE}>
          <Icon name="warning" />
          <span>{assetNotice}</span>
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={dismissAssetNotice}><Icon name="close" /></button>
        </p>
      )}
      {drawn !== null && <MapCanvas world={drawn} />}
      {summary === null && phase === "idle" && (
        <div className="map-empty">
          <p className="map-empty-title">No world open</p>
          <p>Open a .wld file or drop it here.</p>
        </div>
      )}
    </main>
  );
}
