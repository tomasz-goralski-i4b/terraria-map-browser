// Waterfalls (docs/assets.md, "Waterfalls"): where the game starts one, the path its stream takes tile by tile and the
// pieces of the `Waterfall_<n>` sheets it draws on the way, as sprites for the object pass.
import type { ContentRef } from "@studio/world-model";
import { terrariaSpriteObjects } from "./terraria-sprite-objects.generated.js";
import type { ObjectSprite, TileArea } from "./object-sprites.js";

/** Steps a waterfall takes at most (the stream's reach at full quality). */
export const WATERFALL_MAX_LENGTH = 100;
/** The liquid beside a source must hold more than this. */
export const WATERFALL_MIN_WET = 160;
/** The last steps over which a waterfall fades out. */
const FADE_STEPS = 10;
/** Near a cloud block a stream reaches this far per 4200 tiles of world width. */
const CLOUD_REACH = 40;

/** CWM block shapes: a half block; 2–5 are the slopes (the game's slope 1–4 is shape − 1). */
const HALF = 1;
const ABSENT = 0xffff;
/** The CWM `flags` bit of an inactive (actuated) tile. */
const INACTIVE = 32;
/** CWM liquid kinds. */
const LAVA = 2;
const HONEY = 3;
const SHIMMER = 4;

/** Tile ids the streams read. */
const PLATFORM = 19;
const RAINBOW_BRICK = 160;
const GEMSPARK_FIRST = 262;
const GEMSPARK_LAST = 268;
const CLOUDS = [189, 196];
/** Cloud blocks that rain (the tile below them is the rain's source), with their rain's sheets: foreground, background. */
const RAIN_CLOUDS: ReadonlyMap<number, { readonly type: number; readonly back: number | null; readonly reach: number }> = new Map([
  [196, { type: 11, back: 12, reach: WATERFALL_MAX_LENGTH / 4 }],
  [460, { type: 22, back: null, reach: WATERFALL_MAX_LENGTH / 2 }],
  [717, { type: 26, back: 27, reach: WATERFALL_MAX_LENGTH / 4 }],
]);
/** A wall behind which water still falls at full opacity. */
const ECHO_WALL = 318;

/** The `Waterfall_<n>` sheet of CWM liquid kinds 1–4: forest water, lava, honey, shimmer. */
export const WATERFALL_SHEETS: readonly number[] = [0, 1, 14, 25];

/** Shimmer's waterfall: its core and its light edge (G: measured in an in-game screenshot of a shimmer waterfall). */
export const SHIMMER_WATERFALL: readonly [readonly [number, number, number], readonly [number, number, number]] = [[164, 161, 245], [164, 203, 255]];
/** The first row of shimmer's edge band in Waterfall_25 (measured, S). */
const SHIMMER_EDGE_BAND = 42;

const solidBlocks = new Set(terrariaSpriteObjects.solidBlocks);
const hidesLiquid = new Set(terrariaSpriteObjects.hidesLiquidBehind);

/** The slice of a world waterfalls are read from. Planes are column-major (`x * height + y`). */
export interface WaterfallWorld {
  readonly width: number;
  readonly height: number;
  /** The world's surface level: water falls fainter below it. Absent: everywhere above it. */
  readonly surfaceY?: number;
  readonly planes: {
    readonly block: Uint16Array;
    readonly wall?: Uint16Array;
    readonly shape?: Uint8Array;
    readonly flags?: Uint16Array;
    readonly liquid: Uint8Array;
    readonly liquidAmount: Uint8Array;
  };
  readonly palette: readonly ContentRef[];
}

/** A waterfall's start and the way it first flows (1 right, -1 left), and the CWM liquid kind (1–4) it pours. */
export interface WaterfallSource {
  readonly x: number;
  readonly y: number;
  readonly direction: 1 | -1;
  readonly kind: number;
}

/** Reads a world's tiles as the streams see them. */
class Reader {
  readonly #world: WaterfallWorld;
  readonly #ids: Int32Array;

  constructor(world: WaterfallWorld) {
    this.#world = world;
    this.#ids = Int32Array.from(world.palette, (ref) => (ref.kind === "vanilla" ? ref.id : -1));
  }

  get height(): number {
    return this.#world.height;
  }

  inWorld(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.#world.width && y < this.#world.height;
  }

  #index(x: number, y: number): number {
    return x * this.#world.height + y;
  }

  /** The tile id at (x, y): -1 for none, outside the world or content that is not vanilla. */
  type(x: number, y: number): number {
    if (!this.inWorld(x, y)) return -1;
    const block = this.#world.planes.block[this.#index(x, y)] ?? ABSENT;
    return block === ABSENT ? -1 : this.#ids[block] ?? -1;
  }

  active(x: number, y: number): boolean {
    return this.inWorld(x, y) && (this.#world.planes.block[this.#index(x, y)] ?? ABSENT) !== ABSENT;
  }

  /** Active and not actuated. */
  nactive(x: number, y: number): boolean {
    return this.active(x, y) && ((this.#world.planes.flags?.[this.#index(x, y)] ?? 0) & INACTIVE) === 0;
  }

  shape(x: number, y: number): number {
    return this.active(x, y) ? this.#world.planes.shape?.[this.#index(x, y)] ?? 0 : 0;
  }

  half(x: number, y: number): boolean {
    return this.shape(x, y) === HALF;
  }

  /** The game's slope 1–4 (0 none): 1 and 2 have their surface on top, going down to the right and to the left. */
  slope(x: number, y: number): number {
    const shape = this.shape(x, y);
    return shape >= 2 && shape <= 5 ? shape - 1 : 0;
  }

  topSlope(x: number, y: number): boolean {
    const slope = this.slope(x, y);
    return slope === 1 || slope === 2;
  }

  bottomSlope(x: number, y: number): boolean {
    const slope = this.slope(x, y);
    return slope === 3 || slope === 4;
  }

  /** A full, active solid block (not one solid on top only, nor shaped); outside the world counts as one. */
  solid(x: number, y: number): boolean {
    if (!this.inWorld(x, y)) return true;
    return this.nactive(x, y) && solidBlocks.has(this.type(x, y)) && this.shape(x, y) === 0;
  }

  /** The liquid amount at (x, y), any kind; none outside the world. */
  liquid(x: number, y: number): number {
    if (!this.inWorld(x, y)) return 0;
    const i = this.#index(x, y);
    const kind = this.#world.planes.liquid[i] ?? 0;
    return kind >= 1 && kind <= 4 ? this.#world.planes.liquidAmount[i] ?? 0 : 0;
  }

  kind(x: number, y: number): number {
    return this.liquid(x, y) === 0 ? 0 : this.#world.planes.liquid[this.#index(x, y)] ?? 0;
  }

  /** Whether a wall the water falls fainter over lies at (x, y). */
  wall(x: number, y: number): boolean {
    const wall = this.inWorld(x, y) ? this.#world.planes.wall?.[this.#index(x, y)] ?? ABSENT : ABSENT;
    return wall !== ABSENT && this.#ids[wall] !== ECHO_WALL;
  }
}

/**
 * The waterfall sources inside `area`: a half block with no more than a film of liquid above it (or a solid block
 * there), liquid of more than WATERFALL_MIN_WET on one side and on either side a dry tile that is neither a solid
 * block nor sloped. It pours lava if any of those three tiles holds lava, else honey, else shimmer, else water, and
 * flows away from the wet side.
 */
export function waterfallSources(world: WaterfallWorld, area: TileArea): WaterfallSource[] {
  const reader = new Reader(world);
  const out: WaterfallSource[] = [];
  for (let x = Math.max(1, area.left); x < Math.min(world.width - 1, area.right); x++) {
    for (let y = Math.max(1, area.top); y < Math.min(world.height, area.bottom); y++) {
      if (!reader.active(x, y) || !reader.half(x, y)) continue;
      if (reader.liquid(x, y - 1) >= 16 && !reader.solid(x, y - 1)) continue;
      const open = (side: number): boolean => reader.liquid(side, y) === 0 && !reader.solid(side, y) && reader.slope(side, y) === 0;
      const left = reader.liquid(x - 1, y), right = reader.liquid(x + 1, y);
      if (!(left > WATERFALL_MIN_WET || right > WATERFALL_MIN_WET) || !(open(x - 1) || open(x + 1))) continue;
      const kinds = [reader.kind(x, y - 1), reader.kind(x + 1, y), reader.kind(x - 1, y)];
      const kind = kinds.includes(LAVA) ? LAVA : kinds.includes(HONEY) ? HONEY : kinds.includes(SHIMMER) ? SHIMMER : 1;
      out.push({ x, y, direction: left > WATERFALL_MIN_WET ? 1 : -1, kind });
    }
  }
  return out;
}

/** One piece a stream draws: a rectangle of its frame-0 sheet, its top-left in world sprite pixels, mirrored or not. */
interface Piece {
  readonly type: number;
  readonly sx: number;
  readonly sy: number;
  readonly width: number;
  readonly height: number;
  readonly dx: number;
  readonly dy: number;
  readonly flip: boolean;
  /** Opacity 0–1. */
  readonly alpha: number;
}

/** The sheet of each CWM liquid kind's stream (WATERFALL_SHEETS) by the game's liquid type. */
function sheetOf(kind: number): number {
  return WATERFALL_SHEETS[kind - 1] ?? 0;
}

/**
 * The opacity of a stream of sheet `type` at step `step` of `steps` over the tile at (x, y): lava fully, honey 0.8,
 * shimmer 0.75, water fully under the sky and 0.6 over a wall or below the surface; the last FADE_STEPS steps fade out.
 */
function opacityOf(reader: Reader, world: WaterfallWorld, type: number, x: number, y: number, step: number, steps: number): number {
  let alpha = type === 1 ? 1 : type === 14 ? 0.8 : type === 25 ? 0.75
    : reader.wall(x, y) || y >= (world.surfaceY ?? Infinity) ? 0.6 : 1;
  if (step > steps - FADE_STEPS) alpha *= (steps - step) / FADE_STEPS;
  return alpha;
}

/**
 * The pieces of the stream from `source` of sheet `type`: tile by tile it falls while the tile below is open, slides
 * along a slope below it in the slope's direction, runs along flat ground away from the liquid or the wall behind it,
 * turning back at most once, and ends in liquid, against a full solid block, at the world's edge or after its reach.
 */
function streamPieces(reader: Reader, world: WaterfallWorld, source: { readonly x: number; readonly y: number }, type: number): Piece[] {
  const out: Piece[] = [];
  const draw = (pieceType: number, sx: number, sy: number, width: number, height: number, dx: number, dy: number, flip: boolean, alpha: number): void => {
    if (width > 0 && height > 0) out.push({ type: pieceType, sx, sy, width, height, dx, dy, flip, alpha });
  };
  const fixedType = type === 1 || type === 14 || type === 25;
  let x = source.x, y = source.y;
  let steps = WATERFALL_MAX_LENGTH;
  // The stream's state: the last step's move (dx, dy), its direction and the last direction, whether it slid down a
  // slope, the drawing offset of a stream on the ground (8 pixels down) and the turns it took.
  let lastDx = 0, lastDy = 0, direction = 0, lastDirection = 0, lastSlide = 0, ground = 0, turns = 0;
  let lastType = type, lastAlpha = 1;
  for (let step = 0; step < steps && turns < 2; step++) {
    if (reader.nactive(x, y) && solidBlocks.has(reader.type(x, y)) && reader.type(x, y) !== PLATFORM && reader.shape(x, y) === 0) break;
    const half = reader.half(x, y);
    if (reader.solid(x, y + 1) && !half) ground = 8;
    else if (lastDy !== 0) ground = 0;
    let slide = 0, dx = 0, dy = 0, onSlope = false;
    const previousDirection = lastDirection;
    if (reader.topSlope(x, y + 1) && !half && reader.type(x, y + 1) !== PLATFORM) {
      onSlope = true;
      direction = reader.slope(x, y + 1) === 1 ? 1 : -1;
      slide = dx = lastDirection = direction;
      dy = 1;
    } else if ((!reader.solid(x, y + 1) && !reader.bottomSlope(x, y + 1) && !half) || (!reader.active(x, y + 1) && !half)) {
      turns = 0;
      dy = 1;
    } else if ((reader.solid(x - 1, y) || reader.topSlope(x - 1, y) || reader.liquid(x - 1, y) > 0) && !reader.solid(x + 1, y) && reader.liquid(x + 1, y) === 0) {
      if (direction === -1) turns++;
      dx = 1;
      direction = 1;
    } else if ((reader.solid(x + 1, y) || reader.topSlope(x + 1, y) || reader.liquid(x + 1, y) > 0) && !reader.solid(x - 1, y) && reader.liquid(x - 1, y) === 0) {
      if (direction === 1) turns++;
      dx = -1;
      direction = -1;
    } else if (((!reader.solid(x + 1, y) && !reader.topSlope(x, y)) || reader.liquid(x + 1, y) === 0) && !reader.solid(x - 1, y) && !reader.topSlope(x, y) && reader.liquid(x - 1, y) === 0) {
      dx = direction;
    } else {
      turns++;
    }
    if (turns >= 2) {
      direction *= -1;
      dx *= -1;
    }
    // Content under or in the tile restyles a water stream: rainbow bricks, gemspark blocks.
    let pieceType = type;
    if (!fixedType) {
      const under = reader.type(x, y) !== -1 ? reader.type(x, y) : reader.type(x, y + 1);
      if (under === RAINBOW_BRICK) pieceType = 2;
      else if (under >= GEMSPARK_FIRST && under <= GEMSPARK_LAST) pieceType = 15 + under - GEMSPARK_FIRST;
    }
    const alpha = opacityOf(reader, world, pieceType, x, y, step, steps);
    // The previous step's opacity where the stream changed its look this step.
    const carried = lastType !== pieceType ? lastAlpha : alpha;
    const carriedType = lastType !== pieceType ? lastType : pieceType;
    const fill = Math.trunc(reader.liquid(x, y) / 16);
    const px = x * 16, py = y * 16;
    // Onto a slope going the other way: the corner turning onto it.
    if (onSlope && direction !== previousDirection) {
      draw(pieceType, 0, 24, 32, 16 - fill - 2, previousDirection === 1 ? px - 16 : px, py + 14, previousDirection === 1, alpha);
    }
    // Off a slope it slid down onto a fall: the corner turning down, unfaded.
    if (lastDx === 0 && slide !== 0 && lastDy === 1 && direction !== lastDirection) {
      slide = 0;
      direction = lastDirection;
      draw(pieceType, 0, 24, 32, 16 - fill, px - 16, py + 16, true, 1);
    }
    if (lastSlide !== 0 && dx === 0 && dy === 1) {
      draw(pieceType, 0, 0, 16, 16 - fill - 8, px, py + ground + 8, direction === 1, direction === 1 ? carried : alpha);
    }
    // Landing on flat ground: the column's foot.
    if (ground === 8 && lastDy === 1 && lastSlide === 0) {
      draw(carriedType, 0, 24, 32, 8, lastDirection === -1 ? px : px - 16, py, lastDirection !== -1, carried);
    }
    if (slide !== 0 && lastDx === 0) {
      draw(carriedType, 0, 24, 32, 16 - fill, previousDirection === 1 ? px - 16 : px, py, previousDirection === 1, carried);
    }
    if (dy === 1 && slide === 0 && lastSlide === 0) {
      // Falling: the lip where it starts falling, else the column.
      if (lastDy === 0) draw(pieceType, 0, 0, 16, 16 - fill, px, py + ground, direction !== -1, alpha);
      else draw(carriedType, 0, 24, 32, 16 - fill, direction === -1 ? px : px - 16, py, direction !== -1, carried);
    } else if (dx !== 0 && !(reader.liquid(x, y) > 0 && !half)) {
      if (slide === dx) {
        // Along a slope's surface: eight 2-pixel strips, one step lower each.
        ground = 8;
        for (let column = 0; column < 8; column++) {
          const lower = dx === 1 ? 2 * column : 14 - 2 * column;
          const top = lastDx === 0 && (dx === 1 ? column < 2 : column > 5) ? 4 : lower;
          draw(pieceType, 16 + (dx === 1 ? 14 - 2 * column : 2 * column), 0, 2, 8, px + 2 * column, py + ground + top, true, alpha);
        }
      } else {
        const height = hidesLiquid.has(reader.type(x, y)) || hidesLiquid.has(reader.type(x, y + 1)) ? 8 : 16;
        draw(pieceType, 16, 0, 16, height, px, py + ground, dx === 1, alpha);
      }
    } else if (dx === 0 && dy === 0) {
      // Stopped on the ground: the film it ends in.
      if (reader.liquid(x, y) <= 0 || half) draw(pieceType, 16, 0, 16, 16, px, py + ground, false, alpha);
      break;
    }
    if (reader.liquid(x, y) > 0 && !half) break;
    lastDy = dy;
    lastDirection = direction;
    lastDx = dx;
    x += dx;
    y += dy;
    lastSlide = slide;
    lastType = pieceType;
    lastAlpha = alpha;
    const nearCloud = [[x - dx - 1, y - dy], [x - dx + 1, y - dy], [x - dx, y - dy + 1]]
      .some(([cx = 0, cy = 0]) => reader.active(cx, cy) && CLOUDS.includes(reader.type(cx, cy)));
    if (nearCloud) steps = Math.trunc(CLOUD_REACH * (world.width / 4200));
    if (!reader.inWorld(x, y)) break;
  }
  return out;
}

/**
 * The rain under a cloud block at (x, y) (its tile below is the source): a column of 16-pixel drops, shifted a pixel
 * left and right by row, down to a solid block (included) or deep liquid, with its last 8 drops fading out.
 */
function rainPieces(reader: Reader, x: number, y: number, rain: { readonly type: number; readonly back: number | null; readonly reach: number }): Piece[] {
  const out: Piece[] = [];
  if (reader.solid(x, y + 1) || reader.liquid(x, y + 1) !== 0 || reader.slope(x, y + 1) !== 0) return out;
  // Frame 0 of the drops; the background drops two frames on, the foreground three, at even columns.
  const front = x % 2 === 0 ? 3 : 0, back = x % 2 === 0 ? 2 : 0;
  let row = y + 1;
  let dx = x * 16 + (row % 2 !== 0 ? 0 : 1), dy = row * 16;
  if (reader.active(x, row - 1) && reader.bottomSlope(x, row - 1)) dy -= 16;
  let height = 16;
  const [frontAlpha, backAlpha] = rain.type === 26 ? [0.9, 0.4] : [0.6, 0.3];
  let stop = false;
  for (let drop = 0; drop < rain.reach; drop++) {
    const fade = drop > rain.reach - 8 ? (rain.reach - drop) / 8 : 1;
    if (rain.back !== null) out.push({ type: rain.back, sx: back * 18, sy: 0, width: 16, height, dx, dy, flip: false, alpha: backAlpha * fade });
    out.push({ type: rain.type, sx: front * 18, sy: 0, width: 16, height, dx, dy, flip: false, alpha: frontAlpha * fade });
    if (stop) break;
    row++;
    if (row >= reader.height) break;
    if (reader.solid(x, row)) stop = true;
    const liquid = reader.liquid(x, row);
    if (liquid > 0) {
      const sunk = Math.trunc(16 * (liquid / 255)) & 0xfe;
      if (sunk >= 15) break;
      height -= sunk;
      if (height <= 0) break;
    }
    dx += row % 2 === 0 ? 1 : -1;
    dy += 16;
  }
  return out;
}

/**
 * The object pass's sprites of the waterfalls whose source lies in `area` (docs/assets.md, "Waterfalls"), frame 0 of
 * their sheets, behind the blocks and under the liquids' front layer as the game draws them; shimmer's grey sheet
 * tinted (its edge band); and the rain under rain clouds.
 */
export function waterfallSprites(world: WaterfallWorld, area: TileArea): ObjectSprite[] {
  const reader = new Reader(world);
  const pieces: Piece[] = [];
  for (const source of waterfallSources(world, area)) pieces.push(...streamPieces(reader, world, source, sheetOf(source.kind)));
  for (let x = Math.max(0, area.left); x < Math.min(world.width, area.right); x++) {
    for (let y = Math.max(0, area.top); y < Math.min(world.height - 1, area.bottom); y++) {
      const rain = RAIN_CLOUDS.get(reader.type(x, y));
      if (rain !== undefined) pieces.push(...rainPieces(reader, x, y, rain));
    }
  }
  return pieces.map((piece) => {
    const shimmer = piece.type === 25;
    return {
      kind: "waterfall" as const, id: piece.type, sx: piece.sx, sy: piece.sy + (shimmer ? SHIMMER_EDGE_BAND : 0),
      width: piece.width, height: piece.height, dx: piece.dx, dy: piece.dy, flip: piece.flip,
      alpha: Math.round(255 * Math.min(1, Math.max(0, piece.alpha))), behind: true, ...(shimmer ? { tint: true } : {}),
    };
  });
}
