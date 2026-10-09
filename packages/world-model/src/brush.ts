import type { CanonicalWorld, WorldPlanes } from "./index.js";

export const BRUSH_BLOCKS = [0, 1, 30, 38] as const;
export const BRUSH_WALLS = [2, 1, 4, 5] as const;
export interface BrushOptions {
  readonly layer: "block" | "wall";
  readonly id: number | null;
  readonly size: number;
}
export interface TileCoordinate { readonly x: number; readonly y: number }
export interface PlaneChange { readonly plane: keyof WorldPlanes; readonly before: number; readonly after: number }
export interface TileDiff extends TileCoordinate { readonly changes: readonly PlaneChange[] }
export interface BrushHistory {
  readonly begin: (options: BrushOptions) => void;
  readonly move: (x: number, y: number) => readonly TileCoordinate[];
  readonly commit: () => readonly TileDiff[];
  readonly cancel: () => readonly TileCoordinate[];
  readonly undo: () => readonly TileCoordinate[];
  readonly redo: () => readonly TileCoordinate[];
  readonly canUndo: () => boolean;
  readonly canRedo: () => boolean;
}
export function createBrushHistory(
  _world: CanonicalWorld, _protected: (x: number, y: number) => boolean = () => false,
): BrushHistory {
  throw new Error("not implemented");
}
