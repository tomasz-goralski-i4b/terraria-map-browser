import type { BlockShape, CanonicalWorld, Tile, WorldPlanes } from "./index.js";

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
  /**
   * Smooth edges (an automatic hammer): a stroke that edits blocks also shapes the blocks it reaches and the ones
   * beside them by their exposed sides (`smoothShape`), as a player would hammer the edge of a hill or a tunnel.
   */
  readonly smooth?: boolean;
}

export interface BrushRules {
  /** Whether a layer of a tile must stay as it is. A stroke editing both layers skips the tile if either is. */
  readonly protectedTile?: (x: number, y: number, layer: BrushContentLayer) => boolean;
  /** Whether vanilla content may be placed; `begin` throws a RangeError otherwise. */
  readonly placeable?: (layer: BrushContentLayer, id: number) => boolean;
  /** Whether a paint id may be applied (0, no paint, always may); `begin` throws a RangeError otherwise. */
  readonly paintable?: (paint: number) => boolean;
  /**
   * Whether a vanilla block can take a slope or half block (and so counts as ground for smoothing). Unknown and mod
   * blocks count as ground but are never shaped. Every vanilla block when absent.
   */
  readonly shapeable?: (id: number) => boolean;
}

/** The sides of a block with no ground beside them. */
export interface ExposedSides { readonly north: boolean; readonly south: boolean; readonly west: boolean; readonly east: boolean }

/**
 * The shape smoothing gives a block from its exposed sides: two exposed sides that meet at a corner cut that corner
 * (a slope), an exposed top and both sides make a bump a half block, anything else stays a full block.
 */
export function smoothShape({ north, south, west, east }: ExposedSides): BlockShape {
  if (north && west && !south && !east) return "slopeTopLeft";
  if (north && east && !south && !west) return "slopeTopRight";
  if (south && west && !north && !east) return "slopeBottomLeft";
  if (south && east && !north && !west) return "slopeBottomRight";
  if (north && west && east && !south) return "half";
  return "full";
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
  if (layer === "block") {
    if (paint === 0) delete tile.paint;
    else tile.paint = paint;
  } else if (paint === 0) delete tile.wallPaint;
  else tile.wallPaint = paint;
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
    delete tile.frameX;
    delete tile.frameY;
    delete tile.paint;
    delete tile.shape;
    delete tile.inactive;
    delete tile.invisibleBlock;
    delete tile.fullBrightBlock;
    if (change.kind === "place") {
      tile.block = { kind: "vanilla", id: change.id };
      delete tile.liquid;
      setPaint(tile, layer, change.paint);
    } else delete tile.block;
  } else {
    delete tile.wallPaint;
    delete tile.invisibleWall;
    delete tile.fullBrightWall;
    if (change.kind === "place") {
      tile.wall = { kind: "vanilla", id: change.id };
      setPaint(tile, layer, change.paint);
    } else delete tile.wall;
  }
}

export function createBrushHistory(world: CanonicalWorld, rules: BrushRules = {}): BrushHistory {
  const { protectedTile = () => false, placeable = () => true, paintable = () => true, shapeable = () => true } = rules;
  let targets: Targets | null = null;
  let smoothing = false;
  let previous: TileCoordinate | null = null;
  let footprint: readonly TileCoordinate[] = [];
  // The cells a footprint gains when its centre moves by one tile, by direction ((dx + 1) * 3 + dy + 1): consecutive
  // stamps of a stroke are at most one tile apart, so after the first stamp only these leading-edge cells are new.
  let leadingEdges: readonly (readonly TileCoordinate[])[] = [];
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
  /** Writes a changed tile view and records it in the stroke against the tile's values before the stroke. */
  const write = (x: number, y: number, tile: Tile, changed: TileDiff[]): void => {
    const index = x * world.height + y;
    const earlier = stroke.get(index);
    const before = planeNames.map((name) => earlier?.changes.find((change) => change.plane === name)?.before ?? world.planes[name][index] ?? 0);
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
    } else if (earlier !== undefined) {
      // Back to how it was before the stroke: no longer part of it, but listeners still learn of the change.
      stroke.delete(index);
      changed.push({ x, y, changes: earlier.changes.map(({ plane, after, before: old }) => ({ plane, before: after, after: old })) });
    }
  };
  const stamp = (cx: number, cy: number, cells: readonly TileCoordinate[], selected: Targets, changed: TileDiff[], reached: number[]): void => {
    for (const delta of cells) {
      const x = cx + delta.x;
      const y = cy + delta.y;
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
      const index = x * world.height + y;
      if (visited.has(index)) continue;
      visited.add(index);
      reached.push(index);
      if (selected.some(([layer]) => protectedTile(x, y, layer))) continue;
      const tile = world.tileAt(x, y);
      // Unknown and mod content stays as it is: the editor knows nothing about its rules.
      if (selected.some(([layer]) => { const content = tile[layer]; return content !== undefined && content.kind !== "vanilla"; })) continue;
      for (const [layer, change] of selected) edit(tile, layer, change);
      write(x, y, tile, changed);
    }
  };
  const isGround = (x: number, y: number): boolean => {
    // Beyond the world's edge is ground: nothing is shaped against the border.
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return true;
    const block = world.palette[world.planes.block[x * world.height + y] ?? 0xffff];
    return block !== undefined && (block.kind !== "vanilla" || shapeable(block.id));
  };
  /** Shapes the blocks at the reached tiles and beside them (their exposure may have changed) by `smoothShape`. */
  const smoothAround = (reached: readonly number[], changed: TileDiff[]): void => {
    const area = new Set<number>();
    for (const index of reached) {
      const x = Math.floor(index / world.height);
      const y = index % world.height;
      area.add(index);
      if (x > 0) area.add(index - world.height);
      if (x < world.width - 1) area.add(index + world.height);
      if (y > 0) area.add(index - 1);
      if (y < world.height - 1) area.add(index + 1);
    }
    for (const index of area) {
      const x = Math.floor(index / world.height);
      const y = index % world.height;
      const block = world.palette[world.planes.block[index] ?? 0xffff];
      if (block?.kind !== "vanilla" || !shapeable(block.id) || protectedTile(x, y, "block")) continue;
      const shape = smoothShape({ north: !isGround(x, y - 1), south: !isGround(x, y + 1), west: !isGround(x - 1, y), east: !isGround(x + 1, y) });
      const tile = world.tileAt(x, y);
      if ((tile.shape ?? "full") === shape) continue;
      if (shape === "full") delete tile.shape;
      else tile.shape = shape;
      write(x, y, tile, changed);
    }
  };
  const validEdit = (layer: BrushContentLayer, change: LayerEdit): boolean => {
    if (change.kind === "erase") return true;
    if (!isPaint(change.paint) || (change.paint !== 0 && !paintable(change.paint))) return false;
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
      smoothing = options.smooth === true && selected.some(([layer, change]) => layer === "block" && change.kind !== "paint");
      footprint = brushFootprint(size, options.shape);
      const inFootprint = new Set(footprint.map(({ x, y }) => `${String(x)},${String(y)}`));
      leadingEdges = Array.from({ length: 9 }, (_, direction) => {
        const dx = Math.floor(direction / 3) - 1;
        const dy = (direction % 3) - 1;
        return footprint.filter(({ x, y }) => !inFootprint.has(`${String(x + dx)},${String(y + dy)}`));
      });
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
      const reached: number[] = [];
      // `previous` was stamped whole by the last move; a stroke's first point (or one after leaving the world) is not.
      let last = previous;
      const from = previous ?? { x, y };
      const steps = Math.max(Math.abs(x - from.x), Math.abs(y - from.y), 1);
      for (let i = 0; i <= steps; i++) {
        const cx = Math.round(from.x + (x - from.x) * i / steps);
        const cy = Math.round(from.y + (y - from.y) * i / steps);
        if (last === null) stamp(cx, cy, footprint, targets, changed, reached);
        else if (cx !== last.x || cy !== last.y) stamp(cx, cy, leadingEdges[(cx - last.x + 1) * 3 + cy - last.y + 1] ?? footprint, targets, changed, reached);
        last = { x: cx, y: cy };
      }
      if (smoothing && reached.length !== 0) smoothAround(reached, changed);
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
