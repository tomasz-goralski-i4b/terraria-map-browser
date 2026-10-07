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

const absentContent = 0xffff;
const shapes: readonly BlockShape[] = [
  "full", "half", "slopeTopRight", "slopeTopLeft", "slopeBottomRight", "slopeBottomLeft",
];
const liquidKinds: readonly NonNullable<Tile["liquid"]>["kind"][] = [
  "water", "lava", "honey", "shimmer",
];
const booleanFlags = [
  ["inactive", 5], ["invisibleBlock", 6], ["invisibleWall", 7],
  ["fullBrightBlock", 8], ["fullBrightWall", 9],
] as const;

function contentKey(ref: ContentRef): string {
  switch (ref.kind) {
    case "vanilla": return JSON.stringify([ref.kind, ref.id]);
    case "unknown": return JSON.stringify([ref.kind, ref.runtimeId]);
    case "mod": return JSON.stringify([
      ref.kind, ref.mod, ref.internalName, ref.runtimeId, ref.modVersion,
    ]);
  }
}

export function createWorld(
  width: number,
  height: number,
  options?: WorldAllocationOptions,
): CanonicalWorld {
  const dimensions = `${String(width)} x ${String(height)}`;
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new RangeError(`Invalid world dimensions: ${dimensions}`);
  }
  const cells = width * height;
  // CWM v1: five 16-bit planes and five 8-bit planes, totaling 15 bytes per tile.
  const bytes = cells * 15;
  if (!Number.isSafeInteger(cells) || !Number.isSafeInteger(bytes)) {
    throw new RangeError(`Unsafe plane byte size for ${dimensions}: ${String(bytes)}`);
  }
  if (options?.maxBytes !== undefined) {
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
      throw new RangeError("maxBytes must be a nonnegative safe integer");
    }
    if (bytes > options.maxBytes) {
      throw new RangeError(`World ${dimensions} requests ${String(bytes)} plane bytes, exceeding ${String(options.maxBytes)}`);
    }
  }

  const planes: WorldPlanes = {
    block: new Uint16Array(cells).fill(absentContent),
    wall: new Uint16Array(cells).fill(absentContent),
    frameX: new Int16Array(cells).fill(-1),
    frameY: new Int16Array(cells).fill(-1),
    paint: new Uint8Array(cells),
    wallPaint: new Uint8Array(cells),
    liquid: new Uint8Array(cells),
    liquidAmount: new Uint8Array(cells),
    shape: new Uint8Array(cells),
    flags: new Uint16Array(cells),
  };
  const palette: ContentRef[] = [];
  const paletteIndices = new Map<string, number>();

  function coordinateIndex(x: number, y: number): number {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
      throw new RangeError(`Coordinate ${String(x)},${String(y)} outside world ${dimensions}`);
    }
    return x * height + y;
  }

  function intern(ref: ContentRef | undefined): number {
    if (ref === undefined) return absentContent;
    const key = contentKey(ref);
    const existing = paletteIndices.get(key);
    if (existing !== undefined) return existing;
    if (palette.length >= absentContent) throw new RangeError("CWM palette exceeds 65535 entries");
    const index = palette.length;
    palette.push({ ...ref });
    paletteIndices.set(key, index);
    return index;
  }

  return {
    width, height, planes, palette,
    setTile(x, y, tile) {
      const index = coordinateIndex(x, y);
      planes.block[index] = intern(tile.block);
      planes.wall[index] = intern(tile.wall);
      planes.frameX[index] = tile.frameX ?? -1;
      planes.frameY[index] = tile.frameY ?? -1;
      planes.paint[index] = tile.paint ?? 0;
      planes.wallPaint[index] = tile.wallPaint ?? 0;
      planes.liquid[index] = tile.liquid === undefined ? 0 : liquidKinds.indexOf(tile.liquid.kind) + 1;
      planes.liquidAmount[index] = tile.liquid?.amount ?? 0;
      planes.shape[index] = tile.shape === undefined ? 0 : shapes.indexOf(tile.shape);
      let flags = (tile.wires & 15) | (tile.actuator ? 1 << 4 : 0);
      for (const [field, bit] of booleanFlags) {
        if (tile[field]) flags |= 1 << bit;
      }
      planes.flags[index] = flags;
    },
    tileAt(x, y) {
      const index = coordinateIndex(x, y);
      const flags = planes.flags[index] ?? 0;
      const tile: Tile = { wires: flags & 15, actuator: (flags & (1 << 4)) !== 0 };
      const block = palette[planes.block[index] ?? absentContent];
      const wall = palette[planes.wall[index] ?? absentContent];
      if (block !== undefined) tile.block = block;
      if (wall !== undefined) tile.wall = wall;
      const frameX = planes.frameX[index] ?? -1;
      const frameY = planes.frameY[index] ?? -1;
      if (frameX !== -1) tile.frameX = frameX;
      if (frameY !== -1) tile.frameY = frameY;
      const paint = planes.paint[index] ?? 0;
      const wallPaint = planes.wallPaint[index] ?? 0;
      if (paint !== 0) tile.paint = paint;
      if (wallPaint !== 0) tile.wallPaint = wallPaint;
      const liquidKind = liquidKinds[(planes.liquid[index] ?? 0) - 1];
      if (liquidKind !== undefined) tile.liquid = { kind: liquidKind, amount: planes.liquidAmount[index] ?? 0 };
      const shape = shapes[planes.shape[index] ?? 0];
      if (shape !== undefined && shape !== "full") tile.shape = shape;
      for (const [field, bit] of booleanFlags) {
        if ((flags & (1 << bit)) !== 0) tile[field] = true;
      }
      return tile;
    },
  };
}
