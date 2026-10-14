// Waterfalls (docs/assets.md, "Waterfalls"): where the game starts one and the path it takes, as tile steps the object
// pass draws from the `Waterfall_<n>` sheets. Sources follow the game's own source finder, observed at runtime on
// synthetic tiles (R, scripts/waterfalls/observe.ps1); the path follows in-game screenshots of test setups (G).
import type { ContentRef } from "@studio/world-model";
import { terrariaFramingData } from "../framing/terraria-framing.generated.js";
import { OBJECT_TILES } from "./object-sprites.js";
import type { TileArea } from "./object-sprites.js";

/** Steps a waterfall takes at most, its source's lip included (R: the manager's `maxLength`). */
export const WATERFALL_MAX_LENGTH = 100;
/** The last steps over which a waterfall fades out (G: the long drop fades over about eight tiles). */
export const WATERFALL_FADE_STEPS = 8;
/** The liquid beside a source must hold more than this (R: the manager's `minWet`). */
const MIN_WET = 160;
/** CWM block shapes: a half block, and the slopes whose surface goes down to the right / to the left. */
const HALF = 1;
const DOWN_RIGHT = 2;
const DOWN_LEFT = 3;
const ABSENT = 0xffff;

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
 * Tile ids that hold no solid block although the world stores no frame for them: vines and cactus (the framing
 * database's non-blocks) and the trees the object pass draws.
 */
const NOT_SOLID: ReadonlySet<number> = new Set([...terrariaFramingData.nonBlocks.types, ...OBJECT_TILES]);

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
   * except vines, cactus and trees. Furniture, plants, platforms and other framed content do not stop water.
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
        if (wet.amount <= MIN_WET) continue;
        const open = x + direction;
        const blocked = reader.liquid(open, y).kind !== 0 || (reader.solid(open, y) && reader.shape(open, y) !== HALF);
        if (!blocked) out.push({ x, y, direction, kind: wet.kind });
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
  const reader = new Reader(world);
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
