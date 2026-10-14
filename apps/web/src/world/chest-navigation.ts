import { create } from "zustand";
import type { WorldChest } from "@studio/world-codec";
import { getMapController, useViewStore } from "../shell/view-store.js";
import { useLayoutStore } from "../shell/layout-store.js";
import { useAppStore } from "../store.js";
import type { ChestWorld } from "./chests.js";

export interface ChestArea { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly chestIndex?: number }

/** CSS pixels per tile that "Go to" zooms in to at least: a 2 × 2 chest is then a clearly visible 32 px object. */
export const GO_TO_ZOOM = 16;

interface ChestNavigation {
  /** Map targets of the current search results, in result order; F3 steps through them. */
  readonly areas: readonly ChestArea[];
  /** The highlighted footprint; null for a record without a valid one. */
  readonly selected: ChestArea | null;
  /** The selected record (index into the world's chest list), with or without a footprint. */
  readonly selectedIndex: number | null;
  /** Restricts the results to one item ID of the query's matches; null shows every matching item. */
  readonly itemFilter: number | null;
}

export const useChestNavigation = create<ChestNavigation>()(() => ({ areas: [], selected: null, selectedIndex: null, itemFilter: null }));

useAppStore.subscribe((state, previous) => {
  if (state.worldRevision !== previous.worldRevision || (state.summary === null && previous.summary !== null)) {
    useChestNavigation.setState({ areas: [], selected: null, selectedIndex: null, itemFilter: null });
  }
});

function inWorld(chest: WorldChest, world: ChestWorld): boolean {
  return chest.x >= 0 && chest.y >= 0 && chest.x < world.width && chest.y < world.height;
}

function pin(x: number, y: number): void {
  useViewStore.getState().setPinnedTile({ x, y });
  useLayoutStore.getState().setSectionOpen("inspector", true);
}

/**
 * Selects a record without moving the map: highlights its footprint and shows it in the Inspector. Going there is
 * {@link goToChest}'s job. A record without a valid footprint keeps its row selection but gets no highlight or pin.
 */
export function selectChest(chest: WorldChest, chestIndex: number, area: ChestArea | null): void {
  useChestNavigation.setState({ selected: area, selectedIndex: chestIndex });
  if (area === null) useViewStore.getState().setPinnedTile(null);
  else pin(chest.x, chest.y);
}

/** Selects a record and moves to it at once, zoomed in far enough to see the object. */
export function goToChest(chest: WorldChest, world: ChestWorld, chestIndex: number, area: ChestArea | null): void {
  useChestNavigation.setState({ selected: area, selectedIndex: chestIndex });
  if (area === null) {
    useViewStore.getState().setPinnedTile(null);
    if (inWorld(chest, world)) getMapController()?.goTo(chest.x + 0.5, chest.y + 0.5, GO_TO_ZOOM);
    return;
  }
  pin(chest.x, chest.y);
  getMapController()?.goTo(area.x + area.width / 2, area.y + area.height / 2, GO_TO_ZOOM);
}

/** F3 / Shift+F3: goes to the next or previous search result that has a map target, wrapping around. */
export function stepChest(direction: 1 | -1): void {
  const { areas, selectedIndex } = useChestNavigation.getState();
  if (areas.length === 0) return;
  const current = selectedIndex === null ? -1 : areas.findIndex((area) => area.chestIndex === selectedIndex);
  const index = current < 0 ? (direction === 1 ? 0 : areas.length - 1) : (current + direction + areas.length) % areas.length;
  const area = areas[index];
  if (area === undefined) return;
  useChestNavigation.setState({ selected: area, selectedIndex: area.chestIndex ?? index });
  pin(area.x, area.y);
  getMapController()?.goTo(area.x + area.width / 2, area.y + area.height / 2, GO_TO_ZOOM);
}

/** GPU annotation records: four footprint edges and a fixed-pixel point visible at overview zoom. */
export function chestAnnotations(areas: readonly ChestArea[], selected: ChestArea | null): Float32Array {
  const all = selected === null ? areas : [...areas.filter((area) => area.x !== selected.x || area.y !== selected.y), selected];
  const values = new Float32Array(all.length * 5 * 9);
  let offset = 0;
  for (const { x, y, width, height } of all) {
    const active = selected?.x === x && selected.y === y;
    const line = (ax: number, ay: number, bx: number, by: number, size: number, point: number): void => {
      values.set([ax, ay, bx, by, 1, active ? 1 : 0.7, active ? 1 : 0.2, size, point], offset);
      offset += 9;
    };
    line(x, y, x + width, y, 2, 0); line(x + width, y, x + width, y + height, 2, 0);
    line(x + width, y + height, x, y + height, 2, 0); line(x, y + height, x, y, 2, 0);
    line(x + width / 2, y + height / 2, x + width / 2, y + height / 2, active ? 8 : 6, 1);
  }
  return values;
}
