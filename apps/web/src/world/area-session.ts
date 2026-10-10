import { create } from "zustand";
import { createWorld, viewWorld, type CanonicalWorld } from "@studio/world-model";
import type { WorldTilesResult } from "@studio/world-codec";
import { useAppStore } from "../store.js";
import { useViewStore, type TilePoint } from "../shell/view-store.js";
import { useSaveStore } from "./save-world.js";
import { commitAreaEdit, finishBrush, useBrushStore } from "./brush-session.js";
import { copyArea, areaPasteSteps, DEFAULT_COPY_LAYERS, DEFAULT_PASTE_OPTIONS, type Area, type AreaClipboard, type AreaPaste, type CopyLayers, type PasteOptions } from "./area-clipboard.js";

interface AreaState {
  readonly selection: Area | null;
  readonly layers: CopyLayers;
  readonly options: PasteOptions;
  readonly hasClipboard: boolean;
  readonly pasting: boolean;
  readonly position: TilePoint | null;
  readonly message: string | null;
  readonly canPlace: boolean;
  readonly previewRevision: number;
}
export const useAreaStore = create<AreaState>()(() => ({ selection: null, layers: DEFAULT_COPY_LAYERS, options: DEFAULT_PASTE_OPTIONS, hasClipboard: false, pasting: false, position: null, message: null, canPlace: false, previewRevision: 0 }));
let loaded: WorldTilesResult | null = null;
let clipboard: AreaClipboard | null = null;
let preview: AreaPaste | null = null;
let previewKey = "";
let generation = 0;
let followingHistory = false;
const locked = (): boolean => loaded === null || useBrushStore.getState().reason !== null || useAppStore.getState().phase === "loading" || useSaveStore.getState().open;
export function setAreaWorld(world: WorldTilesResult | null): void {
  if (!followingHistory) {
    followingHistory = true;
    useBrushStore.subscribe((state, previous) => {
      if ((state.revision !== previous.revision || state.reason !== previous.reason) && useAreaStore.getState().pasting) movePaste(useAreaStore.getState().position);
    });
    const refresh = (): void => { if (useAreaStore.getState().pasting) movePaste(useAreaStore.getState().position); };
    useSaveStore.subscribe((state, previous) => { if (state.open !== previous.open) refresh(); });
    useAppStore.subscribe((state, previous) => { if (state.phase !== previous.phase) refresh(); });
  }
  loaded = world; clipboard = null; preview = null; previewKey = "";
  generation++;
  useAreaStore.setState({ selection: null, hasClipboard: false, pasting: false, position: null, message: null, canPlace: false });
}
export function selectArea(from: TilePoint, to: TilePoint): void {
  if (locked() || loaded === null) return;
  if (![from.x, from.y, to.x, to.y].every(Number.isSafeInteger)) return;
  const { width, height } = loaded.metadata;
  const clamp = (point: TilePoint): TilePoint => ({ x: Math.max(0, Math.min(width - 1, point.x)), y: Math.max(0, Math.min(height - 1, point.y)) });
  const a = clamp(from), b = clamp(to);
  useAreaStore.setState({ selection: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 }, message: null });
}
export function copySelection(): void {
  const state = useAreaStore.getState();
  if (locked() || loaded === null || state.selection === null) return;
  finishBrush();
  try {
    clipboard = copyArea(loaded, state.selection, state.layers);
    useAreaStore.setState({ hasClipboard: true, message: `Copied ${String(state.selection.width)} × ${String(state.selection.height)} tiles` });
  } catch (error) { useAreaStore.setState({ message: error instanceof Error ? error.message : String(error) }); }
}
export function startPaste(): void {
  if (locked() || clipboard === null) return;
  finishBrush(); previewKey = ""; useViewStore.getState().setTool("select");
  useAreaStore.setState({ pasting: true, message: "Click or Enter to place · Escape to cancel" });
  movePaste(useViewStore.getState().hoverTile ?? useAreaStore.getState().selection ?? { x: 0, y: 0 });
}
export function movePaste(position: TilePoint | null): void {
  if (!useAreaStore.getState().pasting) return;
  const key = JSON.stringify([position, useAreaStore.getState().options, useBrushStore.getState().revision, locked()]);
  if (key === previewKey) return;
  previewKey = key;
  const request = ++generation;
  preview = null;
  useAreaStore.setState({ position, canPlace: false, message: locked() ? "Editing is unavailable while loading or saving" : "Preparing preview…", previewRevision: useAreaStore.getState().previewRevision + 1 });
  if (!locked() && loaded !== null && clipboard !== null && position !== null) {
    const steps = areaPasteSteps(loaded, clipboard, position.x, position.y, useAreaStore.getState().options);
    const large = clipboard.world.width * clipboard.world.height > 4096;
    const run = (): void => {
      if (request !== generation || locked()) return;
      try {
        const deadline = performance.now() + 8;
        let step = steps.next();
        while (!step.done && (!large || performance.now() < deadline)) step = steps.next();
        if (!step.done) { setTimeout(run, 0); return; }
        preview = step.value;
        const canPlace = preview.tiles.length !== 0;
        useAreaStore.setState({ canPlace, message: canPlace ? "Click or Enter to place · Escape to cancel" : "Paste makes no changes · Escape to cancel", previewRevision: useAreaStore.getState().previewRevision + 1 });
      } catch (error) { useAreaStore.setState({ message: error instanceof Error ? error.message : String(error) }); }
    };
    if (large) setTimeout(run, 0); else run();
  }
}
export function pasteBounds(): Area | null {
  const state = useAreaStore.getState();
  return !state.pasting || state.position === null || clipboard === null ? null : { ...state.position, width: clipboard.world.width, height: clipboard.world.height };
}
export function pastePreview(): readonly import("@studio/world-model").TileDiff[] { return preview?.tiles ?? []; }
export function pastePreviewWorld(): CanonicalWorld | null {
  const bounds = pasteBounds();
  if (loaded === null || preview === null || bounds === null) return null;
  const width = Math.min(bounds.width, loaded.metadata.width - bounds.x), height = Math.min(bounds.height, loaded.metadata.height - bounds.y);
  if (width <= 0 || height <= 0) return null;
  const planes = createWorld(width, height).planes;
  for (const name of Object.keys(planes) as (keyof typeof planes)[]) for (let x = 0; x < width; x++) planes[name].set(loaded.planes[name].subarray((bounds.x + x) * loaded.metadata.height + bounds.y, (bounds.x + x) * loaded.metadata.height + bounds.y + height), x * height);
  for (const tile of preview.tiles) for (const change of tile.changes) planes[change.plane][(tile.x - bounds.x) * height + tile.y - bounds.y] = change.after;
  return viewWorld(width, height, planes, preview.palette, { indicesChecked: true });
}
export function placePaste(): void {
  if (locked() || loaded === null || clipboard === null || !useAreaStore.getState().pasting) return;
  movePaste(useAreaStore.getState().position);
  if (preview === null || !useAreaStore.getState().canPlace) return;
  if (commitAreaEdit(loaded, preview.tiles, preview.apply)) cancelArea();
}
export function cancelArea(): void {
  generation++; preview = null; previewKey = ""; useAreaStore.setState({ pasting: false, position: null, selection: null, message: null, canPlace: false });
}
useAreaStore.subscribe((state, previous) => {
  if (state.options !== previous.options && state.pasting) movePaste(state.position);
});
useViewStore.subscribe((state, previous) => {
  if (state.tool !== previous.tool && state.tool !== "select" && useAreaStore.getState().pasting) cancelArea();
});
