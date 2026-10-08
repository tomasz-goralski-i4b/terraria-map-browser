import { create } from "zustand";
import { WIRE_LAYER, type ChunkLayers, type MapRendererStats } from "@studio/renderer";

/** Tools of the left rail. Only the navigation tools work today; the rest mark where editing will go (docs/ui.md). */
export type ToolId = "pan" | "inspect" | "brush" | "erase" | "fill" | "select" | "picker" | "object";

export interface TilePoint {
  readonly x: number;
  readonly y: number;
}

/** Map layers the user can hide; `wires` is a mask of `WIRE_LAYER` bits (wire colours and actuators). */
export type MapLayers = Required<ChunkLayers>;

export const DEFAULT_MAP_LAYERS: MapLayers = { background: true, walls: true, blocks: true, liquids: true, wires: WIRE_LAYER.all };

/** Transient view state: small values the chrome shows, never world data. Not persisted. */
export interface ViewState {
  readonly hoverTile: TilePoint | null;
  /** The tile the Inspect tool pinned in the Inspector; null shows the hovered tile instead. */
  readonly pinnedTile: TilePoint | null;
  readonly layers: MapLayers;
  /** Backing-store pixels per tile; null before the map has a camera. */
  readonly zoom: number | null;
  readonly tool: ToolId;
  readonly helpOpen: boolean;
  readonly paletteOpen: boolean;
  readonly statsVisible: boolean;
  readonly setHoverTile: (tile: TilePoint | null) => void;
  readonly setPinnedTile: (tile: TilePoint | null) => void;
  readonly setLayers: (layers: Partial<MapLayers>) => void;
  readonly setZoom: (zoom: number | null) => void;
  readonly setTool: (tool: ToolId) => void;
  readonly setHelpOpen: (open: boolean) => void;
  readonly setPaletteOpen: (open: boolean) => void;
  readonly setStatsVisible: (visible: boolean) => void;
}

export const useViewStore = create<ViewState>()((set, get) => ({
  hoverTile: null,
  pinnedTile: null,
  layers: DEFAULT_MAP_LAYERS,
  zoom: null,
  tool: "pan",
  helpOpen: false,
  paletteOpen: false,
  statsVisible: false,
  setHoverTile: (tile) => {
    const previous = get().hoverTile;
    if (previous?.x === tile?.x && previous?.y === tile?.y) return;
    set({ hoverTile: tile });
  },
  setPinnedTile: (tile) => {
    set({ pinnedTile: tile });
  },
  setLayers: (layers) => {
    set({ layers: { ...get().layers, ...layers } });
  },
  setZoom: (zoom) => {
    if (get().zoom !== zoom) set({ zoom });
  },
  setTool: (tool) => {
    set({ tool });
  },
  setHelpOpen: (open) => {
    set({ helpOpen: open });
  },
  setPaletteOpen: (open) => {
    set({ paletteOpen: open });
  },
  setStatsVisible: (visible) => {
    set({ statsVisible: visible });
  },
}));

/** What the chrome may ask of the mounted map; registered by the map canvas while it has a renderer. */
export interface MapController {
  /** Glides the camera so the tile is in the centre of the view. */
  readonly centerOn: (x: number, y: number) => void;
  readonly fitWorld: () => void;
  readonly actualSize: () => void;
  readonly stats: () => MapRendererStats;
}

let mapController: MapController | null = null;

export function registerMapController(controller: MapController | null): void {
  mapController = controller;
}

export function getMapController(): MapController | null {
  return mapController;
}
