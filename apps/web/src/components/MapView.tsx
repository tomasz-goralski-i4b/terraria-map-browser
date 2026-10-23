import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { RenderableWorld } from "@studio/renderer";
import { dismissAssetNotice, useAssetStore } from "../assets/asset-session.js";
import { useAppStore } from "../store.js";
import { Icon } from "../ui/Icon.js";
import { toRenderableWorld } from "../world/renderable-world.js";
import { getDefaultWorldSession } from "../world/world-session.js";
import { commandById, type Command } from "../shell/commands.js";
import { menuItem } from "../shell/TopBar.js";
import { showMeasurements } from "../shell/RulerOptions.js";
import { useViewStore } from "../shell/view-store.js";
import { showPanel } from "../shell/workbench-api.js";
import { ContextMenu } from "../ui/ContextMenu.js";
import type { MenuItem } from "../ui/Menu.js";
import { showSwatches } from "../panels/SwatchesPanel.js";
import { pickBrushMaterial, useBrushStore } from "../world/brush-session.js";
import { pasteBounds, useAreaStore } from "../world/area-session.js";
import { MapCanvas } from "./MapCanvas.js";
import { StartScreen } from "./StartScreen.js";

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
  readonly commands?: readonly Command[];
}

interface QuickMenuState {
  readonly at: { readonly x: number; readonly y: number };
  readonly tile: { readonly x: number; readonly y: number } | null;
}

/**
 * The right-click menu on the map: the active tool's frequent settings and actions at the pointer (as Krita's pop-up
 * palette or a context menu in image editors), then Undo and Redo. Every item is a command, so it is also in the menus.
 */
function quickMenuItems(commands: readonly Command[], tile: QuickMenuState["tile"]): MenuItem[] {
  const tool = useViewStore.getState().tool;
  const item = (id: string): MenuItem => menuItem(commandById(commands, id));
  const action = (label: string, onSelect: () => void, disabledReason?: string): MenuItem => ({
    kind: "action", label, onSelect, ...(disabledReason === undefined ? {} : { disabled: true, disabledReason }),
  });
  const toolLabel = commandById(commands, `tool.${tool}`).label;
  let toolItems: MenuItem[];
  if (tool === "brush" || tool === "erase") {
    toolItems = [
      item("tool.brushSmaller"), item("tool.brushLarger"), item("tool.brushShape"), item("tool.brushSmooth"),
      ...(tool === "brush" ? [
        { kind: "separator" } as const,
        action("Pick materials here", () => { if (tile !== null) pickBrushMaterial(tile.x, tile.y); }, tile === null ? "Outside the world" : undefined),
        action("Choose material…", () => { showSwatches("block"); }),
      ] : []),
    ];
  } else if (tool === "select") {
    toolItems = [item("edit.cut"), item("edit.copy"), item("edit.paste"), item("edit.cancelArea"), item("select.all")];
  } else if (tool === "ruler") {
    toolItems = [item("tool.deleteMeasurement"), action("Show measurements", showMeasurements)];
  } else {
    toolItems = [action("Inspect this tile", () => {
      if (tile === null) return;
      useViewStore.getState().setPinnedTile(tile);
      showPanel("properties");
    }, tile === null ? "Outside the world" : undefined)];
  }
  return [
    { kind: "heading", label: tile === null ? toolLabel : `${toolLabel} · ${String(tile.x)}, ${String(tile.y)}` },
    ...toolItems,
    { kind: "separator" }, item("edit.undo"), item("edit.redo"),
    { kind: "separator" }, item("view.fit"), item("view.actual"),
  ];
}

const HUD_MS = 1200;

/** A short readout at the bottom of the map while a gesture changes something: the brush size, the selection's size. */
function GestureHud(): React.JSX.Element | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    const show = (next: string): void => {
      setText(next);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { setText(null); }, HUD_MS);
    };
    const stopBrush = useBrushStore.subscribe((state, previous) => {
      if (state.size !== previous.size) show(`Brush ${String(state.size)} × ${String(state.size)}`);
    });
    const stopArea = useAreaStore.subscribe((state, previous) => {
      if (state.selection === previous.selection && state.position === previous.position) return;
      const area = state.pasting ? pasteBounds() : state.selection;
      if (area !== null) show(`${String(area.width)} × ${String(area.height)} blocks`);
    });
    return () => { stopBrush(); stopArea(); window.clearTimeout(timer); };
  }, []);
  if (text === null) return null;
  return <div className="gesture-hud" aria-hidden="true">{text}</div>;
}

export function MapView({ renderer, world, commands }: MapViewProps): React.JSX.Element {
  const phase = useAppStore((state) => state.phase);
  const loadingFileName = useAppStore((state) => state.loadingFileName);
  const summary = useAppStore((state) => state.summary);
  const worldRevision = useAppStore((state) => state.worldRevision);
  const hasWorld = summary !== null;
  const error = useAppStore((state) => state.error);
  const assetNotice = useAssetStore((state) => state.notice);
  // A new summary means a newly loaded world; the session is not reactive, the store is.
  const sessionWorld = useMemo(() => (hasWorld ? loadedRenderableWorld() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild on new tiles, not on metadata edits
    [hasWorld, worldRevision]);
  const drawn = world === undefined ? sessionWorld : world;
  const [quickMenu, setQuickMenu] = useState<QuickMenuState | null>(null);

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
      {assetNotice !== null && (
        <p role="alert" className="map-message map-message-error" style={MESSAGE_STYLE}>
          <Icon name="warning" />
          <span>{assetNotice}</span>
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={dismissAssetNotice}><Icon name="close" /></button>
        </p>
      )}
      {drawn !== null && <MapCanvas world={drawn} {...(commands === undefined ? {} : { onQuickMenu: (at, tile) => { setQuickMenu({ at, tile }); } })} />}
      {drawn !== null && <GestureHud />}
      {/* On the page, not in the map's dock group, so it is drawn over the panels next to the map. */}
      {quickMenu !== null && commands !== undefined && createPortal(
        <ContextMenu at={quickMenu.at} label="Map" items={quickMenuItems(commands, quickMenu.tile)} onClose={() => { setQuickMenu(null); }} />,
        document.body,
      )}
      {drawn === null && phase === "idle" && (
        <StartScreen commands={commands} />
      )}
    </main>
  );
}
