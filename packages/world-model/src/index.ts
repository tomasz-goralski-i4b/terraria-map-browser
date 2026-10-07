/** A stable reference to world content — vanilla, mod, or an unknown runtime ID. */
export type ContentRef =
  | { kind: "vanilla"; id: number }
  | {
      kind: "mod";
      mod: string;
      internalName: string;
      runtimeId?: number;
      modVersion?: string;
    }
  | { kind: "unknown"; runtimeId: number };

export function isModContent(ref: ContentRef): ref is Extract<ContentRef, { kind: "mod" }> {
  return ref.kind === "mod";
}

export type BlockShape =
  | "full"
  | "half"
  | "slopeTopRight"
  | "slopeTopLeft"
  | "slopeBottomRight"
  | "slopeBottomLeft";

/** On-demand semantic view of a CWM coordinate; absent parts have no key. */
export interface Tile {
  block?: ContentRef;
  wall?: ContentRef;
  frameX?: number;
  frameY?: number;
  paint?: number;
  wallPaint?: number;
  liquid?: { kind: "water" | "lava" | "honey" | "shimmer"; amount: number };
  shape?: BlockShape;
  wires: number;
  actuator: boolean;
  inactive?: boolean;
  invisibleBlock?: boolean;
  invisibleWall?: boolean;
  fullBrightBlock?: boolean;
  fullBrightWall?: boolean;
}

export interface WorldPlanes {
  block: Uint16Array;
  wall: Uint16Array;
  frameX: Int16Array;
  frameY: Int16Array;
  paint: Uint8Array;
  wallPaint: Uint8Array;
  liquid: Uint8Array;
  liquidAmount: Uint8Array;
  shape: Uint8Array;
  flags: Uint16Array;
}

export interface CanonicalWorld {
  readonly width: number;
  readonly height: number;
  readonly planes: WorldPlanes;
  readonly palette: readonly ContentRef[];
  /** Populate in column-major order, block before wall, to preserve palette order. */
  setTile(x: number, y: number, tile: Tile): void;
  tileAt(x: number, y: number): Tile;
}

export interface WorldAllocationOptions {
  /** Maximum total plane bytes; validate the entire request before allocating. */
  maxBytes?: number;
}

/* eslint-disable @typescript-eslint/no-unused-vars -- RED stub retains the public parameters for GREEN. */
export function createWorld(
  _width: number,
  _height: number,
  _options?: WorldAllocationOptions,
): CanonicalWorld {
  throw new Error("not implemented");
}
/* eslint-enable @typescript-eslint/no-unused-vars */
