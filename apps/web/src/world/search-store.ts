import { create } from "zustand";
import { useAppStore } from "../store.js";
import { GO_TO_ZOOM, stepChest, useChestNavigation } from "./chest-navigation.js";
import { buildContentStepIndex, sameSelection, type ContentSelection, type ContentStep, type ContentStepIndex } from "./content-search.js";
import type { CountablePlanes } from "./content-counts.js";
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

/** How long the query must rest before the map shows its matches, so typing does not flash the whole map. */
export const HIGHLIGHT_DELAY_MS = 300;

/** The tiles a content highlight is stepped through: the planes and their size, and a version bumped by edits. */
export interface ContentSearchSource {
  readonly planes: CountablePlanes;
  readonly width: number;
  readonly height: number;
  readonly version: number;
}

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
  /** Where `highlight` is stepped through. */
  readonly source: ContentSearchSource | null;
  /** The step index of `highlight`, once built; it lives here, so collapsing the Search section keeps it. */
  readonly stepIndex: ContentStepIndex | null;
  /** The match last stepped to. */
  readonly position: ContentStep | null;
  /** A step asked for before the step index was ready, taken as soon as it is (0 for none). */
  readonly stepPending: 0 | 1 | -1;
}

export const useSearchStore = create<SearchState>()(() => ({
  scope: "content", query: "", requested: 0, dim: true, contentFilter: null,
  highlight: null, source: null, stepIndex: null, position: null, stepPending: 0,
}));

function clearChestResults(): void {
  useChestNavigation.setState({ areas: [], selected: null, selectedIndex: null, itemFilter: null });
}

function clearContentResults(): void {
  useSearchStore.setState({ contentFilter: null, highlight: null, source: null, stepIndex: null, position: null, stepPending: 0 });
}

useAppStore.subscribe((state, previous) => {
  if (state.worldRevision !== previous.worldRevision || (state.summary === null && previous.summary !== null)) {
    useSearchStore.setState({ query: "" });
    clearContentResults();
  }
});

/**
 * Shows content matches on the map and builds their step index in slices. The same selection over the same tiles is
 * a no-op (the Search section mounting again, a re-render); an edit (a new `version`) rebuilds the index and keeps
 * the position, a new selection starts over.
 */
export function showContentMatches(selection: ContentSelection | null, source: ContentSearchSource | null): void {
  const state = useSearchStore.getState();
  const sameTiles = state.source?.planes === source?.planes && state.source?.version === source?.version;
  if (sameSelection(state.highlight, selection) && sameTiles) return;
  const keepPosition = sameSelection(state.highlight, selection);
  useSearchStore.setState({ highlight: selection, source, stepIndex: null, ...(keepPosition ? {} : { position: null }) });
}

let building: AbortController | null = null;
useSearchStore.subscribe((state, previous) => {
  if (state.highlight === previous.highlight && state.source === previous.source) return;
  building?.abort();
  building = null;
  const { highlight, source } = state;
  if (highlight === null || source === null) return;
  const controller = new AbortController();
  building = controller;
  buildContentStepIndex(source.planes, source.width, source.height, highlight, { signal: controller.signal }).then((index) => {
    if (controller.signal.aborted) return;
    building = null;
    useSearchStore.setState({ stepIndex: index });
    const pending = useSearchStore.getState().stepPending;
    if (pending !== 0) {
      useSearchStore.setState({ stepPending: 0 });
      stepSearch(pending);
    }
  }, (error: unknown) => {
    if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
  });
});

/** A new query starts over: no narrowing, nothing stepped to, no step waiting for the old query's index. */
export function setSearchQuery(query: string): void {
  useSearchStore.setState({ query, contentFilter: null, position: null, stepPending: 0 });
  useChestNavigation.setState({ itemFilter: null, selected: null, selectedIndex: null });
}

/** Switching scope keeps the query and drops the other scope's highlights. */
export function setSearchScope(scope: SearchScope): void {
  if (useSearchStore.getState().scope === scope) return;
  useSearchStore.setState({ scope, position: null, stepPending: 0 });
  if (scope === "content") clearChestResults();
  else clearContentResults();
}

/** Esc in the box, or the clear button: no query, no matches, no highlight. */
export function clearSearch(): void {
  useSearchStore.setState({ query: "" });
  clearContentResults();
  clearChestResults();
}

/** Shows the Search section; with `focus`, focuses its box (Find), else focus stays where it is. */
function showSearch(focus: boolean): void {
  const layout = useLayoutStore.getState();
  layout.setDockHidden(false); layout.setDockTab("world"); layout.setSectionOpen("search", true);
  if (focus) useSearchStore.setState((state) => ({ requested: state.requested + 1 }));
}

/** Find (Ctrl+F): shows the Search section and focuses its box. */
export function openSearch(): void {
  showSearch(true);
}

/**
 * Runs a content search for one entry, e.g. from the Content panel: shows the Search section with the entry's name,
 * narrowed to that entry, and goes to its first match (once the step index is built, if it is not yet). Focus stays in
 * the caller, so a list can be walked with Enter.
 */
export function findContentOnMap(name: string, key: string): void {
  const state = useSearchStore.getState();
  const sameEntry = state.scope === "content" && state.query === name && state.contentFilter === key && state.stepIndex !== null;
  useSearchStore.setState({ scope: "content", query: name, contentFilter: key, position: null, stepPending: sameEntry ? 0 : 1 });
  clearChestResults();
  showSearch(false);
  if (sameEntry) stepSearch(1);
}

/** F3 / Shift+F3 / Enter: the next or previous match of the current scope, centred and zoomed in at once. */
export function stepSearch(direction: 1 | -1): void {
  const { scope, stepIndex, position, highlight } = useSearchStore.getState();
  if (scope === "items") {
    if (useChestNavigation.getState().areas.length === 0 && useSearchStore.getState().query.trim() !== "") useSearchStore.setState({ stepPending: direction });
    else stepChest(direction);
    return;
  }
  if (stepIndex === null) {
    // Typed and pressed Enter before the highlight or its index is ready: the step is taken once it is.
    if (highlight !== null || useSearchStore.getState().query.trim() !== "") useSearchStore.setState({ stepPending: direction });
    return;
  }
  const next = stepIndex.step(position, direction);
  if (next === null) return;
  useSearchStore.setState({ position: next });
  useViewStore.getState().setPinnedTile({ x: next.x, y: next.y });
  getMapController()?.goTo(next.x + 0.5, next.y + 0.5, GO_TO_ZOOM);
}

/** Whether F3 has anything to visit in the current scope (or will have, once the index is built). */
export function useCanStep(): boolean {
  const scope = useSearchStore((state) => state.scope);
  const content = useSearchStore((state) => state.highlight !== null && (state.stepIndex === null || state.stepIndex.total > 0));
  const chestAreas = useChestNavigation((state) => state.areas.length);
  return scope === "items" ? chestAreas > 0 : content;
}
