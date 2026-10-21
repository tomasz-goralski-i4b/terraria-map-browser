// How tile types draw beside other tiles (docs/assets.md, "Slopes and half blocks") and walls beside other walls
// ("Walls"); the sprite-object tables.
import { terrariaSpriteObjects } from "./terraria-sprite-objects.generated.js";

/** Bits of a tile type's draw flags (the sprite sheet lookup's texel 5, y). */
export const TILE_DRAW_FLAGS = {
  /** Solid, solid on top only included: a half block above it has no edge; a full one beside half blocks is reshaped. */
  solid: 1,
  /** Drawn with the solid tiles: over the sprites behind the blocks. */
  solidLayer: 2,
  platform: 4,
  /** Drawn whole beside half blocks. */
  ignoresHalf: 8,
  /** Solid, but drawn whole beside half blocks. */
  notReallySolid: 16,
  /** Its corner beside a half block is 2 pixels wide, not 4. */
  smoothBorders: 32,
  /** Drawn unsloped whatever its slope. */
  noSlopes: 64,
} as const;

const sets: readonly (readonly [number, readonly number[]])[] = [
  [TILE_DRAW_FLAGS.solid, [...terrariaSpriteObjects.solidBlocks, ...terrariaSpriteObjects.solidTops]],
  [TILE_DRAW_FLAGS.solidLayer, terrariaSpriteObjects.solidLayer],
  [TILE_DRAW_FLAGS.platform, terrariaSpriteObjects.platforms],
  [TILE_DRAW_FLAGS.ignoresHalf, terrariaSpriteObjects.ignoresNearbyHalfBricks],
  [TILE_DRAW_FLAGS.notReallySolid, terrariaSpriteObjects.notReallySolid],
  [TILE_DRAW_FLAGS.smoothBorders, terrariaSpriteObjects.smoothBorders],
  [TILE_DRAW_FLAGS.noSlopes, terrariaSpriteObjects.noSlopes],
];
const flags = new Map<number, number>();
for (const [bit, types] of sets) for (const type of types) flags.set(type, (flags.get(type) ?? 0) | bit);

/** The draw flags (TILE_DRAW_FLAGS) of vanilla tile `id`; 0 for none. */
export function tileDrawFlags(id: number): number {
  return flags.get(id) ?? 0;
}

const wallBlends = new Map<number, number>(terrariaSpriteObjects.wallBlends);

/** The wall vanilla wall `id` counts as where walls meet: walls of different blends are outlined there. */
export function wallBlend(id: number): number {
  return wallBlends.get(id) ?? id;
}
