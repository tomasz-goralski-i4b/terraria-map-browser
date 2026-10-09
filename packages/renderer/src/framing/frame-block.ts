import type { CanonicalWorld } from "@studio/world-model";
import type { FramingDatabase } from "./framing-database.js";

/** A cell of a tile sheet: column and row of 18-pixel cells. */
export interface SheetCell {
  readonly column: number;
  readonly row: number;
}

/** One self-framed block and its neighbourhood (docs/assets.md, "Tile framing"). */
export interface BlockFramingInput {
  /** The vanilla tile id of the centre. */
  readonly type: number;
  /** The centre's shape: 0 full, 1 half, 2–5 slopes (the `.wld` / CWM shape code). */
  readonly shape: number;
  /** The tile's world position: it picks the variant and the cell of position-framed types. */
  readonly x: number;
  readonly y: number;
  /** The eight neighbours' tile ids in NEIGHBOUR_ORDER (NW N NE W E SW S SE); −1 where there is no block. */
  readonly neighbours: ArrayLike<number>;
  /** The neighbours' shapes in NEIGHBOUR_ORDER; all full when omitted. */
  readonly neighbourShapes?: ArrayLike<number>;
  /**
   * The edge check: bit 1 N, 2 E, 4 S, 8 W set where that edge neighbour is a relative of the centre and its own cell
   * keeps its rim toward the centre. Ignored for other neighbours; 0 when omitted.
   */
  readonly rimsTowardCentre?: number;
}

/** How a block type treats another self-framed type (docs/assets.md, "Neighbour classes"). */
export type BlockKind = "air" | "self" | "partner" | "relative" | "table";

export interface BlockRegion {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Per tile of a region, column-major like the CWM planes (index (x − left) · height + (y − top)); −1: no cell. */
export interface BlockRegionCells {
  readonly columns: Int16Array;
  readonly rows: Int16Array;
}

export interface BlockFraming {
  /** The sheet cell of a self-framed block; null when its type is not one, or it is a falling block with nothing below. */
  readonly frameBlock: (input: BlockFramingInput) => SheetCell | null;
  /** How `centre` treats `other`; null when either is not a self-framed block type. */
  readonly kind: (centre: number, other: number) => BlockKind | null;
  /** Frames every block of `region` of `world` into `out`, reading the neighbours around it. */
  readonly frameRegion: (world: CanonicalWorld, region: BlockRegion, out: BlockRegionCells) => void;
}

export function createBlockFraming(database: FramingDatabase): BlockFraming {
  if (database.blockTypes.length === 0) throw new Error("not implemented");
  return {
    frameBlock: () => null,
    kind: () => null,
    frameRegion: (_world, _region, out) => {
      out.columns.fill(-1);
      out.rows.fill(-1);
    },
  };
}
