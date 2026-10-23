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

/** A side of the workbench where a folded area can be pulled out again by dragging. */
export type Edge = "left" | "right" | "top" | "bottom";

/**
 * Which panels are shown (open, active in their group, group visible): the activity bar's pressed state; and the
 * edges with a folded area, where the workbench shows a strip to drag it out again.
 */
export const useWorkbenchStore = create<{ readonly shown: ReadonlySet<string>; readonly foldedEdges: readonly Edge[] }>()(
  () => ({ shown: new Set(), foldedEdges: [] }),
);

let api: DockviewApi | null = null;
/** The panels each panel last shared a group with, so a closed panel reopens where it was. */
const lastMates = new Map<string, readonly string[]>();

/** Below this a panel's content would be squeezed: dragging an area under half of it snaps the area shut instead. */
const PANEL_MINIMUM = { minimumWidth: 220, minimumHeight: 120 };

export function registerWorkbench(next: DockviewApi | null): void {
  api = next;
  // Dev builds only: lets layout checks drive the dock from the console, as window.__studioBench does for rendering.
  if (import.meta.env.DEV) (window as unknown as { __studioWorkbench?: DockviewApi | null }).__studioWorkbench = next;
}

export function getWorkbench(): DockviewApi | null {
  return api;
}

interface FoldedMember { readonly group: DockviewGroupPanel; readonly width: number; readonly height: number }
/** An area folded as one: its groups with their sizes before folding, and the workbench edge it sat against. */
interface FoldedArea { readonly members: readonly FoldedMember[]; readonly edge: Edge | null }
const folded = new Map<DockviewGroupPanel, FoldedArea>();

/**
 * The side of the map a group sits on, from the layout itself (works for folded groups, whose box is empty): the split
 * that separates it from the map gives the axis, document order gives the side.
 */
function edgeOfGroup(group: DockviewGroupPanel): Edge | null {
  const map = api?.getPanel(MAP_PANEL)?.group.element;
  if (map === undefined) return null;
  let common: Element | null = group.element.parentElement;
  while (common !== null && !common.contains(map)) common = common.parentElement;
  const split = common?.closest(".dv-split-view-container");
  if (split === null || split === undefined) return null;
  const before = (map.compareDocumentPosition(group.element) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
  if (split.classList.contains("dv-horizontal")) return before ? "left" : "right";
  return before ? "top" : "bottom";
}

/** Folds groups as one area, remembering their sizes (or the given ones, from before a snapping drag). */
function fold(groups: readonly DockviewGroupPanel[], sizes?: ReadonlyMap<DockviewGroupPanel, DOMRect>): void {
  const members = groups.map((group) => {
    const rect = sizes?.get(group) ?? group.element.getBoundingClientRect();
    return { group, width: rect.width, height: rect.height };
  });
  const first = groups[0];
  const area = { members, edge: first === undefined ? null : edgeOfGroup(first) };
  for (const group of groups) { folded.set(group, area); group.api.setVisible(false); }
  refreshShownPanels();
}

/**
 * Unfolds a group with the groups folded together with it, at their remembered sizes; `size` overrides the size along
 * the edge's axis (a pull from the edge). Stacked groups without a remembered split share the stack evenly.
 */
function unfold(group: DockviewGroupPanel, size?: number): void {
  const area = folded.get(group);
  if (area === undefined) { group.api.setVisible(true); return; }
  const members = area.members.filter((member) => api?.groups.includes(member.group) === true);
  for (const member of area.members) folded.delete(member.group);
  for (const member of members) member.group.api.setVisible(true);
  const across = area.edge === "left" || area.edge === "right";
  const remembered = members.every((member) => member.width > 0);
  const stack = members.reduce((sum, member) => {
    const rect = member.group.element.getBoundingClientRect();
    return sum + (across ? rect.height : rect.width);
  }, 0);
  for (const member of members) {
    const along = size ?? (remembered ? (across ? member.width : member.height) : undefined);
    const cross = remembered ? (across ? member.height : member.width) : members.length > 1 ? stack / members.length : undefined;
    member.group.api.setSize(across
      ? { ...(along === undefined ? {} : { width: along }), ...(cross === undefined ? {} : { height: cross }) }
      : { ...(along === undefined ? {} : { height: along }), ...(cross === undefined ? {} : { width: cross }) });
  }
}

/**
 * Pulling a folded area out of its edge (the strip the workbench shows there), as in code editors: the area folded
 * last against that edge opens at the dragged size; returns a function that keeps resizing it while the drag goes on.
 */
export function pullOut(edge: Edge, size: number): (size: number) => void {
  const areas = [...new Set(folded.values())].filter((area) => area.edge === edge);
  const area = areas.at(-1);
  const first = area?.members[0]?.group;
  if (area === undefined || first === undefined) return () => undefined;
  const minimum = edge === "left" || edge === "right" ? PANEL_MINIMUM.minimumWidth : PANEL_MINIMUM.minimumHeight;
  unfold(first, Math.max(minimum, size));
  refreshShownPanels();
  const across = edge === "left" || edge === "right";
  return (next) => {
    for (const member of area.members) {
      if (api?.groups.includes(member.group) === true) member.group.api.setSize(across ? { width: next } : { height: next });
    }
  };
}

/** Every group but the map's keeps its panels from being squeezed below the minimum. */
export function configureGroup(group: DockviewGroupPanel): void {
  if (group.panels.some((panel) => panel.id === MAP_PANEL)) return;
  group.api.setConstraints(PANEL_MINIMUM);
}

/**
 * Snapping, as the side bar and panel of code editors: while an edge between areas is dragged, an area already at its
 * minimum folds once the pointer is past half that minimum inside it (every group along that edge folds together).
 * Unfolding it later restores its size. Returns the listener's removal.
 */
export function snapAreasWhileDragging(root: HTMLElement): () => void {
  const onPointerDown = (event: PointerEvent): void => {
    if (api === null || !(event.target instanceof Element) || event.target.closest(".dv-sash") === null) return;
    const sash = event.target.closest(".dv-sash")?.getBoundingClientRect();
    if (sash === undefined) return;
    const vertical = sash.height > sash.width; // a vertical edge is dragged sideways
    const line = vertical ? sash.x + sash.width / 2 : sash.y + sash.height / 2;
    const near = (a: number): boolean => Math.abs(a - line) <= 4;
    const docked = api.groups.filter((group) => group.api.location.type === "grid" && group.api.isVisible
      && !group.panels.some((panel) => panel.id === MAP_PANEL));
    const after = docked.filter((group) => near(vertical ? group.element.getBoundingClientRect().left : group.element.getBoundingClientRect().top));
    const before = docked.filter((group) => near(vertical ? group.element.getBoundingClientRect().right : group.element.getBoundingClientRect().bottom));
    const minimum = vertical ? PANEL_MINIMUM.minimumWidth : PANEL_MINIMUM.minimumHeight;
    const sizes = new Map(docked.map((group) => [group, group.element.getBoundingClientRect()]));
    const onMove = (move: PointerEvent): void => {
      const at = vertical ? move.clientX : move.clientY;
      const snapShut = (groups: readonly DockviewGroupPanel[], inside: (rect: DOMRect) => number): void => {
        const rect = groups[0]?.element.getBoundingClientRect();
        if (rect === undefined || (vertical ? rect.width : rect.height) > minimum + 1 || inside(rect) < minimum / 2) return;
        stop();
        fold(groups, sizes);
      };
      if (at > line) snapShut(after, (rect) => at - (vertical ? rect.left : rect.top));
      else snapShut(before, (rect) => (vertical ? rect.right : rect.bottom) - at);
    };
    const stop = (): void => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", stop, true);
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", stop, true);
  };
  root.addEventListener("pointerdown", onPointerDown, true);
  return () => { root.removeEventListener("pointerdown", onPointerDown, true); };
}

/** Recomputes which panels are visible; called on every layout change. */
export function refreshShownPanels(): void {
  if (api === null) return;
  const shown = new Set(api.panels.filter((panel) => panel.id !== MAP_PANEL && panel.api.isVisible && panel.group.api.isVisible).map((panel) => panel.id));
  for (const panel of api.panels) lastMates.set(panel.id, panel.group.panels.map((mate) => mate.id).filter((id) => id !== panel.id));
  // A group shown again by any other means (dragged into, docked into) is no longer folded.
  for (const group of folded.keys()) if (!api.groups.includes(group) || group.api.isVisible) folded.delete(group);
  // Folded areas restored with a stored arrangement: one area per edge, by where their panels belong.
  const orphans = api.groups.filter((group) => group.api.location.type === "grid" && !group.api.isVisible && !folded.has(group)
    && !group.panels.some((panel) => panel.id === MAP_PANEL));
  for (const edge of ["left", "right", "top", "bottom"] as const) {
    const members = orphans.filter((group) => edgeOfGroup(group) === edge).map((group) => ({ group, width: 0, height: 0 }));
    if (members.length === 0) continue;
    const area = { members, edge };
    for (const member of members) folded.set(member.group, area);
  }
  const foldedEdges = [...new Set([...folded.values()].flatMap((area) => (area.edge === null ? [] : [area.edge])))];
  useWorkbenchStore.setState({ shown, foldedEdges });
}

/** A group that already holds panels of an area, to open another panel of that area next to them. */
function groupOfArea(workbench: DockviewApi, area: PanelArea): DockviewGroupPanel | undefined {
  return workbench.panels.find((panel) => panelDefinition(panel.id)?.area === area && panel.group.api.location.type === "grid")?.group;
}

/**
 * Adds a panel back where it was (next to a panel it last shared a group with), else where its area is, creating the
 * area next to the map (or the side bar) when it is not there.
 */
export function addPanel(workbench: DockviewApi, definition: PanelDefinition): IDockviewPanel {
  const options = { id: definition.id, component: "panel", title: definition.title, params: { id: definition.id }, ...PANEL_MINIMUM };
  const mate = lastMates.get(definition.id)?.map((id) => workbench.getPanel(id)).find((panel) => panel !== undefined);
  if (mate !== undefined) return workbench.addPanel({ ...options, position: { referenceGroup: mate.group, direction: "within" } });
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
  unfold(panel.group);
  panel.api.setActive();
  refreshShownPanels();
}

/**
 * The one rule for showing panels (activity bar, View > Panels): a panel that is not in front is brought to the front,
 * unfolding its area if it was folded and reopening it where it was if it was closed; the panel already in front folds
 * its whole area (side bar, details or bottom panel), and the next click unfolds it with the same tabs and size. A
 * floating or popped-out panel is only brought to the front. Dragging an area's edge past half its minimum folds it the
 * same way (`snapAreasWhileDragging`); the close button on a tab closes the panel.
 */
export function togglePanel(id: PanelId): void {
  const panel = api?.getPanel(id);
  if (panel !== undefined && panel.api.isVisible && panel.group.api.isVisible && panel.group.api.location.type === "grid") {
    fold([panel.group]);
    return;
  }
  showPanel(id);
}

/** Ctrl+J for the bottom panel: shows its last panel, or folds it away when it is shown. */
export function toggleArea(area: PanelArea): void {
  if (api === null) return;
  const panels = api.panels.filter((panel) => panelDefinition(panel.id)?.area === area);
  const visible = panels.find((panel) => panel.api.isVisible && panel.group.api.isVisible);
  if (visible !== undefined) { fold([visible.group]); return; }
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
