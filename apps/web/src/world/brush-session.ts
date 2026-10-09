import { isFrameImportant, SUPPORTED_VANILLA_FORMATS, type WorldTilesResult } from "@studio/world-codec";
import { BRUSH_BLOCKS, BRUSH_LAYER, createBrushHistory, type BrushLayer, type BrushHistory, type BrushOptions, type TileDiff } from "@studio/world-model";
import { create } from "zustand";
import { canonicalWorldOf } from "./canonical-world.js";
import { useAppStore } from "../store.js";
import { useSaveStore } from "./save-world.js";

export function brushDisabledReason(world: WorldTilesResult | null): string | null {
  if (world === null) return "Open a vanilla world first";
  if (!SUPPORTED_VANILLA_FORMATS.includes(world.header.version) || world.palette.some((ref) => ref.kind !== "vanilla")) return "Editing modded or unknown content is disabled";
  if ([world.entities.Chests, world.entities.Signs, world.entities.TileEntities, world.entities.WeightedPressurePlates].some((section) => section.data === null)) return "Editing requires readable entity sections";
  return null;
}

/** Entity coordinates can name air or malformed object fragments: protect their footprints independently of tiles. */
export function createWorldBrush(world: WorldTilesResult): BrushHistory | null {
  if (brushDisabledReason(world) !== null) return null;
  const protectedIndices = new Set<number>();
  const height = world.metadata.height;
  const protect = (left: number, top: number, width: number, rows: number): void => {
    for (let x = Math.max(0, left); x < Math.min(world.metadata.width, left + width); x++) {
      for (let y = Math.max(0, top); y < Math.min(height, top + rows); y++) protectedIndices.add(x * height + y);
    }
  };
  for (const chest of world.entities.Chests.data?.entries ?? []) protect(chest.x - 1, chest.y - 1, 4, 4);
  for (const sign of world.entities.Signs.data?.entries ?? []) protect(sign.x - 1, sign.y - 1, 4, 4);
  // Anchor orientation is unobserved; conservatively protect every direction, including attachment/support cells.
  for (const entity of world.entities.TileEntities.data?.entries ?? []) protect(entity.x - 4, entity.y - 4, 9, 9);
  for (const plate of world.entities.WeightedPressurePlates.data?.entries ?? []) protect(plate.x - 1, plate.y - 1, 3, 3);
  const view = canonicalWorldOf(world);
  return createBrushHistory(view, (x, y) => {
    if (protectedIndices.has(x * height + y)) return true;
    // Ordinary objects without entity records also depend on the surrounding solid/support tiles and walls.
    for (let nx = Math.max(0, x - 1); nx <= Math.min(view.width - 1, x + 1); nx++) {
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        const block = view.palette[view.planes.block[nx * height + ny] ?? 0xffff];
        if (block !== undefined && (block.kind !== "vanilla" || !BRUSH_BLOCKS.some((id) => id === block.id) || isFrameImportant(world.sections, block.id))) return true;
      }
    }
    return false;
  });
}

interface BrushState {
  readonly layer: BrushLayer;
  readonly blockId: number;
  readonly wallId: number;
  readonly size: number;
  readonly reason: string | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly active: boolean;
  readonly revision: number;
}
export const useBrushStore = create<BrushState>()(() => ({
  layer: BRUSH_LAYER.block, blockId: 1, wallId: 1, size: 1, reason: "Open a vanilla world first",
  canUndo: false, canRedo: false, active: false, revision: 0,
}));
let loaded: WorldTilesResult | null = null;
let history: BrushHistory | null = null;
let savedPosition: ReturnType<BrushHistory["position"]> = null;
let dirtyBeforeStroke = false;
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
  useBrushStore.setState({ reason: brushDisabledReason(world), active: false, canUndo: false, canRedo: false });
}
export function beginBrush(erase: boolean): boolean {
  if (loaded === null || useBrushStore.getState().reason !== null || useBrushStore.getState().active || editingLocked()) return false;
  history ??= createWorldBrush(loaded);
  if (history === null) return false;
  const { layer, blockId, wallId, size } = useBrushStore.getState();
  const options: BrushOptions = layer === BRUSH_LAYER.both
    ? { layer, blockId: erase ? null : blockId, wallId: erase ? null : wallId, size }
    : { layer, id: erase ? null : layer === BRUSH_LAYER.block ? blockId : wallId, size };
  history.begin(options);
  dirtyBeforeStroke = useAppStore.getState().unsavedChanges;
  useBrushStore.setState({ active: true, canUndo: false, canRedo: false });
  return true;
}
export function moveBrush(x: number, y: number): void {
  if (editingLocked()) { finishBrush(true); return; }
  notify(history?.move(x, y) ?? []);
}
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
