import { create } from "zustand";
import type { TilePoint } from "../shell/view-store.js";
import { lineFromTiles, lineTiles, measurementDimensions, snapBoundary, snapTile, type Measurement, type MeasurementHit, type MeasurementKind } from "./measurements.js";

interface RulerState {
  readonly items: readonly Measurement[];
  readonly selected: number | null;
  readonly draft: Measurement | null;
  readonly revision: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}
export const useRulerStore = create<RulerState>()(() => ({ items: [], selected: null, draft: null, revision: 0, canUndo: false, canRedo: false }));
interface RulerWorld { readonly key: string; readonly width: number; readonly height: number }
interface RulerStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
let world: RulerWorld | null = null, storage: RulerStorage | null = null;
let nextId = 1;
let past: (readonly Measurement[])[] = [], future: (readonly Measurement[])[] = [];
let gesture: {
  readonly origin: TilePoint;
  /** The block under the press: lines run between blocks, rectangles between boundaries. */
  readonly originTile: TilePoint;
  readonly original: Measurement | null; readonly hit: MeasurementHit | null; readonly mode: MeasurementKind;
  /** The measurement under the press (any, selected or not): a click without a drag selects it. */
  readonly clicked: number | null;
  readonly previous: number | null;
} | null = null;
const storageKey = (): string => `terraria-map-studio.measurements.v1.${world?.key ?? ""}`;
function browserStorage(): RulerStorage | null { try { return window.localStorage; } catch { return null; } }
function publish(items: readonly Measurement[], selected: number | null): void {
  useRulerStore.setState((state) => ({ items, selected, draft: null, revision: state.revision + 1, canUndo: past.length > 0, canRedo: future.length > 0 }));
  try { if (world !== null) storage?.setItem(storageKey(), JSON.stringify(items)); } catch { /* Blocked storage leaves the current measurements usable. */ }
}
function record(items: readonly Measurement[], selected: number | null): void {
  past.push(useRulerStore.getState().items); future = []; publish(items, selected);
}
function isPoint(value: unknown, bounds: RulerWorld): value is TilePoint {
  if (typeof value !== "object" || value === null) return false;
  const { x, y } = value as Record<string, unknown>;
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 0 && x <= bounds.width
    && typeof y === "number" && Number.isSafeInteger(y) && y >= 0 && y <= bounds.height;
}
/** Local annotation sidecar only: never enters world editing or the .wld writer. */
export function setRulerWorld(next: RulerWorld | null, from: RulerStorage | null = browserStorage()): void {
  world = next; storage = from; past = []; future = []; gesture = null; nextId = 1;
  const items: Measurement[] = [];
  try {
    const saved: unknown = next === null ? null : JSON.parse(storage?.getItem(storageKey()) ?? "null");
    if (Array.isArray(saved) && next !== null) {
      const ids = new Set<number>();
      for (const entry of saved as unknown[]) {
        if (typeof entry !== "object" || entry === null) continue;
        const value = entry as Record<string, unknown>;
        const { id, name, kind, start, end, visible } = value;
        if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1 || ids.has(id) || typeof name !== "string"
          || (kind !== "line" && kind !== "rectangle") || !isPoint(start, next) || !isPoint(end, next) || typeof visible !== "boolean") continue;
        const item: Measurement = { id, name: name.slice(0, 80), kind, start, end, visible };
        if (measurementDimensions(item).length === 0) continue;
        items.push(item); ids.add(id); nextId = Math.max(nextId, id + 1);
      }
    }
  } catch { /* Invalid or inaccessible sidecars start with an empty list. */ }
  useRulerStore.setState((state) => ({ items, selected: null, draft: null, revision: state.revision + 1, canUndo: false, canRedo: false }));
}
/**
 * `hit` edits that measurement (a handle or its body); without it a new one starts, even over another measurement, so
 * shapes can be drawn from each other's corners. `clicked` is selected if the press ends without a drag.
 */
export function beginMeasurement(point: TilePoint, mode: MeasurementKind, hit: MeasurementHit | null = null, clicked: number | null = hit?.id ?? null): void {
  if (world === null || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const origin = snapBoundary(point, world);
  const original = hit === null ? null : useRulerStore.getState().items.find((item) => item.id === hit.id) ?? null;
  const draft: Measurement = original ?? { id: nextId, name: `${mode === "line" ? "Line" : "Rectangle"} ${String(nextId)}`, kind: mode, start: origin, end: origin, visible: true };
  gesture = { origin, originTile: snapTile(point, world), original, hit, mode, clicked, previous: useRulerStore.getState().selected };
  useRulerStore.setState((state) => ({ selected: draft.id, draft, revision: state.revision + 1 }));
}
export function moveMeasurement(point: TilePoint, shift: boolean): void {
  const state = useRulerStore.getState();
  if (world === null || gesture === null || state.draft === null || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const to = snapBoundary(point, world), tile = snapTile(point, world), original = gesture.original;
  let start: TilePoint;
  let end = to, kind = state.draft.kind;
  if (original === null) {
    kind = gesture.mode === "rectangle" || shift ? "rectangle" : "line";
    if (kind === "rectangle") start = gesture.origin;
    else ({ start, end } = lineFromTiles(gesture.originTile, tile));
  }
  else if (gesture.hit?.part === "move") {
    const dx = Math.max(-Math.min(original.start.x, original.end.x), Math.min(world.width - Math.max(original.start.x, original.end.x), to.x - gesture.origin.x));
    const dy = Math.max(-Math.min(original.start.y, original.end.y), Math.min(world.height - Math.max(original.start.y, original.end.y), to.y - gesture.origin.y));
    start = { x: original.start.x + dx, y: original.start.y + dy }; end = { x: original.end.x + dx, y: original.end.y + dy };
  } else if (gesture.hit?.part === "start") ({ start, end } = lineFromTiles(tile, lineTiles(original).last));
  else if (gesture.hit?.part === "end") ({ start, end } = lineFromTiles(lineTiles(original).first, tile));
  else {
    const left = Math.min(original.start.x, original.end.x), right = Math.max(original.start.x, original.end.x);
    const top = Math.min(original.start.y, original.end.y), bottom = Math.max(original.start.y, original.end.y);
    const part = gesture.hit?.part;
    start = { x: part === "top-left" || part === "bottom-left" ? right : left, y: part === "top-left" || part === "top-right" ? bottom : top };
  }
  if (start.x === state.draft.start.x && start.y === state.draft.start.y && end.x === state.draft.end.x && end.y === state.draft.end.y && kind === state.draft.kind) return;
  useRulerStore.setState({ draft: { ...state.draft, start, end, kind }, revision: state.revision + 1 });
}
export function finishMeasurement(keep: boolean, cancel = false): void {
  const state = useRulerStore.getState(), active = gesture; gesture = null;
  if (active === null || state.draft === null) return;
  const size = measurementDimensions(state.draft);
  if (cancel || size.length === 0) {
    const selected = cancel ? active.previous : active.original?.id ?? active.clicked;
    useRulerStore.setState({ draft: null, selected, revision: state.revision + 1 }); return;
  }
  const kind = size.width === 0 || size.height === 0 ? "line" : state.draft.kind;
  const draft: Measurement = { ...state.draft, kind,
    name: active.original === null ? `${kind === "line" ? "Line" : "Rectangle"} ${String(state.draft.id)}` : state.draft.name };
  if (active.original !== null) {
    if (draft.start.x === active.original.start.x && draft.start.y === active.original.start.y && draft.end.x === active.original.end.x && draft.end.y === active.original.end.y) {
      useRulerStore.setState({ draft: null, revision: state.revision + 1 }); return;
    }
    record(state.items.map((item) => item.id === draft.id ? draft : item), draft.id);
  } else {
    // Not selected: its corners stay free to start the next measurement from; a click selects it for editing.
    nextId++; record(keep ? [...state.items, draft] : [draft], null);
  }
}
export function selectMeasurement(id: number | null): void { useRulerStore.setState((state) => ({ selected: id, revision: state.revision + 1 })); }
export function changeMeasurement(id: number, change: Partial<Pick<Measurement, "name" | "visible">>): void {
  const state = useRulerStore.getState();
  if (!state.items.some((item) => item.id === id)) return;
  record(state.items.map((item) => item.id === id ? { ...item, ...change, name: (change.name ?? item.name).trim().slice(0, 80) || item.name } : item), state.selected);
}
export function deleteMeasurement(id: number): void {
  const state = useRulerStore.getState();
  if (state.items.some((item) => item.id === id)) record(state.items.filter((item) => item.id !== id), state.selected === id ? null : state.selected);
}
export function clearMeasurements(): void { if (useRulerStore.getState().items.length > 0) record([], null); }
export function undoMeasurement(): void {
  const items = past.pop(); if (items === undefined) return;
  future.push(useRulerStore.getState().items); gesture = null; publish(items, null);
}
export function redoMeasurement(): void {
  const items = future.pop(); if (items === undefined) return;
  past.push(useRulerStore.getState().items); gesture = null; publish(items, null);
}
