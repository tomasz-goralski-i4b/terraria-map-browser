import { create } from "zustand";
import type { WorldChest } from "@studio/world-codec";
import type { Tile } from "@studio/world-model";
import { getMapController, useViewStore } from "../shell/view-store.js";
import { useLayoutStore } from "../shell/layout-store.js";
import { useAppStore } from "../store.js";

export interface ChestArea { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export function chestArea(chest: WorldChest, origin: Tile): ChestArea {
  return { x: chest.x, y: chest.y, width: origin.block?.kind === "vanilla" && origin.block.id === 88 ? 3 : 2, height: 2 };
}
export function chestKind(origin: Tile): string {
  const id = origin.block?.kind === "vanilla" ? origin.block.id : null;
  return id === 88 ? "Dresser" : id === 441 || id === 468 ? "Trapped chest" : id === 21 || id === 467 ? "Chest" : "Unknown";
}

export const useChestNavigation = create<{ readonly areas: readonly ChestArea[]; readonly selected: ChestArea | null; readonly searchRequested: number; readonly query: string }>()(() => ({ areas: [], selected: null, searchRequested: 0, query: "" }));

useAppStore.subscribe((state, previous) => {
  if (state.worldRevision !== previous.worldRevision || (state.summary === null && previous.summary !== null)) useChestNavigation.setState({ areas: [], selected: null, query: "" });
});

export function visitChest(chest: WorldChest, origin: Tile, pin: boolean): void {
  const area = chestArea(chest, origin);
  getMapController()?.centerOn(chest.x + area.width / 2, chest.y + area.height / 2);
  useChestNavigation.setState({ selected: area });
  if (pin) {
    useViewStore.getState().setPinnedTile({ x: chest.x, y: chest.y });
    useLayoutStore.getState().setSectionOpen("inspector", true);
  }
}

export function stepChest(direction: 1 | -1): void {
  const { areas, selected } = useChestNavigation.getState();
  if (areas.length === 0) return;
  const current = selected === null ? -1 : areas.findIndex((area) => area.x === selected.x && area.y === selected.y);
  const index = current < 0 ? direction === 1 ? 0 : areas.length - 1 : (current + direction + areas.length) % areas.length;
  const area = areas[index];
  if (area === undefined) return;
  getMapController()?.centerOn(area.x + area.width / 2, area.y + area.height / 2);
  useChestNavigation.setState({ selected: area });
  useViewStore.getState().setPinnedTile({ x: area.x, y: area.y });
  useLayoutStore.getState().setSectionOpen("inspector", true);
}

/** GPU annotation records: four footprint edges and a fixed-pixel point visible at overview zoom. */
export function chestAnnotations(areas: readonly ChestArea[], selected: ChestArea | null): Float32Array {
  const values: number[] = [];
  const all = selected === null ? areas : [...areas.filter((area) => area.x !== selected.x || area.y !== selected.y), selected];
  for (const area of all) {
    const { x, y, width, height } = area;
    const active = selected?.x === x && selected.y === y;
    const line = (ax: number, ay: number, bx: number, by: number, size: number, point: number): void => { values.push(ax, ay, bx, by, 1, active ? 1 : 0.7, active ? 1 : 0.2, size, point); };
    line(x, y, x + width, y, 2, 0); line(x + width, y, x + width, y + height, 2, 0);
    line(x + width, y + height, x, y + height, 2, 0); line(x, y + height, x, y, 2, 0);
    line(x + width / 2, y + height / 2, x + width / 2, y + height / 2, active ? 8 : 6, 1);
  }
  return new Float32Array(values);
}
