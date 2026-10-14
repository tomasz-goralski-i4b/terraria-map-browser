import { create } from "zustand";
import { useAppStore } from "../store.js";
import { GO_TO_ZOOM, stepChest, useChestNavigation } from "./chest-navigation.js";
import type { ContentSelection, ContentStep, ContentStepIndex } from "./content-search.js";
import { getMapController, useViewStore } from "../shell/view-store.js";
import { useLayoutStore } from "../shell/layout-store.js";

/**
 * Where the one Search box looks. Each scope lists its own results and highlights its own matches; a new scope
 * (signs, NPCs) is one more entry in SEARCH_SCOPES and one results component, with no change to the box or commands.
 */
export type SearchScope = "content" | "items";

export interface SearchScopeInfo { readonly id: SearchScope; readonly label: string; readonly placeholder: string }
export const SEARCH_SCOPES: readonly SearchScopeInfo[] = [
  { id: "content", label: "Content", placeholder: "Block, wall or liquid: name or ID" },
  { id: "items", label: "Items in chests", placeholder: "Item: name or ID" },
];

interface SearchState {
  readonly scope: SearchScope;
  readonly query: string;
  /** Bumped by Find, so the Search section focuses its box. */
  readonly requested: number;
  /** Darken everything but the content matches. */
  readonly dim: boolean;
  /** One content entry (`block:3`) the results are narrowed to; null for all matching entries. */
  readonly contentFilter: string | null;
  /** The content the map highlights; null when there is none. */
  readonly highlight: ContentSelection | null;
  /** The step index of `highlight`, once built. */
  readonly stepIndex: ContentStepIndex | null;
  /** The match last stepped to. */
  readonly position: ContentStep | null;
  /** Go to the first match as soon as the step index is ready (Find on map). */
  readonly stepPending: boolean;
}

export const useSearchStore = create<SearchState>()(() => ({
  scope: "content", query: "", requested: 0, dim: true, contentFilter: null, highlight: null, stepIndex: null, position: null, stepPending: false,
}));

function clearChestResults(): void {
  useChestNavigation.setState({ areas: [], selected: null, selectedIndex: null, itemFilter: null });
}

function clearContentResults(): void {
  useSearchStore.setState({ contentFilter: null, highlight: null, stepIndex: null, position: null, stepPending: false });
}

useAppStore.subscribe((state, previous) => {
  if (state.worldRevision !== previous.worldRevision || (state.summary === null && previous.summary !== null)) {
    useSearchStore.setState({ query: "" });
    clearContentResults();
  }
});

/** A new query starts over: no narrowing, nothing stepped to. */
export function setSearchQuery(query: string): void {
  useSearchStore.setState({ query, contentFilter: null, position: null });
  useChestNavigation.setState({ itemFilter: null, selected: null, selectedIndex: null });
}

/** Switching scope keeps the query and drops the other scope's highlights. */
export function setSearchScope(scope: SearchScope): void {
  if (useSearchStore.getState().scope === scope) return;
  useSearchStore.setState({ scope, position: null });
  if (scope === "content") clearChestResults();
  else clearContentResults();
}

/** Esc in the box, or the clear button: no query, no matches, no highlight. */
export function clearSearch(): void {
  useSearchStore.setState({ query: "" });
  clearContentResults();
  clearChestResults();
}

/**
 * Runs a content search for one entry, e.g. from the Content panel: opens the Search section with the entry's name,
 * narrowed to that entry, and goes to its first match once the step index is built.
 */
export function findContentOnMap(name: string, key: string): void {
  useSearchStore.setState({ scope: "content", query: name, contentFilter: key, position: null, stepPending: true });
  clearChestResults();
  openSearch();
}

/** F3 / Shift+F3 / Enter: the next or previous match of the current scope, centred and zoomed in at once. */
export function stepSearch(direction: 1 | -1): void {
  const { scope, stepIndex, position } = useSearchStore.getState();
  if (scope === "items") {
    stepChest(direction);
    return;
  }
  const next = stepIndex?.step(position, direction) ?? null;
  if (next === null) return;
  useSearchStore.setState({ position: next });
  useViewStore.getState().setPinnedTile({ x: next.x, y: next.y });
  getMapController()?.goTo(next.x + 0.5, next.y + 0.5, GO_TO_ZOOM);
}

/** Whether F3 has anything to visit in the current scope. */
export function useCanStep(): boolean {
  const scope = useSearchStore((state) => state.scope);
  const contentTotal = useSearchStore((state) => state.stepIndex?.total ?? 0);
  const chestAreas = useChestNavigation((state) => state.areas.length);
  return scope === "items" ? chestAreas > 0 : contentTotal > 0;
}

/** Find (Ctrl+F): shows the Search section and focuses its box. */
export function openSearch(): void {
  const layout = useLayoutStore.getState();
  layout.setDockHidden(false); layout.setDockTab("world"); layout.setSectionOpen("search", true);
  useSearchStore.setState((state) => ({ requested: state.requested + 1 }));
}
