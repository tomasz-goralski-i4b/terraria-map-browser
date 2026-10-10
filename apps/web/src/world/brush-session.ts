import { isFrameImportant, SUPPORTED_VANILLA_FORMATS, type WorldTilesResult } from "@studio/world-codec";
import {
  BRUSH_LAYER, BRUSH_SHAPE, BRUSH_SIZE, createBrushHistory,
  type BrushContentLayer, type BrushHistory, type BrushLayer, type BrushOptions, type BrushShape, type LayerEdit, type TileDiff,
} from "@studio/world-model";
import { create } from "zustand";
import { brushMaterials, findMaterial } from "./brush-materials.js";
import { canonicalWorldOf } from "./canonical-world.js";
import { useAppStore } from "../store.js";
import { useSaveStore } from "./save-world.js";

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
 * The brush of a loaded world, or null when it cannot be edited safely. Objects (frame-important blocks) and the
 * footprints of entities keep both layers; the tiles next to an object also keep their block, which may support it
 * or carry it. Ordinary blocks protect nothing: they frame themselves again from their new neighbours.
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
  const view = canonicalWorldOf(world);
  // Per palette index: 1 an object, 0 not; the palette only grows, so the cache grows with it.
  let objects = new Int8Array(0);
  const isObject = (x: number, y: number): boolean => {
    const index = view.planes.block[x * height + y] ?? 0xffff;
    if (index >= view.palette.length) return false;
    if (index >= objects.length) {
      const grown = new Int8Array(view.palette.length).fill(-1);
      grown.set(objects);
      objects = grown;
    }
    if (objects[index] === -1) {
      const ref = view.palette[index];
      objects[index] = ref?.kind === "vanilla" && isFrameImportant(world.sections, ref.id) ? 1 : 0;
    }
    return objects[index] === 1;
  };
  const materials = brushMaterials(world);
  return createBrushHistory(view, {
    protectedTile: (x, y, layer) => {
      if (protectedIndices.has(x * height + y) || isObject(x, y)) return true;
      if (layer === "wall") return false;
      for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
        for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) if (isObject(nx, ny)) return true;
      }
      return false;
    },
    placeable: (layer, id) => findMaterial(materials, layer, id) !== undefined,
    paintable: (paint) => materials.paints.some((candidate) => candidate.id === paint),
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
  readonly size: number;
  readonly shape: BrushShape;
  readonly placementPreview: boolean;
  readonly smoothing: number;
  readonly reason: string | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly active: boolean;
  readonly revision: number;
}
export const useBrushStore = create<BrushState>()(() => ({
  layer: BRUSH_LAYER.block, blockId: 1, wallId: 1, blockPaint: 0, wallPaint: 0, paintOnly: false, size: 1,
  reason: "Open a vanilla world first", shape: BRUSH_SHAPE.square, placementPreview: true, smoothing: 0,
  canUndo: false, canRedo: false, active: false, revision: 0,
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
  const options: { size: number; shape: BrushShape; block?: LayerEdit; wall?: LayerEdit } = { size: state.size, shape: state.shape };
  for (const layer of brushLayers(state.layer)) options[layer] = editOf(layer);
  return options;
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
// Where the last stroke ended, for Shift-click straight lines.
let lastPoint: { readonly x: number; readonly y: number } | null = null;
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
  const { blockId, wallId } = useBrushStore.getState();
  useBrushStore.setState({
    reason, active: false, canUndo: false, canRedo: false,
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
  if (cancel) notify(history?.cancel() ?? [], "before");
  else history?.commit(); // The planes were already changed and invalidated by move.
  useBrushStore.setState({ active: false });
  useAppStore.getState().setUnsavedChanges(cancel ? dirtyBeforeStroke : history?.position() !== savedPosition);
  publish();
}
export function undoBrush(): void {
  if (!editingLocked() && history?.canUndo() === true) {
    notify(history.undo(), "before");
    useAppStore.getState().setUnsavedChanges(history.position() !== savedPosition);
    publish();
  }
}
export function redoBrush(): void {
  if (!editingLocked() && history?.canRedo() === true) {
    notify(history.redo());
    useAppStore.getState().setUnsavedChanges(history.position() !== savedPosition);
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
  if (tile.block?.kind === "vanilla" && findMaterial(materials, "block", tile.block.id) !== undefined) {
    Object.assign(change, { blockId: tile.block.id, blockPaint: tile.paint ?? 0 });
  }
  if (tile.wall?.kind === "vanilla" && findMaterial(materials, "wall", tile.wall.id) !== undefined) {
    Object.assign(change, { wallId: tile.wall.id, wallPaint: tile.wallPaint ?? 0 });
  }
  if (Object.keys(change).length === 0) return false;
  useBrushStore.setState(change);
  return true;
}
