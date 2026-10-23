import type { DockviewApi, DockviewGroupPanel, IDockviewPanel } from "dockview-react";
import { create } from "zustand";
import type { IconName } from "../ui/Icon.js";
import { useLayoutStore, type SectionId } from "./layout-store.js";

/** Where a panel opens by default: the side bar, the details pane under it, or the bottom panel (wide tables). */
export type PanelArea = "side" | "details" | "bottom";

export interface PanelDefinition {
  readonly id: string;
  readonly title: string;
  readonly icon: IconName;
  readonly area: PanelArea;
  /** Accordion sections shown inside the panel; a panel of one section shows its body without a header. */
  readonly sections: readonly SectionId[];
}

/** Every panel, in activity-bar order. The map is the workbench's centre and not a panel of this list. */
export const PANELS = [
  { id: "world", title: "World", icon: "world", area: "side", sections: ["world"] },
  { id: "layers", title: "Layers", icon: "layers", area: "side", sections: ["layers", "grid"] },
  { id: "swatches", title: "Swatches", icon: "palette", area: "side", sections: ["swatches"] },
  { id: "library", title: "Library", icon: "library", area: "side", sections: ["objects", "schematics"] },
  { id: "properties", title: "Properties", icon: "properties", area: "details", sections: ["inspector"] },
  { id: "history", title: "History", icon: "history", area: "details", sections: ["history"] },
  { id: "measurements", title: "Measurements", icon: "ruler", area: "details", sections: ["measurements"] },
  { id: "search", title: "Search", icon: "search", area: "bottom", sections: ["search"] },
  { id: "content", title: "Content", icon: "list", area: "bottom", sections: ["content"] },
  { id: "entities", title: "Entities", icon: "chest", area: "bottom", sections: ["entities"] },
  { id: "bookmarks", title: "Bookmarks", icon: "bookmark", area: "bottom", sections: ["bookmarks"] },
  { id: "statistics", title: "Statistics", icon: "stats", area: "bottom", sections: ["statistics"] },
] as const satisfies readonly PanelDefinition[];

export type PanelId = (typeof PANELS)[number]["id"];
export const MAP_PANEL = "map";

export function panelDefinition(id: string): PanelDefinition | undefined {
  return PANELS.find((panel) => panel.id === id);
}

/** Which panels are shown (open, active in their group, group visible): the activity bar's pressed state. */
export const useWorkbenchStore = create<{ readonly shown: ReadonlySet<string> }>()(() => ({ shown: new Set() }));

let api: DockviewApi | null = null;

export function registerWorkbench(next: DockviewApi | null): void {
  api = next;
}

export function getWorkbench(): DockviewApi | null {
  return api;
}

/** Recomputes which panels are visible; called on every layout change. */
export function refreshShownPanels(): void {
  if (api === null) return;
  const shown = new Set(api.panels.filter((panel) => panel.id !== MAP_PANEL && panel.api.isVisible && panel.group.api.isVisible).map((panel) => panel.id));
  useWorkbenchStore.setState({ shown });
}

/** A group that already holds panels of an area, to open another panel of that area next to them. */
function groupOfArea(workbench: DockviewApi, area: PanelArea): DockviewGroupPanel | undefined {
  return workbench.panels.find((panel) => panelDefinition(panel.id)?.area === area && panel.group.api.location.type === "grid")?.group;
}

/** Adds a panel where its area is, creating the area next to the map (or the side bar) when it is not there. */
export function addPanel(workbench: DockviewApi, definition: PanelDefinition): IDockviewPanel {
  const options = { id: definition.id, component: "panel", title: definition.title, params: { id: definition.id } };
  const group = groupOfArea(workbench, definition.area);
  if (group !== undefined) return workbench.addPanel({ ...options, position: { referenceGroup: group, direction: "within" } });
  if (definition.area === "details") {
    const side = groupOfArea(workbench, "side");
    if (side !== undefined) return workbench.addPanel({ ...options, position: { referenceGroup: side, direction: "below" } });
  }
  // Narrow screens have no room beside the map: every panel opens under it.
  if (definition.area === "bottom" || window.matchMedia("(max-width: 1023px)").matches) return workbench.addPanel({ ...options, position: { referencePanel: MAP_PANEL, direction: "below" }, initialHeight: 220 });
  return workbench.addPanel({ ...options, position: { referencePanel: MAP_PANEL, direction: "right" }, initialWidth: 320 });
}

/** Shows a panel wherever it is docked (opening it in its default area if it was closed), and shows the dock. */
export function showPanel(id: PanelId, section?: SectionId): void {
  const layout = useLayoutStore.getState();
  if (layout.dockHidden) layout.setDockHidden(false);
  if (section !== undefined) layout.setSectionOpen(section, true);
  if (api === null) return;
  const definition = panelDefinition(id);
  if (definition === undefined) return;
  const panel = api.getPanel(id) ?? addPanel(api, definition);
  panel.group.api.setVisible(true);
  panel.api.setActive();
  refreshShownPanels();
}

/**
 * The one rule for showing panels (activity bar, Window menu): a panel that is not in front is brought to the front,
 * unfolding its area if it was folded; the panel already in front folds its whole area (side bar, details or bottom
 * panel), and the next click unfolds it with the same tabs and size. A floating or popped-out panel is only brought
 * to the front. Panels are never removed: they are moved, floated or popped out, and Reset layout restores them.
 */
export function togglePanel(id: PanelId): void {
  const panel = api?.getPanel(id);
  if (panel !== undefined && panel.api.isVisible && panel.group.api.isVisible && panel.group.api.location.type === "grid") {
    panel.group.api.setVisible(false);
    refreshShownPanels();
    return;
  }
  showPanel(id);
}

/** Ctrl+J for the bottom panel: shows its last panel, or folds it away when it is shown. */
export function toggleArea(area: PanelArea): void {
  if (api === null) return;
  const panels = api.panels.filter((panel) => panelDefinition(panel.id)?.area === area);
  const visible = panels.find((panel) => panel.api.isVisible && panel.group.api.isVisible);
  if (visible !== undefined) { visible.group.api.setVisible(false); refreshShownPanels(); return; }
  const first = panels[0] ?? PANELS.find((panel) => panel.area === area);
  if (first !== undefined) showPanel(first.id as PanelId);
}

/** The areas that were unfolded when Show panels (`P`) hid them, so showing brings back exactly those. */
let hiddenByShowPanels: DockviewGroupPanel[] = [];

/** Show panels (`P`): folds every docked area except the map's, and later unfolds the same ones. */
export function setPanelsHidden(hidden: boolean): void {
  if (api === null) return;
  if (hidden) {
    hiddenByShowPanels = api.groups.filter((group) => group.api.location.type === "grid" && group.api.isVisible
      && !group.panels.some((panel) => panel.id === MAP_PANEL));
    for (const group of hiddenByShowPanels) group.api.setVisible(false);
  } else {
    for (const group of hiddenByShowPanels) if (api.groups.includes(group)) group.api.setVisible(true);
    hiddenByShowPanels = [];
  }
  refreshShownPanels();
}

/** Moves a panel into the side bar, the details pane or the bottom panel (the keyboard path for docking). */
export function movePanel(id: string, area: PanelArea): void {
  const panel = api?.getPanel(id);
  if (api === null || panel === undefined) return;
  const target = groupOfArea(api, area);
  if (target !== undefined && target !== panel.group) {
    panel.api.moveTo({ group: target });
  } else if (target === undefined) {
    api.removePanel(panel);
    const definition = panelDefinition(id);
    if (definition !== undefined) addPanel(api, { ...definition, area }).api.setActive();
  }
  refreshShownPanels();
}
