// The liquid layout of sprite mode (docs/assets.md, "Liquids"): per tile, which piece of its liquid's water sheet the
// game draws there, cut where and how faded, and the liquid piece it draws behind a solid block. Worked out on the CPU
// per chunk, from the tiles around it, and handed to the chunk pass as three 16-bit planes (encoded below).
import type { ContentRef } from "@studio/world-model";
import { terrariaSpriteObjects } from "../objects/terraria-sprite-objects.generated.js";

const ABSENT = 0xffff;
/** CWM shapes: a half block; 2–5 are the slopes (the game's slope 1–4 is shape − 1). */
const HALF = 1;
/** Single precision, as the game computes the layout. */
const f32 = Math.fround;

/**
 * The sheet number of CWM liquid kinds 1–4 (water, lava, honey, shimmer) among `Misc/water_<n>`, `Liquid_<n>` and
 * `LiquidSlope_<n>` (S). Water is always the forest style: the others depend on where the player stands, which a
 * world does not record.
 */
export const LIQUID_SHEET_IDS: readonly number[] = [0, 1, 11, 14];

/** How many tiles below a liquid its falling look reaches, by CWM kind 1–4 (water, lava, honey, shimmer). */
export const LIQUID_FALL_REACH: readonly number[] = [10, 3, 2, 10];

/** Tile ids with liquid rules of their own: the bubble block (no liquid shows behind or beside it) and the grate. */
const BUBBLE = 379;
const GRATE = 546;
/** The glass wall: liquid behind a block shows a little less through it than through no wall. */
const GLASS_WALL = 21;

/** Tiles the layout reads around a chunk: falls reach 10 tiles down, corners and smoothing a few tiles across. */
const MARGIN_X = 6;
const MARGIN_TOP = 14;
const MARGIN_BOTTOM = 6;
/** How far a changed tile changes the layout of the tiles around it: across, above and (through falls) below it. */
export const LIQUID_LAYOUT_REACH: { readonly x: number; readonly up: number; readonly down: number } = { x: MARGIN_X, up: MARGIN_BOTTOM, down: MARGIN_TOP };

/** The front layer's opacity (0–255) by CWM kind 1–4: water 0.6, lava and honey 0.95, shimmer 0.75. */
export const LIQUID_FRONT_ALPHA: readonly number[] = [153, 242, 242, 191];

/** Opacity codes of a piece behind a block (BEHIND_OPACITIES gives the value). */
export const BEHIND_OPACITY = { none: 0, half: 1, wall: 2, glass: 3, full: 4, halfFading: 5, fullFading: 6, shimmer: 7 } as const;
/** The opacity of each BEHIND_OPACITY code; shimmer's is its own (0.75, 1 in the back layer). */
export const BEHIND_OPACITIES: readonly number[] = [0, 0.5, 0.6, 0.9, 1, 0.5, 1, 0.75];
/** The codes whose piece fades in from its top. */
export const BEHIND_FADING: readonly number[] = [BEHIND_OPACITY.halfFading, BEHIND_OPACITY.fullFading];

/** The slice of a world the layout reads. Planes are column-major (`x * height + y`). */
export interface LiquidLayoutWorld {
  readonly width: number;
  readonly height: number;
  /** The world's surface level: liquids high above it draw their animated top instead of the surface band. */
  readonly surfaceY: number;
  readonly planes: {
    readonly block: Uint16Array;
    readonly wall: Uint16Array;
    readonly liquid: Uint8Array;
    readonly liquidAmount: Uint8Array;
    readonly shape?: Uint8Array;
    readonly flags?: Uint16Array;
  };
  readonly palette: readonly ContentRef[];
}

export interface LiquidRegion {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Three planes over a region, column-major (`(x − left) · height + (y − top)`):
 * - `cell`: the liquid's piece of its water sheet: kind (1–4, 0 none) in bits 12–14, the piece's source x in bits 6–11
 *   and source y in bits 0–5, 63 for the surface band;
 * - `rect`: where the piece lies in the tile, offset x and y in bits 12–15 and 8–11, width − 1 and height − 1 in bits
 *   4–7 and 0–3;
 * - `behind`: the liquid piece behind a solid block (mode in bits 0–2, 0 none; its top in 2-pixel steps in bits 3–5;
 *   bit 6 when it starts at its sheet's top row; opacity code in bits 7–9; kind − 1 in bits 10–11), and in bits 12–15
 *   the tile's own piece's fade (steps below the liquid it falls from).
 */
export interface LiquidLayout {
  readonly cell: Uint16Array;
  readonly rect: Uint16Array;
  readonly behind: Uint16Array;
}

/** The surface band's source y code in `cell`. */
export const SURFACE_SOURCE_Y = 63;

/** Per palette index: the liquid classes of its tile (bits) and whether it names the glass wall. */
const SOLID_BLOCK = 1;
const SOLID_TOP = 2;
const HIDES_LIQUID = 4;
const BUBBLE_TILE = 8;
const GRATE_TILE = 16;
const GLASS = 32;

const solidBlocks = new Set(terrariaSpriteObjects.solidBlocks);
const solidTops = new Set(terrariaSpriteObjects.solidTops);
const hidesLiquid = new Set(terrariaSpriteObjects.hidesLiquidBehind);

function classesOf(palette: readonly ContentRef[]): Uint8Array {
  return Uint8Array.from(palette, (ref) => {
    if (ref.kind !== "vanilla") return 0;
    const id = ref.id;
    return (solidBlocks.has(id) ? SOLID_BLOCK : 0) | (solidTops.has(id) ? SOLID_TOP : 0) | (hidesLiquid.has(id) ? HIDES_LIQUID : 0)
      | (id === BUBBLE ? BUBBLE_TILE : 0) | (id === GRATE ? GRATE_TILE : 0) | (id === GLASS_WALL ? GLASS : 0);
  });
}

/** The CWM flags bit of an inactive (actuated) tile. */
const INACTIVE = 32;

/**
 * The liquid layout of `region` (docs/assets.md, "Liquids"). `waterfallAt` says where a waterfall starts: no liquid is
 * drawn behind its half block.
 */
export function liquidLayout(
  world: LiquidLayoutWorld, region: LiquidRegion, waterfallAt: (x: number, y: number) => boolean = () => false,
): LiquidLayout {
  const classes = classesOf(world.palette);
  const { block, wall, liquid, liquidAmount, shape } = world.planes;
  // The grid: the region and its margins, past the world's edges too (empty tiles there). Index gx · rows + gy.
  const left = region.left - MARGIN_X, top = region.top - MARGIN_TOP;
  const right = region.left + region.width + MARGIN_X, bottom = region.top + region.height + MARGIN_BOTTOM;
  const columns = right - left, rows = bottom - top, count = columns * rows;
  const level = new Float32Array(count);
  const amount = new Uint8Array(count);
  const kind = new Uint8Array(count);
  const solid = new Uint8Array(count);
  const halfUnder = new Uint8Array(count);
  const hasWall = new Uint8Array(count);
  const visible = new Float32Array(count);
  const hasVisible = new Uint8Array(count);
  const opacityStep = new Uint8Array(count);
  const shownKind = new Uint8Array(count);
  const edges = new Uint8Array(count);
  const wallL = new Float32Array(count), wallR = new Float32Array(count), wallT = new Float32Array(count), wallB = new Float32Array(count);
  const shownL = new Float32Array(count), shownR = new Float32Array(count), shownT = new Float32Array(count), shownB = new Float32Array(count);
  const frameX = new Uint8Array(count), frameY = new Uint8Array(count);
  const TOP = 1, BOTTOM = 2, LEFT = 4, RIGHT = 8;

  const cellIndex = (gx: number, gy: number): number => gx * rows + gy;

  // The tiles: liquid, solidity (a solid block or slope; inactive blocks too), and a half block under liquid, which
  // takes the kind of the liquid above it.
  for (let gx = 0; gx < columns; gx++) {
    const x = left + gx;
    if (x < 0 || x >= world.width) continue;
    for (let gy = 0; gy < rows; gy++) {
      const y = top + gy;
      if (y < 0 || y >= world.height) continue;
      const i = cellIndex(gx, gy), w = x * world.height + y;
      const k = liquid[w] ?? 0, a = liquidAmount[w] ?? 0;
      const wet = k >= 1 && k <= 4 && a !== 0;
      amount[i] = wet ? a : 0;
      kind[i] = wet ? k : 0;
      level[i] = wet ? f32(a / 255) : 0;
      const b = block[w] ?? ABSENT;
      const c = b === ABSENT ? 0 : classes[b] ?? 0;
      solid[i] = (c & SOLID_BLOCK) !== 0 ? 1 : 0;
      hasWall[i] = (wall[w] ?? ABSENT) !== ABSENT ? 1 : 0;
      const aboveWet = gy > 0 && amount[i - 1] !== 0;
      halfUnder[i] = b !== ABSENT && (shape?.[w] ?? 0) === HALF && aboveWet && (c & SOLID_TOP) === 0 ? 1 : 0;
      if (halfUnder[i] !== 0 && !wet) kind[i] = kind[i - 1] ?? 0;
    }
  }

  // The visible level: a tile's own liquid; a half block under liquid is full; a dry tile between two liquids of one
  // kind (above and below, or left and right, neither solid) is filled to their mean, the fuller pair winning.
  for (let gx = 1; gx < columns - 1; gx++) {
    for (let gy = 1; gy < rows - 1; gy++) {
      const i = cellIndex(gx, gy);
      let v = 0;
      if (halfUnder[i] !== 0) {
        v = 1;
      } else if (amount[i] === 0) {
        const a = i - 1, b = i + 1, l = i - rows, r = i + rows;
        if (amount[a] !== 0 && amount[b] !== 0 && kind[a] === kind[b] && solid[a] === 0 && solid[b] === 0) {
          v = f32((level[a] ?? 0) + (level[b] ?? 0));
          kind[i] = kind[a] ?? 0;
        }
        if (amount[l] !== 0 && amount[r] !== 0 && kind[l] === kind[r] && solid[l] === 0 && solid[r] === 0) {
          v = Math.max(v, f32((level[l] ?? 0) + (level[r] ?? 0)));
          kind[i] = kind[l] ?? 0;
        }
        v = f32(v * 0.5);
      } else {
        v = level[i] ?? 0;
      }
      visible[i] = v;
      hasVisible[i] = v !== 0 ? 1 : 0;
    }
  }

  // Falls: below a visible liquid that is not in a solid block, the liquid keeps falling through open tiles, one step
  // fainter and lower per tile, its reach by kind. A solid block shows no liquid of its own.
  for (let gx = 0; gx < columns; gx++) {
    for (let gy = 0; gy < rows; gy++) {
      const i = cellIndex(gx, gy);
      if (hasVisible[i] !== 0 && (solid[i] === 0 || halfUnder[i] !== 0)) {
        opacityStep[i] = 0;
        shownKind[i] = kind[i] ?? 0;
        const reach = LIQUID_FALL_REACH[(kind[i] ?? 1) - 1] ?? 0;
        const step = f32(1 / (reach + 1));
        let fade = 1;
        for (let k = 1; k <= reach && gy + k < rows; k++) {
          fade = f32(fade - step);
          const below = i + k;
          if (solid[below] !== 0) break;
          visible[below] = Math.max(visible[below] ?? 0, f32((visible[i] ?? 0) * fade));
          opacityStep[below] = k;
          shownKind[below] = kind[i] ?? 0;
        }
      }
      if (solid[i] !== 0 && halfUnder[i] === 0) {
        visible[i] = 1;
        hasVisible[i] = 0;
      } else {
        hasVisible[i] = visible[i] !== 0 ? 1 : 0;
      }
    }
  }

  // Edges: a visible liquid's sides that face open, dry tiles, and how far its walls are pushed in by a neighbour
  // pouring into it; they pick the piece (frame) of the sheet.
  for (let gx = 1; gx < columns - 1; gx++) {
    for (let gy = 1; gy < rows - 1; gy++) {
      const i = cellIndex(gx, gy);
      if (hasVisible[i] === 0) {
        edges[i] = 0;
        continue;
      }
      const a = i - 1, b = i + 1, l = i - rows, r = i + rows;
      const open = (n: number): boolean => hasVisible[n] === 0 && solid[n] === 0;
      const openSide = (n: number): boolean => open(n) && halfUnder[n] === 0;
      const rest = f32(1 - (visible[i] ?? 0));
      let wl = 0, wr = 1, wt = 0, wb = 1;
      if (hasVisible[a] === 0) wt = f32(wt + f32((visible[b] ?? 0) * rest));
      if (openSide(b)) wb = f32(wb - f32((visible[a] ?? 0) * rest));
      if (openSide(l)) wl = f32(wl + f32((visible[r] ?? 0) * rest));
      if (openSide(r)) wr = f32(wr - f32((visible[l] ?? 0) * rest));
      wallL[i] = wl;
      wallR[i] = wr;
      wallT[i] = wt;
      wallB[i] = wb;
      const topEdge = open(a) || wt !== 0, bottomEdge = open(b) || wb !== 1;
      const leftEdge = open(l) || wl !== 0, rightEdge = open(r) || wr !== 1;
      edges[i] = (topEdge ? TOP : 0) | (bottomEdge ? BOTTOM : 0) | (leftEdge ? LEFT : 0) | (rightEdge ? RIGHT : 0);
      let fx = 0, fy = 0;
      if (!leftEdge) fx += rightEdge ? 32 : 16;
      if (leftEdge && rightEdge) {
        fx = 16;
        fy = topEdge ? 16 : 32;
      } else if (!topEdge) {
        fy += !leftEdge && !rightEdge ? 48 : 16;
      }
      // One side open and no top: every other row draws the next piece down, so long walls of liquid vary.
      if (fy === 16 && leftEdge !== rightEdge && (top + gy) % 2 === 0) fy += 16;
      frameX[i] = fx;
      frameY[i] = fy;
    }
  }

  // Smoothing: an open side's wall takes in its neighbours' along that side.
  for (let gx = 1; gx < columns - 1; gx++) {
    for (let gy = 1; gy < rows - 1; gy++) {
      const i = cellIndex(gx, gy);
      if (hasVisible[i] === 0) continue;
      const a = i - 1, b = i + 1, l = i - rows, r = i + rows, e = edges[i] ?? 0;
      shownL[i] = wallL[i] ?? 0;
      shownR[i] = wallR[i] ?? 0;
      shownT[i] = wallT[i] ?? 0;
      shownB[i] = wallB[i] ?? 0;
      const mean = (own: number, x: number, y: number): number => f32(f32(f32(own * 2) + x + y) * 0.25);
      if (hasVisible[a] !== 0 && hasVisible[b] !== 0) {
        if ((e & LEFT) !== 0) shownL[i] = mean(wallL[i] ?? 0, wallL[a] ?? 0, wallL[b] ?? 0);
        if ((e & RIGHT) !== 0) shownR[i] = mean(wallR[i] ?? 0, wallR[a] ?? 0, wallR[b] ?? 0);
      }
      if (hasVisible[l] !== 0 && hasVisible[r] !== 0) {
        if ((e & TOP) !== 0) shownT[i] = mean(wallT[i] ?? 0, wallT[l] ?? 0, wallT[r] ?? 0);
        if ((e & BOTTOM) !== 0) shownB[i] = mean(wallB[i] ?? 0, wallB[l] ?? 0, wallB[r] ?? 0);
      }
    }
  }

  // Liquid tiles at a top corner with one open side carry the walls of their neighbours on; a tile above a lone
  // column piece snaps to a side piece when its own walls lean that way.
  for (let gx = 1; gx < columns - 1; gx++) {
    for (let gy = 1; gy < rows - 1; gy++) {
      const i = cellIndex(gx, gy);
      if (amount[i] === 0) continue;
      const b = i + 1, l = i - rows, r = i + rows, e = edges[i] ?? 0;
      if ((e & TOP) !== 0 && (e & BOTTOM) === 0 && ((e & LEFT) !== 0) !== ((e & RIGHT) !== 0)) {
        if ((e & RIGHT) !== 0) {
          shownR[i] = shownR[b] ?? 0;
          shownT[i] = shownT[l] ?? 0;
        } else {
          shownL[i] = shownL[b] ?? 0;
          shownT[i] = shownT[r] ?? 0;
        }
      } else if (frameX[b] === 16 && frameY[b] === 32) {
        if ((shownL[i] ?? 0) > 0.5) {
          shownL[i] = 0;
          frameX[i] = 0;
          frameY[i] = 0;
        } else if ((shownR[i] ?? 0) < 0.5) {
          shownR[i] = 1;
          frameX[i] = 32;
          frameY[i] = 0;
        }
      }
    }
  }

  // Inner corners: a liquid tile without edges under a corner of its neighbours draws a corner piece, offset by how far
  // their walls reach in.
  for (let gx = 1; gx < columns - 1; gx++) {
    for (let gy = 1; gy < rows - 1; gy++) {
      const i = cellIndex(gx, gy);
      if (amount[i] === 0 || edges[i] !== 0) continue;
      const a = i - 1, l = i - rows, r = i + rows;
      const ea = edges[a] ?? 0;
      let corner = false;
      if (((edges[l] ?? 0) & TOP) !== 0 && (ea & LEFT) !== 0) {
        frameX[i] = Math.max(4, Math.trunc(f32(16 - f32((shownL[a] ?? 0) * 16)))) - 4;
        frameY[i] = 48 + Math.max(4, Math.trunc(f32(16 - f32((shownT[l] ?? 0) * 16)))) - 4;
        corner = true;
      } else if (((edges[r] ?? 0) & TOP) !== 0 && (ea & RIGHT) !== 0) {
        frameX[i] = 32 - Math.min(16, Math.trunc(f32((shownR[a] ?? 0) * 16)) - 4);
        frameY[i] = 48 + Math.max(4, Math.trunc(f32(16 - f32((shownT[r] ?? 0) * 16)))) - 4;
        corner = true;
      }
      if (corner) {
        shownL[i] = 0;
        shownT[i] = 0;
        shownR[i] = 1;
        shownB[i] = 1;
      }
    }
  }

  // The pieces of the region's tiles.
  const out: LiquidLayout = {
    cell: new Uint16Array(region.width * region.height),
    rect: new Uint16Array(region.width * region.height),
    behind: new Uint16Array(region.width * region.height),
  };
  for (let x = 0; x < region.width; x++) {
    for (let y = 0; y < region.height; y++) {
      const i = cellIndex(region.left + x - left, region.top + y - top), o = x * region.height + y;
      const worldY = region.top + y;
      if (hasVisible[i] !== 0) {
        const l = Math.min(0.75, shownL[i] ?? 0), r = Math.max(0.25, shownR[i] ?? 0), t = Math.min(0.75, shownT[i] ?? 0);
        let b = Math.max(0.25, shownB[i] ?? 0);
        if (halfUnder[i] !== 0 && solid[i] !== 0 && b > 0.5) b = 0.5;
        // A half block full of its own liquid with no wall behind it draws nothing (its block hides it).
        const drawn = hasWall[i] !== 0 || halfUnder[i] === 0 || amount[i] === 0 || (level[i] ?? 0) >= 1;
        const width = Math.ceil(f32(f32(r - l) * 16)), height = Math.ceil(f32(f32(b - t) * 16));
        if (drawn && width > 0 && height > 0) {
          const fx = frameX[i] ?? 0, fy = frameY[i] ?? 0;
          const surface = fx === 16 && fy === 0 && worldY > world.surfaceY - 40;
          const sx = Math.trunc(f32(16 - f32(r * 16))) + fx;
          const sy = surface ? SURFACE_SOURCE_Y : Math.trunc(f32(16 - f32(b * 16))) + fy;
          out.cell[o] = ((shownKind[i] ?? 0) << 12) | (sx << 6) | sy;
          out.rect[o] = (Math.floor(f32(l * 16)) << 12) | (Math.floor(f32(t * 16)) << 8) | ((width - 1) << 4) | (height - 1);
        }
      }
      out.behind[o] = behindCode(world, classes, region.left + x, worldY, waterfallAt) | ((opacityStep[i] ?? 0) << 12);
    }
  }
  return out;
}

/** The liquid kind (1–4) and amount at (x, y): none outside the world or in a bubble block. */
function liquidAt(world: LiquidLayoutWorld, classes: Uint8Array, x: number, y: number): readonly [number, number] {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return [0, 0];
  const w = x * world.height + y;
  const b = world.planes.block[w] ?? ABSENT;
  if (b !== ABSENT && ((classes[b] ?? 0) & BUBBLE_TILE) !== 0) return [0, 0];
  const k = world.planes.liquid[w] ?? 0, a = world.planes.liquidAmount[w] ?? 0;
  return k >= 1 && k <= 4 && a !== 0 ? [k, a] : [0, 0];
}

/** Whether (x, y) is a full solid block, active, as liquid beside a slope sees it; outside the world counts as solid. */
function fullSolid(world: LiquidLayoutWorld, classes: Uint8Array, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return true;
  const w = x * world.height + y;
  const b = world.planes.block[w] ?? ABSENT;
  if (b === ABSENT || ((classes[b] ?? 0) & SOLID_BLOCK) === 0) return false;
  return (world.planes.shape?.[w] ?? 0) === 0 && ((world.planes.flags?.[w] ?? 0) & INACTIVE) === 0;
}

/** Modes of a piece behind a block (bits 0–2 of `behind`). */
const MODE = { full: 1, above: 2, aboveShaped: 3, below: 4, across: 5, left: 6, right: 7 } as const;

/**
 * The piece of liquid the game draws behind the solid block at (x, y), from the liquid in it (a shaped block's) and
 * around it, under the block's sprite: bits 0–11 of `behind` (none: 0).
 */
function behindCode(
  world: LiquidLayoutWorld, classes: Uint8Array, x: number, y: number, waterfallAt: (x: number, y: number) => boolean,
): number {
  const w = x * world.height + y;
  const b = world.planes.block[w] ?? ABSENT;
  if (b === ABSENT) return 0;
  const c = classes[b] ?? 0;
  const shape = world.planes.shape?.[w] ?? 0;
  const slope = shape >= 2 ? shape - 1 : 0;
  if (((world.planes.flags?.[w] ?? 0) & INACTIVE) !== 0 || (c & SOLID_TOP) !== 0) return 0;
  const [rightKind, right] = liquidAt(world, classes, x + 1, y);
  const [leftKind, left] = liquidAt(world, classes, x - 1, y);
  const [aboveKind, above] = liquidAt(world, classes, x, y - 1);
  const [belowKind, below] = liquidAt(world, classes, x, y + 1);
  if (shape === HALF && (left > 160 || right > 160) && waterfallAt(x, y)) return 0;
  if ((c & HIDES_LIQUID) !== 0 && slope === 0) return 0;
  const ownKind = world.planes.liquid[w] ?? 0, own = ownKind >= 1 && ownKind <= 4 ? world.planes.liquidAmount[w] ?? 0 : 0;
  if ((c & BUBBLE_TILE) !== 0 && own > 0) return 0;
  // The kind drawn: the last of own, left, right, above, below that holds liquid, water only where nothing else does.
  let kind = 0;
  const take = (k: number): void => {
    if (k !== 1) kind = k;
  };
  let fill = 0, fromOwn = false, fromLeft = false, fromRight = false, fromAbove = false, fromBelow = false;
  if ((c & GRATE_TILE) !== 0 && own > 0) {
    fromOwn = fromBelow = fromLeft = fromRight = true;
    take(ownKind);
    fill = own;
  } else {
    if (own > 0 && shape !== 0 && (shape !== HALF || own > 160)) {
      fromOwn = true;
      take(ownKind);
      fill = Math.max(fill, own);
    }
    if (left > 0 && slope !== 1 && slope !== 3) {
      fromLeft = true;
      take(leftKind);
      fill = Math.max(fill, left);
    }
    if (right > 0 && slope !== 2 && slope !== 4) {
      fromRight = true;
      take(rightKind);
      fill = Math.max(fill, right);
    }
    if (above > 0 && slope !== 3 && slope !== 4) {
      fromAbove = true;
      take(aboveKind);
    }
    if (below > 0 && slope !== 1 && slope !== 2) {
      fromBelow = below > 240;
      take(belowKind);
    }
  }
  if (!fromAbove && !fromBelow && !fromLeft && !fromRight && !fromOwn) return 0;
  if ((c & SOLID_BLOCK) === 0) return 0;
  if (kind === 0) kind = 1;
  if (fromBelow && (fromLeft || fromRight)) fromLeft = fromRight = true;
  let mode: number = MODE.full, step = 0, sheetTop = false;
  if (!((fromAbove && (fromLeft || fromRight)) || (fromBelow && fromAbove))) {
    if (fromAbove) {
      mode = shape !== 0 ? MODE.aboveShaped : MODE.above;
    } else if (fromBelow && !fromLeft && !fromRight) {
      mode = MODE.below;
    } else {
      step = Math.trunc((256 - fill) / 32);
      sheetTop = above === 0 && (shape !== 0 || !fullSolid(world, classes, x, y - 1));
      mode = slope !== 0 || (fromLeft && fromRight) || shape === HALF ? MODE.across : fromLeft ? MODE.left : MODE.right;
    }
  }
  return mode | (step << 3) | (sheetTop ? 64 : 0) | (behindOpacity(world, classes, x, y, kind, shape, slope, left, right, above) << 7)
    | ((kind - 1) << 10);
}

/** The opacity code (BEHIND_OPACITY) of the piece behind the block at (x, y). */
function behindOpacity(
  world: LiquidLayoutWorld, classes: Uint8Array, x: number, y: number, kind: number, shape: number, slope: number,
  left: number, right: number, above: number,
): number {
  if (kind === 4) return BEHIND_OPACITY.shimmer;
  const w = x * world.height + y;
  const wallIndex = world.planes.wall[w] ?? ABSENT;
  const underground = y > world.surfaceY;
  // Water shows at half opacity underground, lava and honey fully; at the surface every liquid fully, less over a wall.
  let code: number = kind === 1 && underground ? BEHIND_OPACITY.half : BEHIND_OPACITY.full;
  if (!underground) {
    code = wallIndex === ABSENT ? BEHIND_OPACITY.full : ((classes[wallIndex] ?? 0) & GLASS) !== 0 ? BEHIND_OPACITY.glass : BEHIND_OPACITY.wall;
  }
  if (shape === HALF && above > 0 && wallIndex !== ABSENT) return BEHIND_OPACITY.none;
  if (slope === 4 && left === 0 && !fullSolid(world, classes, x - 1, y)) return BEHIND_OPACITY.none;
  if (slope === 3 && right === 0 && !fullSolid(world, classes, x + 1, y)) return BEHIND_OPACITY.none;
  if (shape === HALF && above > 0 && underground) return code === BEHIND_OPACITY.half ? BEHIND_OPACITY.halfFading : BEHIND_OPACITY.fullFading;
  return code;
}

/** A tile's liquid piece, decoded from its `cell` and `rect` and the fade in `behind`; null for none. */
export function liquidPiece(cell: number, rect: number, behind: number): {
  readonly kind: number; readonly source: { readonly x: number; readonly y: number };
  readonly offset: { readonly x: number; readonly y: number }; readonly size: { readonly width: number; readonly height: number };
  readonly surface: boolean; readonly fade: number;
} | null {
  const kind = (cell >> 12) & 7;
  if (kind === 0) return null;
  const sy = cell & 63;
  return {
    kind, source: { x: (cell >> 6) & 63, y: sy === SURFACE_SOURCE_Y ? 0 : sy },
    offset: { x: (rect >> 12) & 15, y: (rect >> 8) & 15 }, size: { width: ((rect >> 4) & 15) + 1, height: (rect & 15) + 1 },
    surface: sy === SURFACE_SOURCE_Y, fade: (behind >> 12) & 15,
  };
}

/**
 * The piece behind a block, decoded from `behind`: the kind, its rectangle in the tile, the row of its Liquid sheet it
 * starts at (for a slope's piece across the tile, its top: the shader takes it from the tile's shape), its opacity
 * code and whether it fades in from its top. Null for none.
 */
export function behindPiece(behind: number): {
  readonly kind: number; readonly dest: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly sourceY: number; readonly opacity: number; readonly gradient: boolean;
} | null {
  const mode = behind & 7;
  if (mode === 0) return null;
  const step = 2 * ((behind >> 3) & 7);
  const sheetTop = (behind & 64) !== 0;
  const opacity = (behind >> 7) & 7;
  const kind = ((behind >> 10) & 3) + 1;
  const gradient = opacity === BEHIND_OPACITY.halfFading || opacity === BEHIND_OPACITY.fullFading;
  const plain = opacity === BEHIND_OPACITY.halfFading ? BEHIND_OPACITY.half : opacity === BEHIND_OPACITY.fullFading ? BEHIND_OPACITY.full : opacity;
  const dest = mode === MODE.full ? { x: 0, y: 0, width: 16, height: 16 }
    : mode === MODE.above ? { x: 0, y: 0, width: 16, height: 4 }
    : mode === MODE.aboveShaped ? { x: 0, y: 0, width: 16, height: 12 }
    : mode === MODE.below ? { x: 0, y: 12, width: 16, height: 4 }
    : { x: mode === MODE.right ? 12 : 0, y: step, width: mode === MODE.across ? 16 : 4, height: 16 - step };
  return { kind, dest, sourceY: mode <= MODE.below ? 4 : sheetTop ? 0 : 4, opacity: plain, gradient };
}

/** The game's white noise of a position, in 32-bit unsigned arithmetic. */
function whiteNoise(x: number, y: number): number {
  const nx = (Math.imul(36469, x & 0xffff) + (x >>> 16)) >>> 0;
  const ny = (Math.imul(18012, y & 0xffff) + (y >>> 16)) >>> 0;
  return ((nx << 16) + ny) >>> 0;
}

/**
 * The opacity (0–255) of the glitter on a shimmer body piece at tile corner (x, y), still (docs/assets.md, "Liquids"):
 * the shimmer wave sin(((x + y / 6) / 10) · 2π) remapped from −0.5…1 to 0…0.35, times sin(noise / 10) of the corner's
 * white noise, remapped from 0…0.5 to 0…1, clamped. Computed here because the noise term needs the exact 32-bit
 * float steps, which a shader cannot reproduce.
 */
export function shimmerGlitter(x: number, y: number): number {
  const f = Math.fround;
  const wave = Math.sin(f(f(x + f(y / 6)) / 10) * 6.2831854820251465);
  const low = Math.min(1, Math.max(0, (wave + 0.5) / 1.5)) * 0.35;
  const noise = Math.sin(f(f(whiteNoise(x, y)) / 10));
  return Math.round(Math.min(1, Math.max(0, (f(low) * f(noise)) / 0.5)) * 255);
}

/** shimmerGlitter at the corners of `width` × `height` tiles from (left, top), column-major ((x − left) · height + y − top). */
export function shimmerGlitterPlane(left: number, top: number, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) out[x * height + y] = shimmerGlitter(left + x, top + y);
  return out;
}
