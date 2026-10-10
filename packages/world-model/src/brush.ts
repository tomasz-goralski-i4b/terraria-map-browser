import type { CanonicalWorld, Tile, WorldPlanes } from "./index.js";

/** Which layers a brush edits; the session turns it into the `block` and `wall` edits of `BrushOptions`. */
export const BRUSH_LAYER = { block: "block", wall: "wall", both: "both" } as const;
export type BrushLayer = (typeof BRUSH_LAYER)[keyof typeof BRUSH_LAYER];
export type BrushContentLayer = "block" | "wall";
export const BRUSH_SHAPE = { square: "square", circle: "circle" } as const;
export type BrushShape = (typeof BRUSH_SHAPE)[keyof typeof BRUSH_SHAPE];
/** Footprint width in tiles: a square's side or a circle's diameter. */
export const BRUSH_SIZE = { minimum: 1, maximum: 64 } as const;
/** Paint ids fit the paint planes (one byte); 0 is no paint. */
const MAX_PAINT = 0xff;

/** Tile-centre disk with a quarter-tile inset so a diameter of three rasterizes as a plus. */
export function brushFootprint(size: number, shape: BrushShape = BRUSH_SHAPE.square): readonly TileCoordinate[] {
  const offset = Math.floor(size / 2);
  const center = (size - 1) / 2;
  const cells: TileCoordinate[] = [];
  for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) {
    if (shape === BRUSH_SHAPE.circle && Math.hypot(x - center, y - center) > size / 2 - 0.25) continue;
    cells.push({ x: x - offset, y: y - offset });
  }
  return cells;
}

/** What a stroke does to one layer of every tile it reaches. */
export type LayerEdit =
  /**
   * Puts vanilla content in place as the game places it: a full, unframed, active block without coatings, painted
   * with `paint` (0: none); a block also displaces liquid. Over the same content only the paint changes.
   */
  | { readonly kind: "place"; readonly id: number; readonly paint: number }
  /** Removes the content together with its paint, shape and coatings. */
  | { readonly kind: "erase" }
  /** Changes only the paint of content that is there (0 removes it). */
  | { readonly kind: "paint"; readonly paint: number };

export interface BrushOptions {
  readonly size: number;
  readonly shape?: BrushShape;
  readonly block?: LayerEdit;
  readonly wall?: LayerEdit;
}

export interface BrushRules {
  /** Whether a layer of a tile must stay as it is. A stroke editing both layers skips the tile if either is. */
  readonly protectedTile?: (x: number, y: number, layer: BrushContentLayer) => boolean;
  /** Whether vanilla content may be placed; `begin` throws a RangeError otherwise. */
  readonly placeable?: (layer: BrushContentLayer, id: number) => boolean;
}

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

type Targets = readonly (readonly [BrushContentLayer, LayerEdit])[];

const isPaint = (paint: number): boolean => Number.isInteger(paint) && paint >= 0 && paint <= MAX_PAINT;

function setPaint(tile: Tile, layer: BrushContentLayer, paint: number): void {
  const key = layer === "block" ? "paint" : "wallPaint";
  if (paint === 0) delete tile[key];
  else tile[key] = paint;
}

/** Applies one layer edit to the tile view; the caller has checked that the layer may change. */
function edit(tile: Tile, layer: BrushContentLayer, change: LayerEdit): void {
  const content = tile[layer];
  if (change.kind === "paint") {
    if (content !== undefined) setPaint(tile, layer, change.paint);
    return;
  }
  if (change.kind === "place" && content?.kind === "vanilla" && content.id === change.id) {
    setPaint(tile, layer, change.paint);
    return;
  }
  if (layer === "block") {
    for (const key of ["frameX", "frameY", "paint", "shape", "inactive", "invisibleBlock", "fullBrightBlock"] as const) delete tile[key];
    if (change.kind === "place") {
      tile.block = { kind: "vanilla", id: change.id };
      delete tile.liquid;
      setPaint(tile, layer, change.paint);
    } else delete tile.block;
  } else {
    for (const key of ["wallPaint", "invisibleWall", "fullBrightWall"] as const) delete tile[key];
    if (change.kind === "place") {
      tile.wall = { kind: "vanilla", id: change.id };
      setPaint(tile, layer, change.paint);
    } else delete tile.wall;
  }
}

export function createBrushHistory(world: CanonicalWorld, rules: BrushRules = {}): BrushHistory {
  const { protectedTile = () => false, placeable = () => true } = rules;
  let targets: Targets | null = null;
  let previous: TileCoordinate | null = null;
  let footprint: readonly TileCoordinate[] = [];
  // Every coordinate this stroke reached, changed or not: a footprint sweeping over a tile decides it once.
  const visited = new Set<number>();
  const stroke = new Map<number, TileDiff>();
  const past: (readonly TileDiff[])[] = [];
  const future: (readonly TileDiff[])[] = [];
  const planeNames = Object.keys(world.planes) as (keyof WorldPlanes)[];
  const apply = (diff: readonly TileDiff[], direction: "before" | "after"): readonly TileDiff[] => {
    for (const tile of diff) for (const change of tile.changes) world.planes[change.plane][tile.x * world.height + tile.y] = change[direction];
    return diff;
  };
  const stamp = (cx: number, cy: number, selected: Targets, changed: TileDiff[]): void => {
    for (const delta of footprint) {
      const x = cx + delta.x;
      const y = cy + delta.y;
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
      const index = x * world.height + y;
      if (visited.has(index)) continue;
      visited.add(index);
      if (selected.some(([layer]) => protectedTile(x, y, layer))) continue;
      const tile = world.tileAt(x, y);
      // Unknown and mod content stays as it is: the editor knows nothing about its rules.
      if (selected.some(([layer]) => { const content = tile[layer]; return content !== undefined && content.kind !== "vanilla"; })) continue;
      const before = planeNames.map((name) => world.planes[name][index] ?? 0);
      for (const [layer, change] of selected) edit(tile, layer, change);
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
  const validEdit = (layer: BrushContentLayer, change: LayerEdit): boolean => {
    if (change.kind === "erase") return true;
    if (!isPaint(change.paint)) return false;
    return change.kind === "paint" || (Number.isInteger(change.id) && change.id >= (layer === "wall" ? 1 : 0) && placeable(layer, change.id));
  };
  const finish = (): void => {
    targets = null;
    previous = null;
    visited.clear();
    stroke.clear();
  };
  const assertIdle = (): void => { if (targets !== null) throw new Error("Finish the active brush stroke first"); };
  return {
    begin: (options) => {
      assertIdle();
      const selected = (["block", "wall"] as const).flatMap((layer) => {
        const change = options[layer];
        return change === undefined ? [] : [[layer, { ...change }] as const];
      });
      const { size } = options;
      if (!Number.isInteger(size) || size < BRUSH_SIZE.minimum || size > BRUSH_SIZE.maximum) {
        throw new RangeError(`Brush size must be ${String(BRUSH_SIZE.minimum)}–${String(BRUSH_SIZE.maximum)} tiles`);
      }
      if (selected.length === 0 || !selected.every(([layer, change]) => validEdit(layer, change))) {
        throw new RangeError("A brush edits a block or a wall layer with placeable vanilla content and a valid paint");
      }
      targets = selected;
      footprint = brushFootprint(size, options.shape);
      previous = null;
      visited.clear();
      stroke.clear();
    },
    move: (x, y) => {
      if (targets === null) return [];
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= world.width || y >= world.height) {
        previous = null;
        return [];
      }
      const changed: TileDiff[] = [];
      const from = previous ?? { x, y };
      const steps = Math.max(Math.abs(x - from.x), Math.abs(y - from.y), 1);
      for (let i = 0; i <= steps; i++) stamp(Math.round(from.x + (x - from.x) * i / steps), Math.round(from.y + (y - from.y) * i / steps), targets, changed);
      previous = { x, y };
      return changed;
    },
    commit: () => {
      const diff = [...stroke.values()];
      finish();
      if (diff.length !== 0) { past.push(diff); future.length = 0; }
      return diff;
    },
    cancel: () => {
      const changed = apply([...stroke.values()], "before");
      finish();
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
    canUndo: () => targets === null && past.length !== 0,
    canRedo: () => targets === null && future.length !== 0,
    position: () => past.at(-1) ?? null,
  };
}
