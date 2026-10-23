import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DockviewReact, type DockviewApi, type IDockviewPanelHeaderProps, type DockviewReadyEvent, type DockviewTheme, type IDockviewPanelProps, type SerializedDockview } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { MapView } from "../components/MapView.js";
import { ContentPanel } from "../panels/ContentPanel.js";
import { EntitiesPanel } from "../panels/EntitiesPanel.js";
import { GridPanel } from "../panels/GridPanel.js";
import { InspectorPanel } from "../panels/InspectorPanel.js";
import { LayersPanel } from "../panels/LayersPanel.js";
import { MeasurementsPanel } from "../panels/MeasurementsPanel.js";
import { BookmarksPanel, HistoryPanel, ObjectsPanel, SchematicsPanel, StatisticsPanel } from "../panels/planned.js";
import { SearchPanel } from "../panels/search/SearchPanel.js";
import { SwatchesPanel } from "../panels/SwatchesPanel.js";
import { WorldPanel, WorldPanelActions } from "../panels/WorldPanel.js";
import { Icon } from "../ui/Icon.js";
import { Section } from "../ui/Section.js";
import type { Command } from "./commands.js";
import { SECTION_TITLES, useLayoutStore, type SectionId } from "./layout-store.js";
import {
  addPanel, configureGroup, MAP_PANEL, pullOut, snapAreasWhileDragging, type Edge, movePanel, PANELS, panelDefinition, refreshShownPanels, registerWorkbench, setPanelsHidden, togglePanel,
  useWorkbenchStore, type PanelArea,
} from "./workbench-api.js";

interface SectionDefinition {
  readonly body: (commands: readonly Command[]) => React.JSX.Element;
  /** Header controls, shown while the section is open (or at the top of a one-section panel). */
  readonly actions?: (commands: readonly Command[]) => React.JSX.Element;
}

const SECTIONS: Readonly<Record<SectionId, SectionDefinition>> = {
  world: { body: () => <WorldPanel />, actions: (commands) => <WorldPanelActions commands={commands} /> },
  layers: { body: (commands) => <LayersPanel commands={commands} /> },
  grid: { body: () => <GridPanel /> },
  measurements: { body: () => <MeasurementsPanel /> },
  inspector: { body: () => <InspectorPanel /> },
  history: { body: () => <HistoryPanel /> },
  content: { body: () => <ContentPanel /> },
  entities: { body: () => <EntitiesPanel /> },
  search: { body: () => <SearchPanel /> },
  bookmarks: { body: (commands) => <BookmarksPanel commands={commands} /> },
  statistics: { body: (commands) => <StatisticsPanel commands={commands} /> },
  swatches: { body: () => <SwatchesPanel /> },
  objects: { body: (commands) => <ObjectsPanel commands={commands} /> },
  schematics: { body: (commands) => <SchematicsPanel commands={commands} /> },
};

/** Panels are rendered by dockview in portals; the commands reach them through context, not panel params. */
const WorkbenchContext = createContext<{ readonly commands: readonly Command[]; readonly renderer: string }>({ commands: [], renderer: "" });

function PanelSection({ id, commands }: { readonly id: SectionId; readonly commands: readonly Command[] }): React.JSX.Element {
  const open = useLayoutStore((state) => state.sections[id]);
  const setSectionOpen = useLayoutStore((state) => state.setSectionOpen);
  const definition = SECTIONS[id];
  return (
    <Section
      title={SECTION_TITLES[id]}
      {...(open && definition.actions !== undefined ? { actions: definition.actions(commands) } : {})}
      open={open}
      onOpenChange={(next) => { setSectionOpen(id, next); }}
    >
      {definition.body(commands)}
    </Section>
  );
}

/** A panel's content: one section's body directly, or several sections as an accordion. */
function PanelBody({ params }: IDockviewPanelProps<{ readonly id: string }>): React.JSX.Element | null {
  const { commands } = useContext(WorkbenchContext);
  const definition = panelDefinition(params.id);
  if (definition === undefined) return null;
  const [only] = definition.sections;
  if (definition.sections.length === 1 && only !== undefined) {
    const section = SECTIONS[only];
    return (
      <div className="workbench-panel">
        {/* The panel's tab names it on screen; the heading keeps the outline (h2, then the panel's own h3). */}
        <h2 className="visually-hidden">{definition.title}</h2>
        {section.actions !== undefined && <div className="workbench-panel-actions">{section.actions(commands)}</div>}
        {section.body(commands)}
      </div>
    );
  }
  return (
    <div className="workbench-panel">
      {definition.sections.map((section) => <PanelSection key={section} id={section} commands={commands} />)}
    </div>
  );
}

function MapPanel(): React.JSX.Element {
  const { commands, renderer } = useContext(WorkbenchContext);
  return <MapView renderer={renderer} commands={commands} />;
}

const COMPONENTS = { map: MapPanel, panel: PanelBody };

/**
 * A panel's tab: its title and a close button for the pointer. The button is outside the accessibility tree and
 * the Tab order (a focusable control inside role="tab" is invalid): from the keyboard a panel closes through its
 * tab's menu, and comes back from the activity bar or View > Panels.
 */
function PanelTab({ api }: IDockviewPanelHeaderProps): React.JSX.Element {
  return (
    <span className="workbench-tab">
      <span className="workbench-tab-title">{api.title}</span>
      <span
        className="workbench-tab-close" aria-hidden="true" title="Close"
        onPointerDown={(event) => { event.stopPropagation(); }}
        onClick={(event) => { event.stopPropagation(); api.close(); }}
      >
        <Icon name="close" />
      </span>
    </span>
  );
}



/** Dockview drawn with the app's tokens (styles.css), in both themes. */
const THEME: DockviewTheme = { name: "studio", className: "dockview-theme-studio", gap: 0 };

/** The default arrangement: side bar (World, Layers, Swatches, Library) over Properties | History, tables below the map. */
function buildDefaultLayout(api: DockviewApi, container: HTMLElement | null): void {
  api.clear();
  // Dockview names a group's region after its panel: not "Map", which is the map's own main landmark.
  const map = api.addPanel({ id: MAP_PANEL, component: "map", title: "World map", renderer: "always" });
  map.group.header.hidden = true;
  map.group.locked = true;
  for (const definition of PANELS) addPanel(api, definition);
  for (const id of ["world", "properties", "search"]) api.getPanel(id)?.api.setActive();
  // Sizes apply to laid-out groups: lay out at the container's size first, in the same task.
  if (container !== null) api.layout(container.clientWidth, container.clientHeight, true);
  api.getPanel("world")?.group.api.setSize({ width: 320 });
  api.getPanel("properties")?.group.api.setSize({ height: 260 });
  // The tables start folded away; the activity bar or Ctrl+J brings them up.
  api.getPanel("search")?.group.api.setVisible(false);
}

/** Restores the stored arrangement; anything unreadable or without the map falls back to the default. */
function restoreLayout(api: DockviewApi, stored: unknown, container: HTMLElement | null): void {
  try {
    if (stored !== null && typeof stored === "object") {
      api.fromJSON(stored as SerializedDockview);
      const map = api.getPanel(MAP_PANEL);
      if (map !== undefined) {
        map.group.header.hidden = true;
        map.group.locked = true;
        return;
      }
    }
  } catch {
    // A layout from another version: start from the default arrangement.
  }
  buildDefaultLayout(api, container);
}

/** How far the pointer must travel into the workbench before a folded area starts coming out (a click does nothing). */
const PULL_THRESHOLD = 8;
const EDGE_LABELS: Readonly<Record<Edge, string>> = { left: "left", right: "right", top: "top", bottom: "bottom" };

/**
 * A strip along an edge where an area is folded: drag it inward to pull the area out at the dragged size, as the
 * folded side bar and panel of code editors open from their edge.
 */
function EdgeStrip({ edge, root }: { readonly edge: Edge; readonly root: React.RefObject<HTMLDivElement | null> }): React.JSX.Element {
  const onPointerDown = (down: React.PointerEvent): void => {
    down.preventDefault();
    // On the window: the strip goes away as soon as the area opens, and the drag keeps sizing it.
    let resize: ((size: number) => void) | null = null;
    const onMove = (move: PointerEvent): void => {
      const rect = root.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const size = { left: move.clientX - rect.left, right: rect.right - move.clientX, top: move.clientY - rect.top, bottom: rect.bottom - move.clientY }[edge];
      if (resize === null) { if (size >= PULL_THRESHOLD) resize = pullOut(edge, size); }
      else resize(size);
    };
    const stop = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  return (
    <div
      // Pointer only, as the edges between areas are; from the keyboard the activity bar unfolds an area.
      className="workbench-edge" data-edge={edge} aria-hidden="true" title={`Drag to open the folded ${EDGE_LABELS[edge]} panels`}
      onPointerDown={onPointerDown}
    />
  );
}

const MOVE_TARGETS: readonly (readonly [PanelArea, string])[] = [["side", "Move to side bar"], ["details", "Move to details"], ["bottom", "Move to bottom panel"]];

/**
 * The map and every panel in one dockview: drag a tab to another group or an edge to dock it there, float it, or
 * pop it out to its own window (tab context menu). The arrangement is remembered with the layout.
 */
export function Workbench({ commands, renderer }: { readonly commands: readonly Command[]; readonly renderer: string }): React.JSX.Element {
  const context = useMemo(() => ({ commands, renderer }), [commands, renderer]);
  const foldedEdges = useWorkbenchStore((state) => state.foldedEdges);
  // Dockview's layout announcements ("Layers moved to …") go to a polite status of the app's own: its built-in
  // region is role="alert", which would compete with the app's error alerts.
  const [announcement, setAnnouncement] = useState("");
  const dockHidden = useLayoutStore((state) => state.dockHidden);
  const ready = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const stopReset = useRef<(() => void) | null>(null);
  useEffect(() => () => { registerWorkbench(null); stopReset.current?.(); }, []);
  useEffect(() => (root.current === null ? undefined : snapAreasWhileDragging(root.current)), []);
  // Only a change of Show panels (P) folds or unfolds the areas; on mount onReady has already applied it.
  const appliedHidden = useRef(dockHidden);
  useEffect(() => {
    if (!ready.current || appliedHidden.current === dockHidden) return;
    appliedHidden.current = dockHidden;
    setPanelsHidden(dockHidden);
  }, [dockHidden]);

  const onReady = (event: DockviewReadyEvent): void => {
    const { api } = event;
    registerWorkbench(api);
    // Dockview always creates its own live regions; with `announcer` set they stay empty, but the assertive one is
    // role="alert", which assistive technology and the app's tests would take for an error.
    for (const region of document.querySelectorAll(".dv-live-region-assertive")) region.removeAttribute("role");
    api.onDidAddGroup(configureGroup);
    restoreLayout(api, useLayoutStore.getState().workbench, root.current);
    for (const group of api.groups) configureGroup(group);
    ready.current = true;
    if (useLayoutStore.getState().dockHidden) setPanelsHidden(true);
    refreshShownPanels();
    // View ▸ Reset layout forgets the stored arrangement: rebuild the default one.
    stopReset.current?.();
    stopReset.current = useLayoutStore.subscribe((state, previous) => {
      if (state.workbench === null && previous.workbench !== null) {
        buildDefaultLayout(api, root.current);
        for (const group of api.groups) configureGroup(group);
        refreshShownPanels();
      }
    });
    let timer: number | undefined;
    api.onDidLayoutChange(() => {
      refreshShownPanels();
      window.clearTimeout(timer);
      // Resizing fires per pointer move; the arrangement is stored once it settles.
      timer = window.setTimeout(() => { useLayoutStore.getState().setWorkbench(api.toJSON()); }, 300);
    });
  };

  return (
    <WorkbenchContext.Provider value={context}>
      <div ref={root} className="workbench">
        <DockviewReact
          theme={THEME}
          components={COMPONENTS}
          defaultTabComponent={PanelTab}
          onReady={onReady}
          popoutUrl={`${import.meta.env.BASE_URL}popout.html`}
          announcer={(event) => { setAnnouncement(event.message); }}
          getTabContextMenuItems={({ panel }) => panel.id === MAP_PANEL ? [] : [
            ...MOVE_TARGETS.map(([area, label]) => ({ label, action: () => { movePanel(panel.id, area); } })),
            "separator", "float", "popout", "maximize", "separator", "close",
          ]}
        />
        {foldedEdges.map((edge) => <EdgeStrip key={edge} edge={edge} root={root} />)}
        <span className="visually-hidden" role="status">{announcement}</span>
      </div>
    </WorkbenchContext.Provider>
  );
}

/**
 * The activity bar at the right edge, as in code editors: one icon per panel. A click shows the panel wherever it is
 * docked; clicking the panel already shown folds its group away.
 */
export function ActivityBar(): React.JSX.Element {
  const shown = useWorkbenchStore((state) => state.shown);
  return (
    <nav className="activity-bar" aria-label="Panels">
      {PANELS.map((panel, index) => (
        <span key={panel.id} className="activity-slot" data-break={index > 0 && PANELS[index - 1]?.area !== panel.area ? true : undefined}>
          <button
            type="button" className="icon-button activity-button" aria-label={panel.title} aria-pressed={shown.has(panel.id)}
            data-tooltip={panel.title} data-tooltip-side="left"
            onClick={(event) => {
              const icon = event.currentTarget;
              togglePanel(panel.id);
              // Showing a panel activates its group, which takes focus; a keyboard user stays on the activity bar.
              if (event.detail === 0) window.requestAnimationFrame(() => { icon.focus(); });
            }}
          >
            <Icon name={panel.icon} />
          </button>
        </span>
      ))}
    </nav>
  );
}
