import type { CanonicalWorld, WorldPlanes } from "./index.js";

export const BRUSH_BLOCKS = [0, 1, 30, 38] as const;
export const BRUSH_WALLS = [2, 1, 4, 5] as const;
export const BRUSH_LAYER = { block: "block", wall: "wall", both: "both" } as const;
export type BrushLayer = (typeof BRUSH_LAYER)[keyof typeof BRUSH_LAYER];
export const BRUSH_SHAPE = { square: "square", circle: "circle" } as const;
export type BrushShape = (typeof BRUSH_SHAPE)[keyof typeof BRUSH_SHAPE];
/** Tile-centre sampling of an inscribed disk; offsets share the square's even-size alignment. */
export function brushFootprint(size: number, shape: BrushShape = BRUSH_SHAPE.square): readonly TileCoordinate[] {
  const offset = Math.floor(size / 2);
  const center = (size - 1) / 2;
  const cells: TileCoordinate[] = [];
  for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) {
    if (shape === BRUSH_SHAPE.circle && Math.hypot(x - center, y - center) > size / 2) continue;
    cells.push({ x: x - offset, y: y - offset });
  }
  return cells;
}
export type BrushOptions = { readonly shape?: BrushShape } & (
  | { readonly layer: typeof BRUSH_LAYER.block | typeof BRUSH_LAYER.wall; readonly id: number | null; readonly size: number }
  | { readonly layer: typeof BRUSH_LAYER.both; readonly blockId: number | null; readonly wallId: number | null; readonly size: number });
export interface TileCoordinate { readonly x: number; readonly y: number }
export interface PlaneChange { readonly plane: keyof WorldPlanes; readonly before: number; readonly after: number }
export interface TileDiff extends TileCoordinate { readonly changes: readonly PlaneChange[] }
export interface BrushHistory {
  readonly begin: (options: BrushOptions) => void;
  readonly move: (x: number, y: number) => readonly TileDiff[];
  readonly commit: () => readonly TileDiff[];
  readonly cancel: () => readonly TileDiff[];
  readonly undo: () => readonly TileDiff[];
  readonly redo: () => readonly TileDiff[];
  readonly canUndo: () => boolean;
  readonly canRedo: () => boolean;
  /** Stable identity of the current committed history state, for save-point comparisons. */
  readonly position: () => readonly TileDiff[] | null;
}
export function createBrushHistory(
  world: CanonicalWorld, protectedTile: (x: number, y: number) => boolean = () => false,
): BrushHistory {
  let options: BrushOptions | null = null;
  let previous: TileCoordinate | null = null;
  let footprint: readonly TileCoordinate[] = [];
  const stroke = new Map<number, TileDiff>();
  const past: (readonly TileDiff[])[] = [];
  const future: (readonly TileDiff[])[] = [];
  const planeNames = Object.keys(world.planes) as (keyof WorldPlanes)[];
  const apply = (diff: readonly TileDiff[], direction: "before" | "after"): readonly TileDiff[] => {
    for (const tile of diff) for (const change of tile.changes) world.planes[change.plane][tile.x * world.height + tile.y] = change[direction];
    return diff;
  };
  const stamp = (cx: number, cy: number, selected: BrushOptions, changed: TileDiff[]): void => {
    const targets = selected.layer === BRUSH_LAYER.both
      ? [{ layer: BRUSH_LAYER.block, id: selected.blockId }, { layer: BRUSH_LAYER.wall, id: selected.wallId }]
      : [{ layer: selected.layer, id: selected.id }];
    for (const delta of footprint) {
      const x = cx + delta.x;
      const y = cy + delta.y;
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
      const index = x * world.height + y;
      if (stroke.has(index) || protectedTile(x, y)) continue;
      const tile = world.tileAt(x, y);
      // Whole coordinates containing objects or unknown content are protected, even for a wall stroke.
      const block = tile.block;
      if (block !== undefined && (block.kind !== "vanilla" || !BRUSH_BLOCKS.some((id) => id === block.id))) continue;
      if (targets.some(({ layer }) => {
        const content = tile[layer];
        const allowed = layer === BRUSH_LAYER.block ? BRUSH_BLOCKS : BRUSH_WALLS;
        return content !== undefined && (content.kind !== "vanilla" || !allowed.some((id) => id === content.id));
      })) continue;
      if (targets.every(({ layer, id }) => {
        const content = tile[layer];
        return (content?.kind === "vanilla" ? content.id : null) === id;
      })) continue;
      const before = planeNames.map((name) => world.planes[name][index] ?? 0);
      for (const { layer, id } of targets) {
        if (id === null) {
          if (layer === BRUSH_LAYER.block) delete tile.block;
          else delete tile.wall;
        }
        else tile[layer] = { kind: "vanilla", id };
        if (layer === BRUSH_LAYER.block) {
          delete tile.frameX;
          delete tile.frameY;
          if (id === null) {
            delete tile.paint;
            delete tile.shape;
            delete tile.inactive;
            delete tile.invisibleBlock;
            delete tile.fullBrightBlock;
          }
        } else if (id === null) {
          delete tile.wallPaint;
          delete tile.invisibleWall;
          delete tile.fullBrightWall;
        }
      }
      world.setTile(x, y, tile);
      const changes: PlaneChange[] = [];
      planeNames.forEach((plane, i) => {
        const old = before[i] ?? 0;
        const after = world.planes[plane][index] ?? 0;
        if (old !== after) changes.push({ plane, before: old, after });
      });
      if (changes.length !== 0) {
        const diff = { x, y, changes };
        stroke.set(index, diff);
        changed.push(diff);
      }
    }
  };
  const assertIdle = (): void => { if (options !== null) throw new Error("Finish the active brush stroke first"); };
  return {
    begin: (selected) => {
      assertIdle();
      const allowed = selected.layer === BRUSH_LAYER.block ? BRUSH_BLOCKS : BRUSH_WALLS;
      const validContent = selected.layer === BRUSH_LAYER.both
        ? (selected.blockId === null || BRUSH_BLOCKS.some((id) => id === selected.blockId)) &&
          (selected.wallId === null || BRUSH_WALLS.some((id) => id === selected.wallId))
        : selected.id === null || allowed.some((id) => id === selected.id);
      if (!Number.isInteger(selected.size) || selected.size < 1 || selected.size > 9 || !validContent) throw new RangeError("Brush needs size 1–9 and whitelisted vanilla content");
      options = { ...selected };
      footprint = brushFootprint(selected.size, selected.shape);
      previous = null;
      stroke.clear();
    },
    move: (x, y) => {
      if (options === null) return [];
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= world.width || y >= world.height) {
        previous = null;
        return [];
      }
      const changed: TileDiff[] = [];
      const from = previous ?? { x, y };
      const steps = Math.max(Math.abs(x - from.x), Math.abs(y - from.y), 1);
      for (let i = 0; i <= steps; i++) stamp(Math.round(from.x + (x - from.x) * i / steps), Math.round(from.y + (y - from.y) * i / steps), options, changed);
      previous = { x, y };
      return changed;
    },
    commit: () => {
      const diff = [...stroke.values()];
      options = null;
      previous = null;
      stroke.clear();
      if (diff.length !== 0) { past.push(diff); future.length = 0; }
      return diff;
    },
    cancel: () => {
      const changed = apply([...stroke.values()], "before");
      options = null;
      previous = null;
      stroke.clear();
      return changed;
    },
    undo: () => {
      assertIdle();
      const diff = past.pop();
      if (diff === undefined) return [];
      future.push(diff);
      return apply(diff, "before");
    },
    redo: () => {
      assertIdle();
      const diff = future.pop();
      if (diff === undefined) return [];
      past.push(diff);
      return apply(diff, "after");
    },
    canUndo: () => options === null && past.length !== 0,
    canRedo: () => options === null && future.length !== 0,
    position: () => past.at(-1) ?? null,
  };
}
