// Waterfalls (docs/assets.md, "Waterfalls"): where the game starts one and the path it takes, as tile steps the object
// pass draws from the `Waterfall_<n>` sheets. Sources follow the game's own source finder, observed at runtime on
// synthetic tiles (R, scripts/waterfalls/observe.ps1); the path follows in-game screenshots of test setups (G).
import type { ContentRef } from "@studio/world-model";
import { terrariaFramingData } from "../framing/terraria-framing.generated.js";
import { OBJECT_TILES } from "./object-sprites.js";
import type { ObjectSprite, TileArea } from "./object-sprites.js";

/** Steps a waterfall takes at most, its source's lip included (R: the manager's `maxLength`). */
export const WATERFALL_MAX_LENGTH = 100;
/** The last steps over which a waterfall fades out (G: the long drop fades over about eight tiles). */
export const WATERFALL_FADE_STEPS = 8;
/** The liquid beside a source must hold more than this (R: the manager's `minWet`). */
export const WATERFALL_MIN_WET = 160;
/** CWM block shapes: a half block, and the slopes whose surface goes down to the right / to the left. */
const HALF = 1;
const DOWN_RIGHT = 2;
const DOWN_LEFT = 3;
const ABSENT = 0xffff;
/** CWM liquid kind of shimmer. */
const SHIMMER = 4;
/** The first row of shimmer's edge band in Waterfall_25 (measured, S). */
const SHIMMER_EDGE_BAND = 42;

/** The slice of a world waterfalls are read from. Planes are column-major (`x * height + y`). */
export interface WaterfallWorld {
  readonly width: number;
  readonly height: number;
  readonly planes: {
    readonly block: Uint16Array;
    readonly frameX?: Int16Array;
    readonly shape?: Uint8Array;
    readonly liquid: Uint8Array;
    readonly liquidAmount: Uint8Array;
  };
  readonly palette: readonly ContentRef[];
}

/** A waterfall's start: its half block, the way it flows (1 right, -1 left) and the CWM liquid kind (1–4). */
export interface WaterfallSource {
  readonly x: number;
  readonly y: number;
  readonly direction: 1 | -1;
  readonly kind: number;
}

/**
 * One tile of a waterfall's path. `lip`: the stream pours over this tile's edge on the `direction` side (the source's
 * half block, a ledge's end); `fall`: it falls down this tile's side facing where it came from; `run`: it runs along
 * the top of the block below this tile; `slide`: it slides down this tile's slope.
 */
export interface WaterfallStep {
  readonly piece: "lip" | "fall" | "run" | "slide";
  readonly x: number;
  readonly y: number;
  readonly direction: 1 | -1;
  /** 255, falling to near 0 over the last WATERFALL_FADE_STEPS of WATERFALL_MAX_LENGTH steps. */
  readonly alpha: number;
}

/**
 * Ropes and webs: no solid block although the world stores no frame for them (G: a stream pours past a rope beside a
 * hole and falls through it; chosen for the others): rope, chain, vine rope, silk rope, web rope and cobweb.
 */
const ROPES_AND_WEBS: readonly number[] = [213, 214, 353, 365, 366, 51];

/**
 * Tile ids that hold no solid block although the world stores no frame for them: vines and cactus (the framing
 * database's non-blocks), the trees the object pass draws, ropes and webs.
 */
const NOT_SOLID: ReadonlySet<number> = new Set([...terrariaFramingData.nonBlocks.types, ...OBJECT_TILES, ...ROPES_AND_WEBS]);

/** Reads a world's tiles for waterfalls. */
class Reader {
  readonly #world: WaterfallWorld;
  readonly #solidIndex: Uint8Array;

  constructor(world: WaterfallWorld) {
    this.#world = world;
    this.#solidIndex = Uint8Array.from(world.palette, (ref) => (ref.kind === "vanilla" && NOT_SOLID.has(ref.id) ? 0 : 1));
  }

  inWorld(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.#world.width && y < this.#world.height;
  }

  #index(x: number, y: number): number {
    return x * this.#world.height + y;
  }

  shape(x: number, y: number): number {
    return this.#world.planes.shape?.[this.#index(x, y)] ?? 0;
  }

  /** The liquid kind (1–4) and amount at (x, y); none outside the world. */
  liquid(x: number, y: number): { readonly kind: number; readonly amount: number } {
    if (!this.inWorld(x, y)) return { kind: 0, amount: 0 };
    const i = this.#index(x, y);
    const kind = this.#world.planes.liquid[i] ?? 0;
    const amount = this.#world.planes.liquidAmount[i] ?? 0;
    return kind >= 1 && kind <= 4 && amount !== 0 ? { kind, amount } : { kind: 0, amount: 0 };
  }

  /**
   * Whether (x, y) holds a solid block (chosen, docs/assets.md "Waterfalls"): a block the world stores no frame for,
   * except vines, cactus, trees, ropes and webs. Furniture, plants, platforms and other framed content do not stop water.
   */
  solid(x: number, y: number): boolean {
    if (!this.inWorld(x, y)) return false;
    const i = this.#index(x, y);
    const block = this.#world.planes.block[i] ?? ABSENT;
    if (block === ABSENT || this.#solidIndex[block] === 0) return false;
    return (this.#world.planes.frameX?.[i] ?? -1) < 0;
  }

  /** The way a slope at (x, y) goes down (1 right, -1 left), or 0 for none. */
  slope(x: number, y: number): 0 | 1 | -1 {
    if (!this.solid(x, y)) return 0;
    const shape = this.shape(x, y);
    return shape === DOWN_RIGHT ? 1 : shape === DOWN_LEFT ? -1 : 0;
  }
}

/**
 * The waterfall sources inside `area` (R, docs/assets.md "Waterfalls"): a half block with liquid of more than 160 on
 * one side and, on the other, no solid full block, no slope and no liquid at all; no liquid above it. The waterfall
 * flows away from the liquid, in the liquid's kind.
 */
export function waterfallSources(world: WaterfallWorld, area: TileArea): WaterfallSource[] {
  const reader = new Reader(world);
  const out: WaterfallSource[] = [];
  const left = Math.max(0, area.left), right = Math.min(world.width, area.right);
  const top = Math.max(0, area.top), bottom = Math.min(world.height, area.bottom);
  for (let x = left; x < right; x++) {
    for (let y = top; y < bottom; y++) {
      if (!reader.solid(x, y) || reader.shape(x, y) !== HALF || reader.liquid(x, y - 1).kind !== 0) continue;
      for (const direction of [1, -1] as const) {
        const wet = reader.liquid(x - direction, y);
        if (wet.amount <= WATERFALL_MIN_WET) continue;
        const open = x + direction;
        const blocked = reader.liquid(open, y).kind !== 0 || (reader.solid(open, y) && reader.shape(open, y) !== HALF);
        if (!blocked) out.push({ x, y, direction, kind: wet.kind });
      }
    }
  }
  return out;
}

/**
 * The `Waterfall_<n>` sheet of CWM liquid kinds 1–4 (R: the type the source finder gives water, lava, honey and
 * shimmer). Water is always the forest style, as for the liquids ("Liquids").
 */
export const WATERFALL_SHEETS: readonly number[] = [0, 1, 14, 25];

/**
 * The frame the viewer draws (S, docs/assets.md "Waterfalls": 16 animation frames 32 pixels apart; frame 0, as liquids
 * are not animated). Its art flows left: the lip's flat part (x 16–31) lies over the tile it pours from, its column
 * part (x 10–15) hangs into the next tile; below it (rows 24–39) the 10-pixel column the stream falls in.
 */
const LIP = { sx: 10, sy: 0, width: 22, height: 24 } as const;
const COLUMN = { sx: 10, sy: 24, width: 10, height: 16 } as const;
/**
 * The film on the ground: the lip's flat part, its top FILM_RISE pixels above the ground and its lower half behind the
 * ground's block, where it shows through the block's transparent pixels (G: water fills the notches of a staircase).
 */
const FILM = { sx: 16, sy: 0, width: 16, height: 16 } as const;
const FILM_RISE = 8;
/** The lip's corner: its column part with the 4 pixels of flat part the column reaches back over (x 10–19). */
const CORNER = { sx: 10, sy: 0, width: 10, height: 24 } as const;
/** The lip's column part reaches this far past its tile; the column 4 pixels back over it. */
const LIP_OVERHANG = 6;
const COLUMN_BACK = 4;
const TILE = 16;

/**
 * The object pass's sprites of the waterfalls whose source lies in `area` (docs/assets.md, "Waterfalls"): per step of
 * its path, a lip at the tile it pours from (its top at the source's liquid surface, or on the ground a ledge's lip
 * sits on), the column down the side of a falling tile, a film on the ground under a running tile, and on a slope 2-pixel
 * films along its surface. Mirrored for a waterfall flowing right; faded by its step.
 */
export function waterfallSprites(world: WaterfallWorld, area: TileArea): ObjectSprite[] {
  const reader = new Reader(world);
  const out: ObjectSprite[] = [];
  for (const source of waterfallSources(world, area)) {
    const id = WATERFALL_SHEETS[source.kind - 1];
    if (id === undefined) continue;
    const path = pathOf(reader, source);
    // Down a step of one tile (a ledge's lip, one falling tile, then ground again) the game shows the film and a short
    // corner reaching the next step, no falling column (G: in-game screenshot of a staircase, 2026-10-14).
    const oneTileDrop = (index: number): boolean =>
      path[index]?.piece === "lip" && path[index + 1]?.piece === "fall" && path[index + 2]?.piece !== "fall" && index > 0;
    // Past the low tip of a slope going down back towards it, the stream falls straight on (G: in-game screenshot of the
    // user's setup 4): the column keeps its mirroring and its edge until the stream next runs, pours or slides.
    let straight: { readonly flip: boolean; readonly edge: number } | null = null;
    for (const [index, step] of path.entries()) {
      if (step.piece === "fall" && oneTileDrop(index - 1)) continue;
      const previous = path[index - 1];
      const turnsBack = step.piece === "slide" && previous?.piece === "fall" && previous.direction !== step.direction;
      if (turnsBack) {
        straight ??= { flip: previous.direction === 1, edge: previous.direction === 1 ? previous.x * TILE : (previous.x + 1) * TILE };
      } else if (step.piece !== "fall") {
        straight = null;
      }
      const flip = straight?.flip ?? step.direction === 1;
      // Shimmer's sheet is a grey mask the game colours while drawing (S): tinted by its map colour (chosen). Behind the
      // blocks (G: the source's half block stays visible under the lip, the basin's blocks cover the column's edge) and under the
      // liquids (G: a stream pouring into a pool ends at its surface).
      const base = { kind: "waterfall" as const, id, flip, alpha: step.alpha, behind: true, underLiquid: true, ...(source.kind === SHIMMER ? { tint: true } : {}) };
      // Shimmer's sheet: three bands 42 rows apart, the shape (rows 0–39), its edge mask (42–81) and a fainter one; the
      // viewer draws the edge band, blended from lavender to its light edge by its grey (the object pass, OBJECT_TINT).
      const band = source.kind === SHIMMER ? SHIMMER_EDGE_BAND : 0;
      const left = step.x * TILE;
      const ground = (step.y + 1) * TILE + (reader.solid(step.x, step.y + 1) && reader.shape(step.x, step.y + 1) === HALF ? TILE / 2 : 0);
      if (step.piece === "lip" && step.x === source.x && step.y === source.y) {
        out.push({ ...base, ...LIP, sy: LIP.sy + band, dx: flip ? left : left - LIP_OVERHANG, dy: step.y * TILE });
      } else if (step.piece === "lip") {
        // A ledge's end (G): the film over the ledge, and the corner turning down past its edge.
        out.push({ ...base, ...FILM, sy: FILM.sy + band, dx: left, dy: ground - FILM_RISE });
        const corner = oneTileDrop(index) ? { ...CORNER, height: TILE } : CORNER;
        out.push({ ...base, ...corner, sy: corner.sy + band, dx: flip ? left + TILE - COLUMN_BACK : left - CORNER.width + COLUMN_BACK, dy: ground - FILM_RISE });
      } else if (step.piece === "fall" || turnsBack) {
        // The column hugs the edge the stream falls along: 4 pixels over the side it came from (mirrored: right of it).
        const edge = straight?.edge ?? (step.direction === 1 ? left : left + TILE);
        const dx = flip ? edge - COLUMN_BACK : edge - COLUMN.width + COLUMN_BACK;
        // Off a slope's tip the column reaches up to the slide's last film (G: in-game screenshot of setup 3): its lower
        // half above the tile, so the stream has no gap there.
        if (step.piece === "fall" && previous?.piece === "slide" && !turnsBack && straight === null) {
          out.push({ ...base, ...COLUMN, sy: COLUMN.sy + TILE / 2 + band, height: TILE / 2, dx, dy: step.y * TILE - TILE / 2 });
        }
        out.push({ ...base, ...COLUMN, sy: COLUMN.sy + band, dx, dy: step.y * TILE });
      } else if (step.piece === "run") {
        out.push({ ...base, ...FILM, sy: FILM.sy + band, dx: left, dy: ground - FILM_RISE });
      } else {
        // A slope's surface: down to the right from its top-left (shape 2), down to the left from its top-right (3).
        for (let column = 0; column < TILE / 2; column++) {
          const surface = step.direction === 1 ? 2 * column : TILE - 2 - 2 * column;
          out.push({ ...base, sx: FILM.sx + 2 * column, sy: band, width: 2, height: FILM.height, dx: left + 2 * column, dy: step.y * TILE + surface - FILM_RISE });
        }
      }
    }
  }
  return out;
}

/** The alpha of step `index` (0-based). */
function fade(index: number): number {
  const left = WATERFALL_MAX_LENGTH - index;
  return left > WATERFALL_FADE_STEPS ? 255 : Math.round((255 * left) / (WATERFALL_FADE_STEPS + 1));
}

/**
 * The path of the waterfall from `source` (G, docs/assets.md "Waterfalls"), at most WATERFALL_MAX_LENGTH steps: a lip
 * over the source; then it falls while the tile below is open; on a slope it slides along it, taking the slope's
 * downhill direction; on flat ground it runs along the top until the next tile ahead has open ground below it, where
 * it pours over the edge (a lip) and falls again. It ends in liquid, against a solid block or at the world's edge.
 */
export function waterfallPath(world: WaterfallWorld, source: WaterfallSource): WaterfallStep[] {
  return pathOf(new Reader(world), source);
}

/** waterfallPath over a reader already set up (waterfallSprites walks every source with one). */
function pathOf(reader: Reader, source: WaterfallSource): WaterfallStep[] {
  const out: WaterfallStep[] = [];
  let direction = source.direction;
  const push = (piece: WaterfallStep["piece"], x: number, y: number): boolean => {
    out.push({ piece, x, y, direction, alpha: fade(out.length) });
    return out.length < WATERFALL_MAX_LENGTH;
  };
  if (!push("lip", source.x, source.y)) return out;
  // The lip covers the tile beside the source; the stream goes on below it.
  let x = source.x + direction;
  let y = source.y + 1;
  let falling = true;
  for (;;) {
    if (!reader.inWorld(x, y) || reader.liquid(x, y).kind !== 0) break;
    const slope = reader.slope(x, y);
    if (slope !== 0) {
      direction = slope;
      if (!push("slide", x, y)) break;
      x += direction;
      // Against a block level with the slope's low tip the stream runs on along its top (G: a staircase); else it
      // goes on below the tip.
      if (reader.solid(x, y + 1) && reader.slope(x, y + 1) === 0) {
        falling = false;
        continue;
      }
      y += 1;
      falling = true;
      continue;
    }
    if (reader.solid(x, y)) break;
    if (!reader.inWorld(x, y + 1)) {
      push("fall", x, y);
      break;
    }
    if (!reader.solid(x, y + 1) || reader.slope(x, y + 1) !== 0) {
      if (!push("fall", x, y)) break;
      y += 1;
      falling = true;
      continue;
    }
    // On flat ground: the column reaches it, then the stream runs on.
    if (falling && !push("fall", x, y)) break;
    falling = false;
    const ahead = x + direction;
    if (!reader.inWorld(ahead, y) || reader.solid(ahead, y) || reader.liquid(ahead, y).kind !== 0) {
      push("run", x, y);
      break;
    }
    if (!reader.solid(ahead, y + 1) || reader.slope(ahead, y + 1) !== 0) {
      if (!push("lip", x, y)) break;
      x = ahead;
      y += 1;
      falling = true;
      continue;
    }
    if (!push("run", x, y)) break;
    x = ahead;
  }
  return out;
}
