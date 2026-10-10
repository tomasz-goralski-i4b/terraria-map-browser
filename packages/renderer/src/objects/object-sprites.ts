// The object pass's sprites (docs/assets.md, "Minecart tracks", "Trees"): sprites that are not one cell drawn into
// their own tile, collected on the CPU per chunk from the world's planes. Each names a rectangle of a sheet and where
// its top-left lands in world sprite pixels (16 per tile); it may reach past its tile into the tiles around it.
import type { ContentRef } from "@studio/world-model";
import { terrariaSpriteObjects } from "./terraria-sprite-objects.generated.js";
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

/**
 * The world header fields tree tops read (docs/assets.md, "Trees"): the three x boundaries of the four forest
 * tree-style zones and the 13 tree top variations (0–3 the forest zones, then the biomes).
 */
export interface TreeSettings {
  readonly treeX: readonly number[];
  readonly treeTopVariations: readonly number[];
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
  /** The world's tree settings; without them every variation is 0. */
  readonly trees?: TreeSettings;
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

/** Tile ids whose trunk cells are 20 × 20 (stride 22), drawn 2 pixels left of their tile: trees with foliage. */
const FOLIAGE_TREES: ReadonlySet<number> = new Set(terrariaSpriteObjects.foliage.map((family) => family.type));
/** The common tree: its trunk sheet holds one 176-pixel block per biome (docs/assets.md, "Trees"). */
const COMMON_TREE = 5;
const PALM_TREE = 323;
const GIANT_MUSHROOM = 72;
/** The tile ids the object pass draws in place of their tile's own cell (SPRITE_STATE.object in the chunk pass). */
export const OBJECT_TILES: ReadonlySet<number> = new Set([...FOLIAGE_TREES, PALM_TREE, GIANT_MUSHROOM]);

const TRUNK_CELL = 20;
/** The trunk cell reaches 2 pixels past each side of its 16-pixel tile. */
const TRUNK_OFFSET = (TRUNK_CELL - SPRITE_PIXELS_PER_TILE) / 2;
/** Width of one block of the common tree's trunk sheet. */
const TRUNK_BLOCK = 176;
/** Leafy tiles store frameY 198, 220 or 242 (variant 0–2); the top in column 22, branches in 44 (left) and 66 (right). */
const LEAFY_FRAME_Y = 198;
const FRAME_STRIDE = 22;
const TOP_FRAME_X = 22;
const LEFT_BRANCH_FRAME_X = 44;
const RIGHT_BRANCH_FRAME_X = 66;
/** Foliage frames lie 2 pixels apart; branches are 40 × 40 (Tree_Branches: left column, then right). */
const FOLIAGE_GAP = 2;
const BRANCH_SIZE = 40;
/** A branch frame lies 12 pixels above its tile (centred on it). */
const BRANCH_RAISE = (BRANCH_SIZE - SPRITE_PIXELS_PER_TILE) / 2;
/** Palm tops: Tree_Tops_15, 80 × 80, one column per top variant (frameX 88, 110, 132), one row per palm row. */
const PALM_TOPS = 15;
const PALM_TOP_FRAME_X = 88;
const PALM_TOP_SIZE = 80;
/** The giant mushroom: 16 × 18 stem cells; its cap (Shroom_Tops, 60 × 42) on the tile with frameX 36. */
const SHROOM_CELL_HEIGHT = 18;
const SHROOM_TOP_FRAME_X = 36;
const SHROOM_TOP_WIDTH = 60;
const SHROOM_TOP_HEIGHT = 42;

const trunkBlocks = new Map(terrariaSpriteObjects.trunkBlocks.map(([ground, block]) => [ground, block]));
const palmRows = new Map(terrariaSpriteObjects.palmRows.map(([ground, row]) => [ground, row]));
const foliageByType = new Map(terrariaSpriteObjects.foliage.map((family) =>
  [family.type, new Map(family.grounds.map((row) => [row[0] ?? -1, row]))]));

/** The block type under the column of `type` tiles through (x, y): the first other tile below; -1 for none. */
function groundUnder(reader: ObjectReader, x: number, y: number, type: number): number {
  let below = y;
  while (reader.id(x, below) === type) below++;
  return reader.id(x, below);
}

/** The forest tree-style zone of column x: 0 left of treeX[0], 1 left of treeX[1], 2 left of treeX[2], else 3. */
function forestZone(x: number, treeX: readonly number[]): number {
  let zone = 0;
  while (zone < 3 && zone < treeX.length && x >= (treeX[zone] ?? Infinity)) zone++;
  return zone;
}

interface Foliage {
  readonly style: number;
  readonly frame: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The foliage of a tree of `type` on `ground` whose trunk stands in column trunkX, for a top or branch tile in column x
 * (the generated foliage table: a pattern by the variation the ground's area reads, its entry by x mod its period).
 */
function foliageOf(type: number, ground: number, trunkX: number, x: number, settings: TreeSettings | undefined): Foliage | undefined {
  const row = foliageByType.get(type)?.get(ground);
  if (row === undefined) return undefined;
  const area = row[1] ?? -1;
  const variations = settings?.treeTopVariations ?? [];
  const value = area === -1 ? 0 : variations[area === -2 ? forestZone(trunkX, settings?.treeX ?? []) : area] ?? 0;
  // A variation the observation did not cover (outside 0–63) takes the variation-0 pattern.
  const pattern = terrariaSpriteObjects.foliagePatterns[row[2 + value] ?? row[2] ?? -1];
  if (pattern === undefined) return undefined;
  const period = pattern[0] ?? 1;
  const at = 1 + 4 * (((x % period) + period) % period);
  const style = pattern[at] ?? -1;
  if (style < 0) return undefined;
  return { style, frame: pattern[at + 1] ?? 0, width: pattern[at + 2] ?? 0, height: pattern[at + 3] ?? 0 };
}

/** The sprites of a tree tile of `type` with foliage (common, gem, vanity and ash trees). */
function treeTile(
  reader: ObjectReader, type: number, x: number, y: number, settings: TreeSettings | undefined, out: Collected,
): void {
  const frameX = reader.frameX(x, y);
  const frameY = reader.frameY(x, y);
  if (frameX < 0 || frameY < 0) return;
  const leafy = frameY >= LEAFY_FRAME_Y;
  const trunkX = leafy && frameX === LEFT_BRANCH_FRAME_X ? x + 1 : leafy && frameX === RIGHT_BRANCH_FRAME_X ? x - 1 : x;
  const ground = groundUnder(reader, trunkX, y, type);
  const block = type === COMMON_TREE ? trunkBlocks.get(ground) ?? 0 : 0;
  out.trunks.push({
    kind: "tile", id: type, sx: frameX + block * TRUNK_BLOCK, sy: frameY, width: TRUNK_CELL, height: TRUNK_CELL,
    dx: x * SPRITE_PIXELS_PER_TILE - TRUNK_OFFSET, dy: y * SPRITE_PIXELS_PER_TILE,
  });
  if (!leafy || (frameX !== TOP_FRAME_X && trunkX === x)) return;
  const foliage = foliageOf(type, ground, trunkX, x, settings);
  if (foliage === undefined) return;
  const frame = Math.floor((frameY - LEAFY_FRAME_Y) / FRAME_STRIDE) + foliage.frame;
  if (frameX === TOP_FRAME_X) {
    out.tops.push({
      kind: "treeTop", id: foliage.style, sx: frame * (foliage.width + FOLIAGE_GAP), sy: 0, width: foliage.width, height: foliage.height,
      dx: x * SPRITE_PIXELS_PER_TILE + SPRITE_PIXELS_PER_TILE / 2 - Math.floor(foliage.width / 2),
      dy: (y + 1) * SPRITE_PIXELS_PER_TILE - foliage.height,
    });
    return;
  }
  const left = trunkX > x;
  out.branches.push({
    kind: "treeBranch", id: foliage.style, sx: left ? 0 : BRANCH_SIZE + FOLIAGE_GAP, sy: frame * (BRANCH_SIZE + FOLIAGE_GAP),
    width: BRANCH_SIZE, height: BRANCH_SIZE,
    dx: left ? (x + 1) * SPRITE_PIXELS_PER_TILE - BRANCH_SIZE : x * SPRITE_PIXELS_PER_TILE, dy: y * SPRITE_PIXELS_PER_TILE - BRANCH_RAISE,
  });
}

/** A palm tile: its cell in the row of the sand under it, shifted by its stored lean (frameY); its top on Tree_Tops_15. */
function palmTile(reader: ObjectReader, x: number, y: number, out: Collected): void {
  const frameX = reader.frameX(x, y);
  const lean = reader.frameY(x, y);
  const row = palmRows.get(groundUnder(reader, x, y, PALM_TREE));
  if (row === undefined || frameX < 0) return;
  const dx = x * SPRITE_PIXELS_PER_TILE + lean;
  out.trunks.push({
    kind: "tile", id: PALM_TREE, sx: frameX, sy: row * FRAME_STRIDE, width: TRUNK_CELL, height: TRUNK_CELL, dx: dx - TRUNK_OFFSET,
    dy: y * SPRITE_PIXELS_PER_TILE,
  });
  if (frameX < PALM_TOP_FRAME_X) return;
  const stride = PALM_TOP_SIZE + FOLIAGE_GAP;
  out.tops.push({
    kind: "treeTop", id: PALM_TOPS, sx: Math.floor((frameX - PALM_TOP_FRAME_X) / FRAME_STRIDE) * stride, sy: row * stride,
    width: PALM_TOP_SIZE, height: PALM_TOP_SIZE, dx: dx + SPRITE_PIXELS_PER_TILE / 2 - PALM_TOP_SIZE / 2,
    dy: (y + 1) * SPRITE_PIXELS_PER_TILE - PALM_TOP_SIZE,
  });
}

/** A giant mushroom tile: its 16 × 18 stem cell; on the top tile its cap. */
function mushroomTile(reader: ObjectReader, x: number, y: number, out: Collected): void {
  const frameX = reader.frameX(x, y);
  const frameY = reader.frameY(x, y);
  if (frameX < 0 || frameY < 0) return;
  out.trunks.push({
    kind: "tile", id: GIANT_MUSHROOM, sx: frameX, sy: frameY, width: SPRITE_PIXELS_PER_TILE, height: SHROOM_CELL_HEIGHT,
    dx: x * SPRITE_PIXELS_PER_TILE, dy: y * SPRITE_PIXELS_PER_TILE,
  });
  if (frameX !== SHROOM_TOP_FRAME_X) return;
  out.tops.push({
    kind: "shroomTop", id: 0, sx: Math.floor(frameY / SHROOM_CELL_HEIGHT) * (SHROOM_TOP_WIDTH + FOLIAGE_GAP), sy: 0,
    width: SHROOM_TOP_WIDTH, height: SHROOM_TOP_HEIGHT,
    dx: x * SPRITE_PIXELS_PER_TILE + SPRITE_PIXELS_PER_TILE / 2 - SHROOM_TOP_WIDTH / 2, dy: (y + 1) * SPRITE_PIXELS_PER_TILE - SHROOM_TOP_HEIGHT,
  });
}

/** Sprites by drawing layer: trunk cells and track extras, then branches, then tops and caps. */
interface Collected {
  readonly trunks: ObjectSprite[];
  readonly branches: ObjectSprite[];
  readonly tops: ObjectSprite[];
}

/**
 * The object sprites of the tiles in `area` (clipped to the world), in drawing order: trunk cells (column by column,
 * each from the top) and track extras, then branches, then tops and caps.
 */
export function objectSprites(world: ObjectWorld, area: TileArea): ObjectSprite[] {
  const reader = new ObjectReader(world);
  const out: Collected = { trunks: [], branches: [], tops: [] };
  const right = Math.min(area.right, world.width);
  const bottom = Math.min(area.bottom, world.height);
  for (let x = Math.max(0, area.left); x < right; x++) {
    for (let y = Math.max(0, area.top); y < bottom; y++) {
      const id = reader.id(x, y);
      if (id === TRACK_TILE) trackExtras(reader, x, y, out.trunks);
      else if (FOLIAGE_TREES.has(id)) treeTile(reader, id, x, y, world.trees, out);
      else if (id === PALM_TREE) palmTile(reader, x, y, out);
      else if (id === GIANT_MUSHROOM) mushroomTile(reader, x, y, out);
    }
  }
  return [...out.trunks, ...out.branches, ...out.tops];
}
