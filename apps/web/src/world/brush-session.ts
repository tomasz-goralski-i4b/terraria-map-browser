import { SUPPORTED_VANILLA_FORMATS, type WorldTilesResult } from "@studio/world-codec";
import {
  BRUSH_LAYER, BRUSH_SHAPE, BRUSH_SIZE, createBrushHistory,
  type BrushContentLayer, type BrushHistory, type BrushLayer, type BrushOptions, type BrushShape, type LayerEdit, type TileDiff,
} from "@studio/world-model";
import { create } from "zustand";
import { brushMaterials, findMaterial, isShapeable } from "./brush-materials.js";
import { pushRecentSwatch } from "./brush-palettes.js";
import { canonicalWorldOf } from "./canonical-world.js";
import { useAppStore } from "../store.js";
import { useSaveStore } from "./save-world.js";
import { propertiesAreDirty } from "./world-properties.js";

export function brushDisabledReason(world: WorldTilesResult | null): string | null {
  if (world === null) return "Open a vanilla world first";
  if (!SUPPORTED_VANILLA_FORMATS.includes(world.header.version) || world.palette.some((ref) => ref.kind !== "vanilla")) return "Editing modded or unknown content is disabled";
  if ([world.entities.Chests, world.entities.Signs, world.entities.TileEntities, world.entities.WeightedPressurePlates].some((section) => section.data === null)) return "Editing requires readable entity sections";
  return null;
}

/** Tiles around entity anchors that stay as they are: the anchor's object, its supports and its attachments. */
const ENTITY_HALOS = {
  // A chest or sign body is 2 × 2 from its top-left anchor; one more tile on every side keeps its supports.
  chest: { before: 1, size: 4 },
  sign: { before: 1, size: 4 },
  // Tile-entity anchor orientation is unobserved (docs/file-format/entities.md): four tiles in every direction.
  tileEntity: { before: 4, size: 9 },
  pressurePlate: { before: 1, size: 3 },
} as const;

/**
 * The brush of a loaded world, or null when it cannot be edited safely. Only what the world keeps beside its tiles is
 * protected: the footprints of chests, signs, tile entities and weighted pressure plates (with their supports), whose
 * contents and text would otherwise lose their tiles. Everything else, objects without such records included (plants,
 * torches, furniture), may be painted over or erased, as the game lets a player do.
 */
export function createWorldBrush(world: WorldTilesResult): BrushHistory | null {
  if (brushDisabledReason(world) !== null) return null;
  const { width, height } = world.metadata;
  const protectedIndices = new Set<number>();
  const protect = (left: number, top: number, halo: { readonly before: number; readonly size: number }): void => {
    for (let x = Math.max(0, left - halo.before); x < Math.min(width, left - halo.before + halo.size); x++) {
      for (let y = Math.max(0, top - halo.before); y < Math.min(height, top - halo.before + halo.size); y++) protectedIndices.add(x * height + y);
    }
  };
  for (const chest of world.entities.Chests.data?.entries ?? []) protect(chest.x, chest.y, ENTITY_HALOS.chest);
  for (const sign of world.entities.Signs.data?.entries ?? []) protect(sign.x, sign.y, ENTITY_HALOS.sign);
  for (const entity of world.entities.TileEntities.data?.entries ?? []) protect(entity.x, entity.y, ENTITY_HALOS.tileEntity);
  for (const plate of world.entities.WeightedPressurePlates.data?.entries ?? []) protect(plate.x, plate.y, ENTITY_HALOS.pressurePlate);
  const materials = brushMaterials(world);
  return createBrushHistory(canonicalWorldOf(world), {
    protectedTile: (x, y) => protectedIndices.has(x * height + y),
    placeable: (layer, id) => findMaterial(materials, layer, id) !== undefined,
    paintable: (paint) => materials.paints.some((candidate) => candidate.id === paint),
    shapeable: (id) => isShapeable(materials, id),
  });
}

interface BrushState {
  readonly layer: BrushLayer;
  readonly blockId: number;
  readonly wallId: number;
  /** Paint applied with the block or wall (0: none). */
  readonly blockPaint: number;
  readonly wallPaint: number;
  /** Paint-only mode: the brush changes the paint of what is there and places nothing. */
  readonly paintOnly: boolean;
  /** Smooth edges: strokes hammer the blocks they reach and their neighbours into slopes and half blocks. */
  readonly smooth: boolean;
  readonly size: number;
  readonly shape: BrushShape;
  readonly placementPreview: boolean;
  readonly smoothing: number;
  readonly reason: string | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly active: boolean;
  readonly revision: number;
  /** Bumped whenever the brush gets another world (or none), so views of its materials know to read them again. */
  readonly world: number;
}
export const useBrushStore = create<BrushState>()(() => ({
  layer: BRUSH_LAYER.block, blockId: 1, wallId: 1, blockPaint: 0, wallPaint: 0, paintOnly: false, smooth: false, size: 1,
  reason: "Open a vanilla world first", shape: BRUSH_SHAPE.square, placementPreview: true, smoothing: 0,
  canUndo: false, canRedo: false, active: false, revision: 0, world: 0,
}));

/** The layers a target edits. */
export function brushLayers(layer: BrushLayer): readonly BrushContentLayer[] {
  return layer === BRUSH_LAYER.both ? ["block", "wall"] : [layer];
}

/** The model options of the current settings, for the Brush (or, with `erase`, the Erase) tool. */
export function brushOptions(state: BrushState, erase: boolean): BrushOptions {
  const editOf = (layer: BrushContentLayer): LayerEdit => {
    const paint = layer === "block" ? state.blockPaint : state.wallPaint;
    if (erase) return { kind: "erase" };
    if (state.paintOnly) return { kind: "paint", paint };
    return { kind: "place", id: layer === "block" ? state.blockId : state.wallId, paint };
  };
  const options: { size: number; shape: BrushShape; smooth: boolean; block?: LayerEdit; wall?: LayerEdit } = { size: state.size, shape: state.shape, smooth: state.smooth };
  for (const layer of brushLayers(state.layer)) options[layer] = editOf(layer);
  return options;
}

/**
 * Makes a block or wall (with its paint, when given) the brush material, as clicking a swatch does. A target that
 * does not edit that layer switches to it, so the choice is what the next stroke paints.
 */
export function chooseBrushMaterial(layer: BrushContentLayer, id: number, paint?: number): void {
  const state = useBrushStore.getState();
  const target = state.layer === BRUSH_LAYER.both || state.layer === layer ? state.layer : layer;
  useBrushStore.setState(layer === "block"
    ? { blockId: id, ...(paint === undefined ? {} : { blockPaint: paint }), layer: target, paintOnly: false }
    : { wallId: id, ...(paint === undefined ? {} : { wallPaint: paint }), layer: target, paintOnly: false });
}

/** Sets the paint of every layer the target edits (0: none). */
export function chooseBrushPaint(paint: number, layers: readonly BrushContentLayer[] = brushLayers(useBrushStore.getState().layer)): void {
  useBrushStore.setState({
    ...(layers.includes("block") ? { blockPaint: paint } : {}),
    ...(layers.includes("wall") ? { wallPaint: paint } : {}),
  });
}

/** Sets the brush size, clamped to its range. */
export function setBrushSize(size: number): void {
  if (!Number.isFinite(size)) return;
  useBrushStore.setState({ size: Math.min(BRUSH_SIZE.maximum, Math.max(BRUSH_SIZE.minimum, Math.round(size))) });
}

let loaded: WorldTilesResult | null = null;
let history: BrushHistory | null = null;
let savedPosition: ReturnType<BrushHistory["position"]> = null;
let dirtyBeforeStroke = false;
// Where the last stroke ended, for Shift-click straight lines, and where the one before ended (a cancelled stroke
// gives its line origin back).
let lastPoint: { readonly x: number; readonly y: number } | null = null;
let lastPointBeforeStroke: { readonly x: number; readonly y: number } | null = null;
useAppStore.subscribe((state, previous) => {
  if (!state.unsavedChanges && previous.unsavedChanges) savedPosition = history?.position() ?? null;
});
const editingLocked = (): boolean => useAppStore.getState().phase === "loading" || useSaveStore.getState().open;
type BrushChangeListener = (world: WorldTilesResult, tiles: readonly TileDiff[], direction: "before" | "after") => void;
const listeners = new Set<BrushChangeListener>();
export function subscribeBrushChanges(listener: BrushChangeListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const notify = (tiles: readonly TileDiff[], direction: "before" | "after" = "after"): void => {
  if (loaded !== null && tiles.length !== 0) {
    for (const listener of listeners) listener(loaded, tiles, direction);
    useAppStore.getState().setUnsavedChanges(true);
  }
};
const publish = (): void => {
  useBrushStore.setState((state) => ({ canUndo: history?.canUndo() ?? false, canRedo: history?.canRedo() ?? false, revision: state.revision + 1 }));
};
export function setBrushWorld(world: WorldTilesResult | null): void {
  loaded = world;
  history = null; // lazy: opening a world must not allocate an editor before it is used
  savedPosition = null;
  lastPoint = null;
  const reason = brushDisabledReason(world);
  const materials = world === null || reason !== null ? null : brushMaterials(world);
  // Keep the chosen materials when the new world has them; otherwise fall back to its first one.
  const { blockId, wallId, world: version } = useBrushStore.getState();
  useBrushStore.setState({
    reason, active: false, canUndo: false, canRedo: false, world: version + 1,
    ...(materials === null ? {} : {
      blockId: findMaterial(materials, "block", blockId) === undefined ? materials.blocks[0]?.id ?? blockId : blockId,
      wallId: findMaterial(materials, "wall", wallId) === undefined ? materials.walls[0]?.id ?? wallId : wallId,
    }),
  });
}
/** The materials of the loaded world, or null when it cannot be edited. */
export function loadedBrushMaterials(): ReturnType<typeof brushMaterials> | null {
  return loaded === null || brushDisabledReason(loaded) !== null ? null : brushMaterials(loaded);
}
/** Starts a stroke; with `lineFromLast` it first joins the previous stroke's end, drawing a straight line. */
export function beginBrush(erase: boolean, lineFromLast = false): boolean {
  if (loaded === null || useBrushStore.getState().reason !== null || useBrushStore.getState().active || editingLocked()) return false;
  history ??= createWorldBrush(loaded);
  if (history === null) return false;
  try {
    history.begin(brushOptions(useBrushStore.getState(), erase));
  } catch (error) {
    if (error instanceof RangeError) return false; // a material the world cannot hold: nothing to paint
    throw error;
  }
  dirtyBeforeStroke = useAppStore.getState().unsavedChanges;
  lastPointBeforeStroke = lastPoint;
  const state = useBrushStore.getState();
  if (!erase && !state.paintOnly) {
    for (const layer of brushLayers(state.layer)) {
      pushRecentSwatch(layer === "block" ? { layer, id: state.blockId, paint: state.blockPaint } : { layer, id: state.wallId, paint: state.wallPaint });
    }
  }
  useBrushStore.setState({ active: true, canUndo: false, canRedo: false });
  if (lineFromLast && lastPoint !== null) notify(history.move(lastPoint.x, lastPoint.y));
  return true;
}
/** Whether a stroke can be continued from the previous one (Shift-click). */
export function hasLastBrushPoint(): boolean {
  return lastPoint !== null;
}
export function moveBrush(x: number, y: number): void {
  if (editingLocked()) { finishBrush(true); return; }
  if (!useBrushStore.getState().active) return;
  if (x >= 0 && y >= 0) lastPoint = { x, y };
  notify(history?.move(x, y) ?? []);
}
/** Ends the stroke: committed as one undo entry, or with `cancel` restored. */
export function finishBrush(cancel = false): void {
  if (!useBrushStore.getState().active) return;
  if (cancel) {
    notify(history?.cancel() ?? [], "before");
    lastPoint = lastPointBeforeStroke;
  }
  else history?.commit(); // The planes were already changed and invalidated by move.
  useBrushStore.setState({ active: false });
  useAppStore.getState().setUnsavedChanges(cancel ? dirtyBeforeStroke : propertiesAreDirty() || history?.position() !== savedPosition);
  publish();
}
export function undoBrush(): void {
  if (!editingLocked() && history?.canUndo() === true) {
    notify(history.undo(), "before");
    useAppStore.getState().setUnsavedChanges(propertiesAreDirty() || history.position() !== savedPosition);
    publish();
  }
}
export function redoBrush(): void {
  if (!editingLocked() && history?.canRedo() === true) {
    notify(history.redo());
    useAppStore.getState().setUnsavedChanges(propertiesAreDirty() || history.position() !== savedPosition);
    publish();
  }
}

/**
 * Eyedropper: takes the block, wall and their paints of a tile as the brush materials (each only when the world's
 * materials have it). Returns whether anything was picked.
 */
export function pickBrushMaterial(x: number, y: number): boolean {
  const materials = loadedBrushMaterials();
  if (loaded === null || materials === null || x < 0 || y < 0 || x >= loaded.metadata.width || y >= loaded.metadata.height) return false;
  const tile = canonicalWorldOf(loaded).tileAt(x, y);
  const change: Partial<BrushState> = {};
  const known = (paint: number | undefined): number => (materials.paints.some((candidate) => candidate.id === paint) ? paint ?? 0 : 0);
  if (tile.block?.kind === "vanilla" && findMaterial(materials, "block", tile.block.id) !== undefined) {
    Object.assign(change, { blockId: tile.block.id, blockPaint: known(tile.paint) });
  }
  if (tile.wall?.kind === "vanilla" && findMaterial(materials, "wall", tile.wall.id) !== undefined) {
    Object.assign(change, { wallId: tile.wall.id, wallPaint: known(tile.wallPaint) });
  }
  if (Object.keys(change).length === 0) return false;
  useBrushStore.setState(change);
  return true;
}
