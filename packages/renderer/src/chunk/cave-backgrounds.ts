// Underground backgrounds as the game shows a still world (docs/assets.md, "Cave backgrounds"): the `Background_<n>`
// sheets of each style, the style the game shows around each block of tiles, and the bands they are drawn in.
import type { ContentRef } from "@studio/world-model";

/** The world header's underground background settings. */
export interface CaveBackgroundSettings {
  /** The three column edges of the four underground zones. */
  readonly caveBackX: readonly number[];
  /** The style of each of the four zones. */
  readonly caveBackStyles: readonly number[];
  readonly iceBackStyle: number;
  readonly jungleBackStyle: number;
  readonly hellBackStyle: number;
  /** Picks the rock sheet of some evil styles. */
  readonly worldId: number;
}

/** The slice of a world the styles are read from. Planes are column-major (`x * height + y`). */
export interface CaveWorld {
  readonly width: number;
  readonly height: number;
  readonly surfaceY: number;
  readonly rockY?: number;
  readonly planes: { readonly block: Uint16Array };
  readonly palette: readonly ContentRef[];
  readonly caves?: CaveBackgroundSettings;
}

/** A style is picked per block of this many tiles: one repeat of the sheets across and down. */
export const CAVE_BLOCK_WIDTH = 8;
export const CAVE_BLOCK_HEIGHT = 6;
/** Styles 1–21 (0: none). */
export const CAVE_STYLE_COUNT = 22;
/** The sheets of a style, by band: surface edge, dirt, rock edge, rock, magma edge, magma, underworld edge. */
export const CAVE_SLOTS = 7;

const ICE_SHEETS: readonly (readonly number[])[] = [[40, 33, 34, 32], [160, 118, 161, 117], [164, 165, 166, 167], [162, 120, 163, 119]];
/** The first four sheets and the magma edge (plus the underworld style) of styles 2–10. */
const STONE_SHEETS: readonly (readonly number[])[] = [
  [62, 63, 64, 65, 143], [66, 67, 68, 69, 128], [70, 71, 68, 72, 128], [73, 74, 75, 76, 131], [77, 78, 79, 80, 134],
  [77, 81, 79, 82, 134], [83, 84, 85, 86, 137], [83, 87, 88, 89, 137], [121, 122, 123, 124, 140],
];
const JUNGLE_SHEETS: readonly (readonly number[])[] = [[153, 147, 148, 149, 150], [146, 154, 155, 156, 157]];
/** Styles 12–17: the evil rock sheet, its first id and how many the world id picks from. */
const EVIL_ROCK: readonly (readonly [number, number])[] = [[193, 4], [188, 5], [197, 3], [200, 1], [201, 2], [203, 4]];

/** The `Background_<n>` id of each band of `style` (0: not drawn). */
export function caveBackgroundSheets(style: number, settings: CaveBackgroundSettings): readonly number[] {
  if (style < 1 || style >= CAVE_STYLE_COUNT) return [0, 0, 0, 0, 0, 0, 0];
  const hell = settings.hellBackStyle;
  let sheets: number[];
  if (style === 1) sheets = [...(ICE_SHEETS[settings.iceBackStyle] ?? ICE_SHEETS[3] ?? []), 128 + hell];
  else if (style <= 10) sheets = (STONE_SHEETS[style - 2] ?? []).map((id, slot) => (slot === 4 ? id + hell : id));
  else if (style === 11) sheets = (JUNGLE_SHEETS[settings.jungleBackStyle === 0 ? 0 : 1] ?? []).map((id, slot) => (slot === 4 ? id + hell : id));
  else if (style <= 17) {
    const [first, count] = EVIL_ROCK[style - 12] ?? [0, 1];
    sheets = [...(style <= 14 ? [66, 67, 68] : [40, 33, 34]), first + Math.abs(settings.worldId) % count, 128 + hell];
  } else sheets = [290 + (style - 18) * 2, 291 + (style - 18) * 2, 0, 0, 0];
  return [...sheets, 125 + hell, 185 + hell];
}

/** Every sheet a style can draw: the ones the atlas holds. */
export const CAVE_BACKGROUND_IDS: ReadonlySet<number> = new Set(
  // World ids 0–59 cover every choice of the evil rock sheets (counts 1–5).
  Array.from({ length: CAVE_STYLE_COUNT * 4 * 2 * 3 * 60 }, (_, k) => caveBackgroundSheets(k % CAVE_STYLE_COUNT, {
    caveBackX: [], caveBackStyles: [], iceBackStyle: Math.floor(k / CAVE_STYLE_COUNT) % 4,
    jungleBackStyle: Math.floor(k / (CAVE_STYLE_COUNT * 4)) % 2, hellBackStyle: Math.floor(k / (CAVE_STYLE_COUNT * 8)) % 3,
    worldId: Math.floor(k / (CAVE_STYLE_COUNT * 24)),
  })).flat().filter((id) => id !== 0),
);

/**
 * Where the bands lie, in world pixels (16 per tile) from the top: `bands[k]` starts band k (the slots of
 * caveBackgroundSheets), `bands[7]` ends the last; the dirt, rock and magma sheets repeat every 96 pixels from the
 * starts of their bands, the magma's from `magmaTop`.
 */
export function caveBackgroundBands(surfaceY: number, rockY: number, height: number): { bands: readonly number[]; magmaTop: number } {
  const repeat = 96;
  const surface = Math.round(surfaceY * 16);
  const rockEdge = Math.floor(surfaceY) * 16 + Math.ceil(((Math.floor(rockY) - Math.floor(surfaceY)) * 16) / repeat) * repeat + 32;
  const magma = surfaceY + Math.floor((height - 330 - surfaceY) / 6) * 6 - 5;
  const magmaEdge = rockEdge + Math.floor((magma * 16 + 600 - rockEdge) / repeat) * repeat;
  const magmaTop = Math.round(magma * 16 + 608);
  const underworld = magmaTop + Math.ceil(((height - 200) * 16 - magmaTop) / repeat) * repeat;
  return {
    bands: [surface, surface + 16, rockEdge - 16, rockEdge, magmaEdge, magmaEdge + 16, underworld, underworld + 16],
    magmaTop,
  };
}

// Biome tile counts: bit per biome of each tile id.
const SNOW = 1;
const JUNGLE = 2;
const EVIL = 4;
const BLOOD = 8;
const HOLY = 16;
const MUSHROOM = 32;
const BIOMES = 6;
const BIOME_TILES: readonly (readonly [number, readonly number[]])[] = [
  [SNOW, [147, 148, 161, 162, 164, 163, 200]],
  [JUNGLE, [60, 61, 62, 74, 226, 225]],
  [EVIL, [23, 661, 24, 25, 32, 112, 163, 400, 398]],
  [BLOOD, [199, 662, 201, 203, 200, 401, 399, 234, 352]],
  [HOLY, [109, 492, 110, 113, 117, 116, 164, 403, 402]],
  [MUSHROOM, [70, 71, 72, 528]],
];
const BIOME_OF = new Map<number, number>();
for (const [bit, ids] of BIOME_TILES) for (const id of ids) BIOME_OF.set(id, (BIOME_OF.get(id) ?? 0) | bit);

/**
 * The game counts biome tiles in a 169 × 124 window around the view's centre; here around each block's, whole blocks
 * of it: 21 × 21 blocks (168 × 126 tiles).
 */
const WINDOW_BEFORE = 10;
const WINDOW_AFTER = 11;
/** Half the height of the view the game assumes, in tiles. */
const VIEW_HALF_ROWS = 37.5;
const BEACH_COLUMNS = 380;

/**
 * The style around each block of CAVE_BLOCK_WIDTH × CAVE_BLOCK_HEIGHT tiles (row-major, `by * width + bx`), as the
 * game picks it with the view centred on the block; null without the header's settings or a rock level.
 */
export function caveBackgroundStyles(world: CaveWorld): { width: number; height: number; styles: Uint8Array } | null {
  const { caves, rockY, surfaceY } = world;
  if (caves === undefined || rockY === undefined) return null;
  const width = Math.ceil(world.width / CAVE_BLOCK_WIDTH);
  const height = Math.ceil(world.height / CAVE_BLOCK_HEIGHT);
  const paletteBiomes = world.palette.map((ref) => (ref.kind === "vanilla" ? (BIOME_OF.get(ref.id) ?? 0) : 0));

  // Summed biome counts per block: sums[((by + 1) * (width + 1) + bx + 1) * BIOMES + biome] covers blocks above and left.
  const stride = width + 1;
  const sums = new Int32Array(stride * (height + 1) * BIOMES);
  const { block } = world.planes;
  for (let x = 0; x < world.width; x++) {
    const column = x * world.height;
    const bx = Math.floor(x / CAVE_BLOCK_WIDTH);
    for (let y = 0; y < world.height; y++) {
      const index = block[column + y] ?? 0xffff;
      const biomes = index === 0xffff ? 0 : (paletteBiomes[index] ?? 0);
      if (biomes === 0) continue;
      const at = ((Math.floor(y / CAVE_BLOCK_HEIGHT) + 1) * stride + bx + 1) * BIOMES;
      for (let biome = 0; biome < BIOMES; biome++) if ((biomes & (1 << biome)) !== 0) sums[at + biome] = (sums[at + biome] ?? 0) + 1;
    }
  }
  for (let by = 1; by <= height; by++) {
    for (let bx = 1; bx <= width; bx++) {
      for (let biome = 0; biome < BIOMES; biome++) {
        const at = (by * stride + bx) * BIOMES + biome;
        sums[at] = (sums[at] ?? 0) + (sums[at - BIOMES] ?? 0) + (sums[at - stride * BIOMES] ?? 0) - (sums[at - (stride + 1) * BIOMES] ?? 0);
      }
    }
  }
  const counts = new Int32Array(BIOMES);
  const count = (bx: number, by: number): void => {
    const left = Math.max(0, bx - WINDOW_BEFORE);
    const right = Math.min(width, bx + WINDOW_AFTER);
    const top = Math.max(0, by - WINDOW_BEFORE);
    const bottom = Math.min(height, by + WINDOW_AFTER);
    for (let biome = 0; biome < BIOMES; biome++) {
      const at = (row: number, col: number): number => sums[(row * stride + col) * BIOMES + biome] ?? 0;
      counts[biome] = at(bottom, right) - at(top, right) - at(bottom, left) + at(top, left);
    }
  };

  const magma = surfaceY + Math.floor((world.height - 330 - surfaceY) / 6) * 6 - 5;
  const oceanLevel = (surfaceY + rockY) / 2 + 40;
  const styles = new Uint8Array(width * height);
  for (let by = 0; by < height; by++) {
    const cy = by * CAVE_BLOCK_HEIGHT + CAVE_BLOCK_HEIGHT / 2;
    for (let bx = 0; bx < width; bx++) {
      const cx = bx * CAVE_BLOCK_WIDTH + CAVE_BLOCK_WIDTH / 2;
      count(bx, by);
      const snow = counts[0] ?? 0;
      const jungle = counts[1] ?? 0;
      const rawEvil = counts[2] ?? 0;
      const rawBlood = counts[3] ?? 0;
      const rawHoly = counts[4] ?? 0;
      // Hallow and the evils cancel each other out.
      const holy = Math.max(0, rawHoly - rawEvil - rawBlood);
      const corrupt = rawEvil - rawHoly >= 300;
      const crimson = rawBlood - rawHoly >= 300;
      const hallow = holy >= 125;
      const zone = caves.caveBackX.findIndex((edge) => cx <= edge);
      let style = (caves.caveBackStyles[zone === -1 ? 3 : zone] ?? 0) + 3;
      if (snow > 1500 && cy + VIEW_HALF_ROWS + 75 < world.height - 250) style = 1;
      if (jungle > 140 && (style !== 1 || jungle > snow)) style = 11;
      const top = cy - VIEW_HALF_ROWS;
      if (cy <= oceanLevel && (cx < BEACH_COLUMNS || cx > world.width - BEACH_COLUMNS)) {
        style = corrupt ? 19 : crimson ? 21 : hallow ? 20 : 18;
      } else if (top > rockY + 60 && top < magma - 60) {
        const offset = snow >= 1500 ? 15 : 12;
        if (corrupt) style = offset;
        else if (crimson) style = offset + 1;
        else if (hallow) style = offset + 2;
      }
      if ((counts[5] ?? 0) >= 100) style = 2;
      styles[by * width + bx] = style;
    }
  }
  return { width, height, styles };
}
