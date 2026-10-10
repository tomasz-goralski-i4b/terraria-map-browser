// The object pass's sprites (docs/assets.md, "Minecart tracks", "Trees"): sprites that are not one cell drawn into
// their own tile, collected on the CPU per chunk from the world's planes. Each names a rectangle of a sheet and where
// its top-left lands in world sprite pixels (16 per tile); it may reach past its tile into the tiles around it.
import type { ContentRef } from "@studio/world-model";
import { TRACK_CELL_STRIDE, TRACK_EXTRA_OFFSET, TRACK_TILE, trackExtraCell, trackPiece, type TrackExtra } from "./tracks.js";

/** Pixels per tile of the sprites (the game's art is drawn at twice its resolution). */
export const SPRITE_PIXELS_PER_TILE = 16;

/** The sheets object sprites come from, as the atlas names them (`SpriteSheetEntry.kind` and id). */
export type ObjectSheetKind = "tile" | "treeTop" | "treeBranch" | "shroomTop";

export interface ObjectSprite {
  readonly kind: ObjectSheetKind;
  readonly id: number;
  /** The source rectangle on the sheet, in sheet pixels. */
  readonly sx: number;
  readonly sy: number;
  readonly width: number;
  readonly height: number;
  /** Where the rectangle's top-left lands, in world sprite pixels (tile x · 16 + offset). */
  readonly dx: number;
  readonly dy: number;
}

/** The slice of a world the object sprites are read from. Planes are column-major (`x * height + y`). */
export interface ObjectWorld {
  readonly width: number;
  readonly height: number;
  readonly planes: {
    readonly block: Uint16Array;
    readonly frameX?: Int16Array;
    readonly frameY?: Int16Array;
  };
  readonly palette: readonly ContentRef[];
}

/** A rectangle of world tiles; right and bottom exclusive. */
export interface TileArea {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const ABSENT = 0xffff;

/** The vanilla tile id of every palette index, -1 for anything else. */
function vanillaIds(palette: readonly ContentRef[]): Int32Array {
  return Int32Array.from(palette, (ref) => (ref.kind === "vanilla" ? ref.id : -1));
}

/** Reads the tiles of a world by position. */
export class ObjectReader {
  readonly #world: ObjectWorld;
  readonly #ids: Int32Array;

  constructor(world: ObjectWorld) {
    this.#world = world;
    this.#ids = vanillaIds(world.palette);
  }

  get width(): number {
    return this.#world.width;
  }

  get height(): number {
    return this.#world.height;
  }

  /** The vanilla tile id of the block at (x, y); -1 without a block, outside the world or for other content. */
  id(x: number, y: number): number {
    const { width, height, planes } = this.#world;
    if (x < 0 || y < 0 || x >= width || y >= height) return -1;
    const index = planes.block[x * height + y] ?? ABSENT;
    return index === ABSENT ? -1 : this.#ids[index] ?? -1;
  }

  /** Whether (x, y) holds any block (vanilla or not). */
  hasBlock(x: number, y: number): boolean {
    const { width, height, planes } = this.#world;
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    return (planes.block[x * height + y] ?? ABSENT) !== ABSENT;
  }

  frameX(x: number, y: number): number {
    return this.#world.planes.frameX?.[x * this.#world.height + y] ?? -1;
  }

  frameY(x: number, y: number): number {
    return this.#world.planes.frameY?.[x * this.#world.height + y] ?? -1;
  }
}

const EXTRA_ORDER: readonly TrackExtra[] = ["leftDown", "rightDown", "bumper", "bouncyBumper"];

/**
 * The decorations and bumpers of the track at (x, y), on the tiles below and above it; none on a tile that holds a
 * block (it keeps its pixels) or lies outside the world.
 */
function trackExtras(reader: ObjectReader, x: number, y: number, out: ObjectSprite[]): void {
  const extras = new Set<TrackExtra>();
  for (const piece of [reader.frameY(x, y), reader.frameX(x, y)]) for (const extra of trackPiece(piece)?.extras ?? []) extras.add(extra);
  for (const extra of EXTRA_ORDER) {
    if (!extras.has(extra)) continue;
    const ty = y + TRACK_EXTRA_OFFSET[extra];
    if (ty < 0 || ty >= reader.height || reader.hasBlock(x, ty)) continue;
    const cell = trackExtraCell(extra);
    out.push({
      kind: "tile", id: TRACK_TILE, sx: cell.column * TRACK_CELL_STRIDE, sy: cell.row * TRACK_CELL_STRIDE, width: 16, height: 16,
      dx: x * SPRITE_PIXELS_PER_TILE, dy: ty * SPRITE_PIXELS_PER_TILE,
    });
  }
}

/** The object sprites of the tiles in `area` (clipped to the world), in drawing order. */
export function objectSprites(world: ObjectWorld, area: TileArea): ObjectSprite[] {
  const reader = new ObjectReader(world);
  const out: ObjectSprite[] = [];
  const right = Math.min(area.right, world.width);
  const bottom = Math.min(area.bottom, world.height);
  for (let x = Math.max(0, area.left); x < right; x++) {
    for (let y = Math.max(0, area.top); y < bottom; y++) {
      if (reader.id(x, y) === TRACK_TILE) trackExtras(reader, x, y, out);
    }
  }
  return out;
}
