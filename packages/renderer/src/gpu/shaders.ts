// GLSL for the WebGL2 backend. The colour rules mirror `renderChunk` (../chunk/render.ts) and use integer arithmetic so
// the chunk pass is bit-exact: no tie-breaking can differ because (l*a + c*(255-a)) / 255 never has a .5 fraction.
import { FILTER_SUBTILE } from "../chunk/box-filter.js";
import { BEHIND_FADING, BEHIND_OPACITIES, LIQUID_FALL_REACH, LIQUID_FRONT_ALPHA, SURFACE_SOURCE_Y } from "../chunk/liquid-layout.js";
import { BLOCK_CELL_STRIDE } from "../framing/chunk-cells.js";
import { NO_CELL } from "../framing/frame-block.js";
import { WALL_CELL_STRIDE, WALL_OVERHANG } from "../framing/frame-wall.js";
import { TRACK_CELL_STRIDE, trackShaderConstants } from "../objects/tracks.js";
import { INACTIVE_SPRITE_SHADE } from "../palette/sprite-paint.js";
import { DISCO_COLOR, DISCO_TILES, DISCO_WALLS, DRAW_STAGE, HANGING_VINES, RISING_VINES } from "../objects/draw-offsets.js";
import { TILE_DRAW_FLAGS } from "../objects/tile-draw-flags.js";

/** Tiles of neighbouring chunks stored around each chunk's page layer, so the box filter can cross chunk edges. */
export const PAGE_APRON = 1;

/**
 * Planes of a chunk page, one array layer each per chunk: layer `slot * planes + plane`, where slot is the chunk's
 * place in its page. Each layer is stored transposed (planes are column-major): texel (s, t) = (y, x) of the chunk,
 * offset by the apron. A new plane is one more entry here (and in the renderer's upload table), not a new texture.
 */
export const PLANES_16 = {
  block: 0, wall: 1, flags: 2, frameX: 3, frameY: 4, cell: 5, wallCell: 6, liquidCell: 7, liquidRect: 8, liquidBehind: 9,
} as const;
export const PLANES_8 = { liquid: 0, liquidAmount: 1, paint: 2, wallPaint: 3, shape: 4, glitter: 5 } as const;
export const PLANE_COUNT_16: number = Object.keys(PLANES_16).length;
export const PLANE_COUNT_8: number = Object.keys(PLANES_8).length;

/**
 * Bits of `uPresent`: optional planes the world has. An absent plane reads as 0 and is never uploaded. `cells` is set
 * for a chunk pass that draws framed cells (the cell planes of blocks and walls, computed by the renderer, not read
 * from the world); each instance then says whether its chunk's cells are uploaded (CELLS_INSTANCE_BIT).
 */
export const PRESENT = { flags: 1, frameX: 2, frameY: 4, shape: 8, cells: 16 } as const;

/** Bit of `uLayers` that shows paint (ChunkLayers.paint), above the background, content and wire bits. */
export const PAINT_LAYER_BIT = 512;
/** The CWM `flags` bit of an inactive (actuated) tile. */
export const INACTIVE_FLAG = 32;

/**
 * The depth of the tiles that are not solid, by row (rowDepth): ROW_DEPTH_TOP − row · ROW_DEPTH_SCALE (1 / 8192), as
 * GLSL literals, at least 0.3: a later row lies nearer; rows from 5 325 on share it, between the waterfalls' 0.25 and
 * the empty pixels' 1.
 */
export const ROW_DEPTH_TOP = "0.95";
export const ROW_DEPTH_SCALE = "0.0001220703125";
/**
 * The depth of the stages after the tiles that are not solid (DRAW_STAGE; stageDepth): STAGE_DEPTH_TOP − (stage ·
 * STAGE_ROWS + row) · STAGE_DEPTH_SCALE (1 / 2²⁰), as GLSL literals: nearer than every row, farther than the waterfalls.
 */
export const STAGE_ROWS = 4096;
export const STAGE_DEPTH_TOP = "0.299";
export const STAGE_DEPTH_SCALE = "0.00000095367431640625";

/** Room for the generated special groups (terraria-paint-groups.generated.ts) in the shaders' uniform arrays. */
export const PAINT_GROUP_LIMIT = 15;

/** Paint and the inactive shade on sprites; mirrors spritePaintedColor() and inactiveSpriteColor() (../palette/sprite-paint.ts). */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types -- an interpolated template needs it under isolatedDeclarations
export const spritePaintSource: string = `
// Special groups 1…PAINT_GROUP_LIMIT (PaintGroup): (min hue, max hue, min saturation, max saturation), (hue offset, invert).
uniform vec4 uPaintGroupRanges[${String(PAINT_GROUP_LIMIT)}];
uniform vec2 uPaintGroupModes[${String(PAINT_GROUP_LIMIT)}];

// Whether a pixel takes paints 1–12 under special group group (1-based).
bool inPaintGroup(ivec3 c, int group) {
  vec4 range = uPaintGroupRanges[group - 1];
  vec2 mode = uPaintGroupModes[group - 1];
  float hi = float(max(c.r, max(c.g, c.b)));
  float d = hi - float(min(c.r, min(c.g, c.b)));
  float h = 0.0;
  if (d > 0.0) {
    if (c.r == int(hi)) h = mod(float(c.g - c.b) / d + 6.0, 6.0);
    else if (c.g == int(hi)) h = float(c.b - c.r) / d + 2.0;
    else h = float(c.r - c.g) / d + 4.0;
  }
  h = fract(h / 6.0 + mode.x);
  float s = hi > 0.0 ? d / hi : 0.0;
  bool inside = h >= range.x && h <= range.y && s >= range.z && s <= range.w;
  return mode.y != 0.0 ? !inside : inside;
}

ivec3 spritePainted(ivec3 c, int paint, bool wall, int group) {
  if ((uLayers & ${String(PAINT_LAYER_BIT)}) == 0 || paint == 0) return c;
  if (group != 0 && paint <= 12 && !inPaintGroup(c, group)) return c;
  float hi = float(max(c.r, max(c.g, c.b)));
  float lo = float(min(c.r, min(c.g, c.b)));
  if (paint <= 24) {
    // Hue replaced in HSV; deep paints (13–24) raise the saturation.
    float low = paint > 12 ? 0.4 * lo : lo;
    vec3 k = mod(vec3(5.0, 3.0, 1.0) + float((paint - 1) % 12) / 2.0, 6.0);
    return ivec3(floor(hi - (hi - low) * clamp(min(k, 4.0 - k), 0.0, 1.0) + 0.5));
  }
  float l = (hi + lo) / 2.0;
  if (paint == 25) return ivec3(floor(0.3 * l + 0.5));
  if (paint == 26) return ivec3(floor(min((l + 0.2 * (hi - lo)) * (510.0 - l) / 255.0, 255.0) + 0.5));
  if (paint == 27) return ivec3(floor(l + 0.5));
  if (paint == 28) return ivec3(floor(hi * vec3(1.0, 0.7, 0.49) + 0.5));
  if (paint == 29) return ivec3(floor(0.05 * l + 0.5));
  if (paint == 30 && hi > 0.0) {
    return wall ? ivec3(floor(clamp(2.0 * (255.0 - vec3(c)) - 318.75, 0.0, 255.0) + 0.5)) : 255 - c;
  }
  return c;
}

ivec3 inactiveShade(ivec3 c) {
  return (c * ${String(INACTIVE_SPRITE_SHADE)} + 127) / 255;
}
`;

/**
 * Rules texture: 256 texels per row. Rows 0–255 hold one header per palette index (index % 256, index / 256):
 * (first range, range count, axis 0 frameX / 1 frameY, colour of option 0 as 0xRRGGBB); a count of 0 means no rule.
 * Ranges follow from row RULE_HEADER_ROWS, one texel each: (from, to, colour of its option).
 */
export const RULE_ROW = 256;
export const RULE_HEADER_ROWS = 256;

/**
 * Sprite sheet lookup texture (RGBA32I): six texels per palette index, at (index % 256 × 6 + k, index / 256): the
 * index's tile sheet in k = 0 (atlas page, x, y, state: SPRITE_STATE) and k = 1 (sheet width, height, frame width,
 * frame height), its wall sheet likewise in k = 2 and 3, in k = 4 how its stored frames wrap past the sheet's edge
 * (SPRITE_FRAME_WRAPS: period along x, shift along y, period along y, shift along x; 0 for none), and in k = 5 its
 * paint group, tile draw flags (TILE_DRAW_FLAGS), vanilla type (0 for other content) and wall blend (wallBlend;
 * WALL_BLEND_OTHER + the palette index for other content).
 */
export const SPRITE_SHEET_ROW = 256;
/** The wall blend of content that is not vanilla, plus its palette index: past every vanilla wall. */
export const WALL_BLEND_OTHER = 0x10000;
/**
 * The outline along a side of a wall whose neighbour there has a wall of another blend: a band this wide inside the
 * wall's tile, black at WALL_OUTLINE_ALPHA (of 255), drawn over the wall layer (docs/assets.md, "Walls"; the art of
 * Wall_Outline, measured).
 */
export const WALL_OUTLINE_PIXELS = 2;
export const WALL_OUTLINE_ALPHA = 71;
/** Texels per palette index in the sprite sheet lookup. */
export const SPRITE_SHEET_TEXELS = 6;

/** The state of a palette index in the sprite sheet lookup. */
export const SPRITE_STATE = {
  /** No sprite: the map colour (no atlas, or content sprite mode defers, such as trees). */
  mapColor: 0,
  /** Drawn from its sheet. */
  sheet: 1,
  /** No sheet in the atlas (newer than the install, mod, unknown): the missing-texture checkerboard. */
  missing: 2,
  /** A minecart track: its stored frames name pieces of its sheet (docs/assets.md, "Minecart tracks"). */
  track: 3,
  /**
   * Drawn by the object pass (trees, the giant mushroom: docs/assets.md, "Trees"): the chunk pass shows what lies
   * behind the tile, faded in over its map colour like a sprite.
   */
  object: 4,
} as const;

/** The missing-texture checkerboard: magenta and black squares, 2 × 2 per tile. Generated, not a game asset. */
export const MISSING_SPRITE_COLORS: readonly (readonly [number, number, number])[] = [[255, 0, 255], [0, 0, 0]];

/** Sprite pixels across one tile: a frame's cell is scaled into these. */
export const SPRITE_TILE_PIXELS = 16;

/** Pixels per tile from which sprite mode samples the atlas: below SPRITE_FULL_ZOOM it fades in over the map colour. */
export const SPRITE_MIN_ZOOM = 5;
/** Pixels per tile from which sprites are drawn whole, without the map colour. */
export const SPRITE_FULL_ZOOM = 7.5;
/** At most this many sprite samples per axis and screen pixel. */
const MAX_SPRITE_SAMPLES = 2;

/**
 * How the chunk pass samples sprites at `zoom` pixels per tile: `samples` × `samples` sprite samples per screen pixel,
 * `step` sprite pixels apart in total per axis (the pixel's footprint, 16 / zoom), averaged within the tile, so a sprite
 * shown smaller than its 16 × 16 pixels is downscaled rather than point-sampled; and the sprite's `weight` (0–256)
 * over the map colour, rising linearly from SPRITE_MIN_ZOOM to SPRITE_FULL_ZOOM. Below 16 pixels per tile the samples
 * read `level` 1, the half-resolution atlas (halfAtlasFragmentSource), each texel one art pixel: the game's art is
 * drawn at twice its resolution, 2 × 2 sprite pixels per art pixel. Down to 8 pixels per tile a screen pixel covers at
 * most one art pixel and shows the one under its centre (averaging two sprite pixels instead would mix two art pixels
 * in some tiles and not in others, by how the screen pixels fall on the tile); below, 2 × 2 art pixels are averaged.
 */
export function spriteSampling(zoom: number): {
  readonly samples: number; readonly step: number; readonly level: number; readonly weight: number;
} {
  const step = SPRITE_TILE_PIXELS / zoom;
  const level = step > 1 + 1e-9 ? 1 : 0;
  const samples = step > 2 + 1e-9 ? MAX_SPRITE_SAMPLES : 1;
  const fade = (zoom - SPRITE_MIN_ZOOM) / (SPRITE_FULL_ZOOM - SPRITE_MIN_ZOOM);
  return { samples, step, level, weight: Math.round(256 * Math.min(1, Math.max(0, fade))) };
}


/**
 * Set in an instance's layer attribute when its slot's cell plane holds the chunk's framed cells: a chunk whose cells
 * are not uploaded yet draws its self-framed blocks in map colours. The slot in the page is the low 16 bits.
 */
export const CELLS_INSTANCE_BIT = 0x10000;
/**
 * Set in an instance's layer attribute, with CELLS_INSTANCE_BIT, when its chunk or apron has any framed wall cell: the
 * sprite pass skips the wall layer of chunks without one (sky, open caves), whose walls (if any: not vanilla content)
 * keep their map colours either way.
 */
export const WALLS_INSTANCE_BIT = 0x20000;

/** Vertex attribute locations of the per-chunk instance data, bound before linking. */
export const RECT_ATTRIBUTE = 0;
export const LAYER_ATTRIBUTE = 1;

// Straight-alpha top over below, in integers. Over an opaque pixel it is renderChunk's rounded blend (map mode only ever
// has opaque or empty pixels, so it stays bit-exact); over a partly transparent one (a half-transparent sprite pixel
// with nothing behind it) the general rule, alpha and colour rounded to nearest.
export const overSource = `
ivec4 over(ivec4 top, ivec4 below) {
  if (top.a == 0) return below;
  if (below.a == 0 || top.a == 255) return top;
  if (below.a == 255) return ivec4((2 * (top.rgb * top.a + below.rgb * (255 - top.a)) + 255) / 510, 255);
  int weight = below.a * (255 - top.a);
  int alpha = top.a + (weight + 127) / 255;
  return ivec4((top.rgb * top.a * 255 + below.rgb * weight + alpha * 255 / 2) / (alpha * 255), alpha);
}
`;

// The atlas pixel at (atlas x, y) at of page page, in 0–1, of a sheet whose top-left is at origin: at level 1 the
// half-resolution texel holding it, the mean of its 2 × 2 sprite pixels. A sheet at an odd position (not packed for
// the half-resolution atlas) is read at full resolution. The cells of the shipped layouts start at even pixels of their
// sheets (the atlas tests pin it), so a texel never mixes a cell with its gutter; tile 529's 15-pixel frames at a
// 17-pixel stride are the one exception, where one row blends with its neighbour.
export const atlasTexelSource = `
vec4 atlasTexel(ivec2 origin, ivec2 at, int page) {
  if (uSpriteLevel == 1 && ((origin.x | origin.y) & 1) == 0) {
    return vec4(texelFetch(uAtlasHalf, ivec3(at >> 1, page), 0)) / 255.0;
  }
  return texelFetch(uAtlas, ivec3(at, page), 0);
}
`;

/**
 * Shimmer's colours, as the game shows them at time 0 (docs/assets.md, "Liquids"): its base colour and its glitter's,
 * by tile corner; shared by the chunk pass and the object pass. The disco colour (DISCO_COLOR) tints rainbow content.
 */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types -- an interpolated template needs it under isolatedDeclarations
export const shimmerColorSource: string = `
// Shimmer's colour at tile position at (corners at whole tiles; the game colours a piece's corners and blends between
// them), as the game shows it at time 0: a violet that brightens and darkens along a wave across the world.
vec3 shimmerBase(vec2 at) {
  float wave = sin((at.x + at.y / 6.0) / 10.0 * 6.2831855);
  return mix(vec3(165.0, 130.0, 238.0) / 255.0, vec3(205.0, 205.0, 255.0) / 255.0, 0.1 + wave * 0.4);
}

// One channel of the game's HSL colour at full saturation and half lightness.
float hueChannel(float c) {
  if (c < 0.0) c += 1.0;
  if (c > 1.0) c -= 1.0;
  if (6.0 * c < 1.0) return 6.0 * c;
  if (2.0 * c < 1.0) return 1.0;
  if (3.0 * c < 2.0) return (2.0 / 3.0 - c) * 6.0;
  return 0.0;
}

// The glitter colour at tile corner (x, y) (0–1): a hue running across the world, at opacity glitter (0–1).
vec3 glitterColor(ivec2 corner, float glitter) {
  float hue = fract((float(corner.x) + float(corner.y) / 6.0) / 6.0);
  return round(vec3(hueChannel(hue + 1.0 / 3.0), hueChannel(hue), hueChannel(hue - 1.0 / 3.0)) * 255.0) / 255.0 * glitter;
}

const vec3 DISCO = vec3(${DISCO_COLOR.map((value) => (value / 255).toFixed(6)).join(", ")});
`;

export const header = `#version 300 es
precision highp float;
precision highp int;
`;

// Per instance: the chunk's tile rectangle (origin x, origin y, columns, rows) and its slot in the page.
// eslint-disable-next-line @typescript-eslint/no-inferrable-types -- an interpolated template needs it under isolatedDeclarations
export const instanceInputs: string = `
layout(location = ${String(RECT_ATTRIBUTE)}) in ivec4 aRect;
layout(location = ${String(LAYER_ATTRIBUTE)}) in int aLayer;
flat out ivec4 vRect;
flat out int vLayer;
flat out int vCells;
// Hands the instance's chunk rectangle, page layer and cell bits (CELLS_INSTANCE_BIT, WALLS_INSTANCE_BIT) to the fragment.
void passInstance() {
  vRect = aRect;
  vLayer = aLayer & ${String(CELLS_INSTANCE_BIT - 1)};
  vCells = (aLayer >> 16) & 3;
}
`;

/** Shared by both chunk passes: the colour of one world tile, resolved from its chunk's page layers. */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types -- an interpolated template needs it under isolatedDeclarations
export const tileColorSource: string = `
precision highp usampler2DArray;
precision highp usampler2D;
precision highp isampler2D;
precision highp sampler2DArray;
// Chunk pages, uploaded straight from the world's planes: uPlanes16 holds the 16-bit planes (block, wall, flags,
// frameX, frameY as their 16-bit pattern), uPlanes8 the 8-bit ones (liquid kind, liquid amount, block paint, wall
// paint, block shape). The cell plane of uPlanes16 holds the framed sheet cell of self-framed blocks (column · 64 + row,
// NO_CELL without one), the wall cell plane that of walls, apron included and NO_CELL past the world's edges; both are
// framed by the renderer. A chunk's plane p is layer vLayer * planes + p, holding the chunk and an apron of PAGE_APRON
// tiles of its neighbours, transposed: texel (s, t) = (y in chunk + PAGE_APRON, x in chunk + PAGE_APRON).
uniform usampler2DArray uPlanes16;
uniform usampler2DArray uPlanes8;
uniform int uPresent; // optional planes: bit 0 flags, 1 frameX, 2 frameY, 3 shape, 4 framed cells
// Row r holds palette entries 256r…256r+255: block colours in x 0…255, wall colours in x 256…511.
uniform usampler2D uPalette;
// Background colour of world row y at texel (y % 256, y / 256), resolved on the CPU by backgroundColor();
// row uPaintRow holds the paint colours by paint ID.
uniform usampler2D uBackground;
// Frame → map option rules by palette index, as mapOption() applies them (see RULE_ROW in shaders.ts).
uniform isampler2D uRules;
uniform int uPaintRow;
uniform int uPaintCount; // 0 without a map palette: paint is ignored
uniform int uPaletteLength;
uniform ivec2 uWorldSize; // the world size in tiles
uniform int uLayers; // bit 0 background, 1 walls, 2 blocks, 3 liquids; bits 4–8 the wire mask (ChunkLayers.wires)
#ifndef SPRITES
// Wire overlay colours in priority order (yellow, green, blue, red, actuator) and their flag bits; see WIRE_COLORS.
uniform ivec3 uWireColors[5];
uniform int uWireBits[5];
uniform int uWireAlpha;
#endif
uniform ivec3 uLiquids[4]; // colours of CWM liquid kinds 1–4
#ifdef SPRITES
// Sprite mode (#91), compiled only into the chunk pass's sprite program (chunkSpriteFragmentSource), which draws from
// SPRITE_MIN_ZOOM pixels per tile with an atlas: the atlas pages (RGBA8, straight alpha), their half-resolution copy
// (halfAtlasFragmentSource) and the tile and wall sheets of each palette index (SPRITE_SHEET_ROW).
uniform sampler2DArray uAtlas;
uniform highp usampler2DArray uAtlasHalf;
uniform isampler2D uSpriteSheets;
// spriteSampling(): samples per axis, their footprint in sprite pixels, the atlas level they read, and the sprite's
// weight over the map colour.
uniform int uSpriteSamples;
uniform float uSpriteStep;
uniform int uSpriteLevel;
uniform int uSpriteWeight;
// Per CWM liquid kind 1–4 (docs/assets.md, "Liquids"): its water sheet in entries 0–3, its Liquid sheet in 4–7 and its
// LiquidSlope sheet in 8–11, each (atlas page, x, y, sheet height), height 0 without the sheet (LIQUID_SHEET_IDS).
uniform ivec4 uLiquidSheets[12];
// The shimmer wall's glow sheet (atlas page, x, y, 1; zeros without it), laid out as the wall's sheet.
uniform ivec4 uWallGlow;
// The world's surface level: above it the liquids' back layer hides the sky; below it the background hides that layer.
uniform int uSurfaceY;
// The front layer's opacity by kind, and the steps of a fall's fade (its reach + 1).
const int LIQUID_FRONT_ALPHA[4] = int[4](${LIQUID_FRONT_ALPHA.map(String).join(", ")});
const int LIQUID_FALL_STEPS[4] = int[4](${LIQUID_FALL_REACH.map((reach) => String(reach + 1)).join(", ")});
// The opacity of the liquid behind a block by its code (BEHIND_OPACITY).
const int BEHIND_ALPHA[8] = int[8](${BEHIND_OPACITIES.map((opacity) => String(Math.round(opacity * 255))).join(", ")});
#endif
flat in ivec4 vRect;
flat in int vLayer;
// Bit 0 when this chunk's cell planes hold its framed cells (CELLS_INSTANCE_BIT), bit 1 when they hold any wall cell
// (WALLS_INSTANCE_BIT).
flat in int vCells;

const uint ABSENT = 65535u;

uint plane16(ivec2 texel, int plane) {
  return texelFetch(uPlanes16, ivec3(texel, vLayer * ${String(PLANE_COUNT_16)} + plane), 0).r;
}

uint plane8(ivec2 texel, int plane) {
  return texelFetch(uPlanes8, ivec3(texel, vLayer * ${String(PLANE_COUNT_8)} + plane), 0).r;
}

// A frame plane's value, sign-extended from its 16-bit pattern; 0 when the world has no such plane.
int frame(ivec2 texel, int plane, int present) {
  if ((uPresent & present) == 0) return 0;
  int value = int(plane16(texel, plane));
  return value >= 32768 ? value - 65536 : value;
}

ivec3 unpackColor(int color) {
  return ivec3(color >> 16, (color >> 8) & 255, color & 255);
}

// The block colour of palette entry index: the option its frame selects under the entry's rule, the first range
// holding the frame winning (mapOption), else option 0; entries without a rule keep their palette colour.
ivec3 blockColor(uint index, ivec3 base, ivec2 texel) {
  ivec4 rule = texelFetch(uRules, ivec2(int(index) % ${String(RULE_ROW)}, int(index) / ${String(RULE_ROW)}), 0);
  if (rule.y == 0) return base;
  int value = rule.z == 0
    ? frame(texel, ${String(PLANES_16.frameX)}, ${String(PRESENT.frameX)})
    : frame(texel, ${String(PLANES_16.frameY)}, ${String(PRESENT.frameY)});
  for (int i = 0; i < rule.y; i++) {
    int at = rule.x + i;
    ivec4 range = texelFetch(uRules, ivec2(at % ${String(RULE_ROW)}, ${String(RULE_HEADER_ROWS)} + at / ${String(RULE_ROW)}), 0);
    if (value >= range.x && value <= range.y) return unpackColor(range.z);
  }
  return unpackColor(rule.w);
}

// Mirrors paintedColor() in ../palette/map-palette.ts.
ivec3 painted(ivec3 base, int paint, bool wall) {
  if (paint == 0 || paint >= uPaintCount) return base;
  if (paint == 29) return ivec3(base.b / 34);
  if (paint == 30) return wall ? (255 - base) >> 1 : 255 - base;
  ivec3 tint = ivec3(texelFetch(uBackground, ivec2(paint, uPaintRow), 0).rgb);
  return tint * max(base.r, max(base.g, base.b)) / 255;
}

${overSource}
#ifdef SPRITES
${spritePaintSource}
// The missing-texture checkerboard at sprite pixel sub.
ivec4 missingPixel(ivec2 sub) {
  bool first = ((sub.x / ${String(SPRITE_TILE_PIXELS / 2)} + sub.y / ${String(SPRITE_TILE_PIXELS / 2)}) & 1) == 0;
  return ivec4(first ? ivec3(${MISSING_SPRITE_COLORS[0]?.join(", ") ?? "0"}) : ivec3(${MISSING_SPRITE_COLORS[1]?.join(", ") ?? "0"}), 255);
}

${atlasTexelSource}
// Where the sheets of palette index index start in the sprite sheet lookup: its tile sheet, then (+2) its wall sheet.
ivec2 sheetAt(uint index) {
  return ivec2(int(index) % ${String(SPRITE_SHEET_ROW)} * ${String(SPRITE_SHEET_TEXELS)}, int(index) / ${String(SPRITE_SHEET_ROW)});
}

// Sample (x, y) of uSpriteSamples² spread over the footprint (uSpriteStep sprite pixels) of a screen pixel centred on
// sprite pixel position centre, kept inside the tile: the sprite pixel it reads, at level 1 the even top-left of the
// 2 × 2 sprite pixels around it (one half-resolution texel).
ivec2 samplePixel(vec2 centre, int x, int y) {
  vec2 at = centre + ((vec2(x, y) + 0.5) / float(uSpriteSamples) - 0.5) * uSpriteStep;
  ivec2 sub = clamp(ivec2(floor(at)), ivec2(0), ivec2(${String(SPRITE_TILE_PIXELS - 1)}));
  return uSpriteLevel == 1 ? sub & ivec2(~1) : sub;
}

// Draw flags of a palette index's tile (TILE_DRAW_FLAGS), from the sprite sheet lookup.
int tileFlags(uint index) {
  return index == ABSENT ? 0 : texelFetch(uSpriteSheets, sheetAt(index) + ivec2(5, 0), 0).y;
}

// The shape plane at texel (0 without the plane).
int shapeAt(ivec2 texel) {
  return (uPresent & ${String(PRESENT.shape)}) != 0 ? int(plane8(texel, ${String(PLANES_8.shape)})) : 0;
}

// The sheet pixel a block of palette index index at texel shows at sprite pixel sub, its cell's top-left at origin on
// the sheet (shapedPixel in ../framing/chunk-cells.ts): a slope as eight 2-pixel columns of
// the cell slid along it and a 2-row strip of the cell in place, over them; a half block as the cell's upper half in
// the tile's lower half, ending in the sheet's half-block edge (x 144, y 66) without a solid block under it; a full solid
// block beside half blocks with the top half of its side or sides from the sheet's half-block corners. (-1, -1) where
// the shape cuts the tile away.
ivec2 shapedPixel(uint index, ivec2 texel, ivec2 origin, ivec2 sub) {
  int flags = tileFlags(index);
  int shape = shapeAt(texel);
  if (shape >= 2 && (flags & ${String(TILE_DRAW_FLAGS.noSlopes)}) != 0) shape = 0;
  int column = sub.x >> 1;
  if (shape == 1) {
    if (sub.y < 8) return ivec2(-1);
    uint below = plane16(texel + ivec2(1, 0), ${String(PLANES_16.block)});
    bool edge = (flags & ${String(TILE_DRAW_FLAGS.platform)}) == 0
      && (below == ABSENT || (tileFlags(below) & ${String(TILE_DRAW_FLAGS.solid)}) == 0 || shapeAt(texel + ivec2(1, 0)) == 1);
    return edge && sub.y >= 12 ? ivec2(144 + sub.x, 66 + sub.y - 12) : origin + sub - ivec2(0, 8);
  }
  if (shape >= 2 && shape <= 5 && (flags & ${String(TILE_DRAW_FLAGS.platform)}) == 0) {
    if (shape <= 3) {
      if (sub.y >= 14) return origin + sub;
      int down = shape == 2 ? 2 * column : 14 - 2 * column;
      return sub.y < down ? ivec2(-1) : origin + sub - ivec2(0, down);
    }
    if (sub.y < 2) return origin + sub;
    int up = shape == 4 ? 2 * column : 14 - 2 * column;
    return sub.y >= 16 - up ? ivec2(-1) : origin + sub + ivec2(0, up);
  }
  if (shape == 0 && sub.y < 8 && (flags & (${String(TILE_DRAW_FLAGS.solid)} | ${String(TILE_DRAW_FLAGS.platform)} | ${String(TILE_DRAW_FLAGS.ignoresHalf)} | ${String(TILE_DRAW_FLAGS.notReallySolid)})) == ${String(TILE_DRAW_FLAGS.solid)}) {
    bool left = shapeAt(texel - ivec2(0, 1)) == 1, right = shapeAt(texel + ivec2(0, 1)) == 1;
    if (left && right) {
      ivec2 above = texel - ivec2(1, 0);
      uint aboveIndex = plane16(above, ${String(PLANES_16.block)});
      int aboveShape = shapeAt(above);
      bool joined = aboveIndex == index && aboveShape != 4 && aboveShape != 5;
      return ivec2(joined ? 90 : 126, 0) + sub;
    }
    int corner = (flags & ${String(TILE_DRAW_FLAGS.smoothBorders)}) != 0 ? 2 : 4;
    if (left && sub.x < corner) return ivec2(corner == 2 && sub.y < 2 ? 148 : 144, 0) + sub;
    if (right && sub.x >= 16 - corner) return ivec2(corner == 2 && sub.y < 2 && sub.x >= 14 ? 142 : 144, 0) + sub;
  }
  return origin + sub;
}

// The atlas pixel of a self-framed block at sprite pixel sub: its framed cell (the cell plane) drawn by its shape
// (shapedPixel); transparent where the shape cuts it away. False without framed cells or a cell (a falling block with
// nothing below it, or not self-framed), for content sprite mode leaves in map colours, or past the sheet's edge.
bool cellPixel(uint index, ivec4 place, ivec2 at, ivec2 texel, ivec2 sub, out ivec4 color) {
  if ((uPresent & ${String(PRESENT.cells)}) == 0 || (vCells & 1) == 0) return false;
  uint cell = plane16(texel, ${String(PLANES_16.cell)});
  if (cell == ${String(NO_CELL)}u || place.w == ${String(SPRITE_STATE.mapColor)}) return false;
  if (place.w == ${String(SPRITE_STATE.missing)}) {
    color = missingPixel(sub);
    return true;
  }
  ivec2 pixel = shapedPixel(index, texel, ivec2(int(cell >> 6u), int(cell & 63u)) * ${String(BLOCK_CELL_STRIDE)}, sub);
  if (pixel.x < 0) {
    color = ivec4(0);
    return true;
  }
  ivec4 size = texelFetch(uSpriteSheets, at + ivec2(1, 0), 0);
  if (any(greaterThanEqual(pixel, size.xy))) return false;
  color = ivec4(round(atlasTexel(place.yz, place.yz + pixel, place.x) * 255.0));
  return true;
}

${trackShaderConstants()}
// The pixel of Tiles_314 cell code (column | row << 4) at sprite pixel sub, of the sheet placed at place.
ivec4 trackCellPixel(ivec4 place, int code, ivec2 sub) {
  ivec2 pixel = ivec2(code & 15, (code >> 4) & 15) * ${String(TRACK_CELL_STRIDE)} + sub;
  return ivec4(round(atlasTexel(place.yz, place.yz + pixel, place.x) * 255.0));
}

// A minecart track at sprite pixel sub: its back piece (frameY, a junction's other branch) with its front piece
// (frameX) over it. False for a front value that names no piece: the map colour.
bool trackPixel(ivec4 place, ivec2 texel, ivec2 sub, out ivec4 color) {
  int front = frame(texel, ${String(PLANES_16.frameX)}, ${String(PRESENT.frameX)});
  int back = frame(texel, ${String(PLANES_16.frameY)}, ${String(PRESENT.frameY)});
  if (front < 0 || front >= TRACK_PIECE_COUNT) return false;
  color = ivec4(0);
  if (back >= 0 && back < TRACK_PIECE_COUNT) color = trackCellPixel(place, TRACK_PIECES[back], sub);
  color = over(trackCellPixel(place, TRACK_PIECES[front], sub), color);
  return true;
}

// 1 for a hanging vine, 2 for a rising one, 0 for other content (HANGING_VINES, RISING_VINES).
int vineKind(uint index) {
  if (index == ABSENT) return 0;
  int id = texelFetch(uSpriteSheets, sheetAt(index) + ivec2(5, 0), 0).z;
  if (${HANGING_VINES.map((id) => `id == ${String(id)}`).join(" || ")}) return 1;
  return ${RISING_VINES.map((id) => `id == ${String(id)}`).join(" || ")} ? 2 : 0;
}

// The vine the game draws into the tile at texel from the strip it holds (a hanging vine's top 2 rows above its root,
// a rising vine's bottom 2 rows below its root), at sprite pixel sub; transparent elsewhere. Lies under the tile's own
// sprite.
ivec4 vineInto(ivec2 texel, ivec2 sub) {
  int dy = sub.y >= ${String(SPRITE_TILE_PIXELS - 2)} ? 1 : sub.y < 2 ? -1 : 0;
  // The cells of the tiles past the chunk's top and bottom rows are not uploaded (see spritePixel).
  if (dy == 0 || (dy < 0 ? texel.x == ${String(PAGE_APRON)} : texel.x == ${String(PAGE_APRON)} + vRect.w - 1)) return ivec4(0);
  ivec2 next = texel + ivec2(dy, 0);
  uint index = plane16(next, ${String(PLANES_16.block)});
  if (vineKind(index) != (dy > 0 ? 1 : 2)) return ivec4(0);
  ivec2 at = sheetAt(index);
  ivec4 color;
  if (!cellPixel(index, texelFetch(uSpriteSheets, at, 0), at, next, sub - ivec2(0, dy * (${String(SPRITE_TILE_PIXELS - 2)})), color)) return ivec4(0);
  return color;
}

// The atlas pixel of a block at sprite pixel sub (0–15 per axis) of its tile. A stored frame selects its cell, scaled
// into the tile, or the missing-texture checkerboard for content without a sheet; a block without one (frames of -1)
// shows its framed cell (cellPixel). False for content sprite mode leaves in map colours, or past the sheet's edge.
bool spritePixel(uint index, ivec2 texel, ivec2 sub, out ivec4 color) {
  ivec2 at = sheetAt(index);
  ivec4 place = texelFetch(uSpriteSheets, at, 0);
  if (place.w == ${String(SPRITE_STATE.track)}) return trackPixel(place, texel, sub, color);
  int vine = vineKind(index);
  ivec2 stored = ivec2(-1);
  if (vine != 0) {
    // A vine (docs/assets.md, "Draw order"): the game draws hanging vines 2 pixels up and rising ones 2 pixels down, so
    // a vine's tile shows the next vine of its strip past its own rows, and nothing past the strip's end. Its framed
    // cell is read by the one cellPixel call below (each call site is inlined whole: compile time).
    sub.y += vine == 1 ? 2 : -2;
    if (sub.y >= ${String(SPRITE_TILE_PIXELS)} || sub.y < 0) {
      int dy = sub.y < 0 ? -1 : 1;
      sub.y -= dy * ${String(SPRITE_TILE_PIXELS)};
      ivec2 next = texel + ivec2(dy, 0);
      uint nextIndex = plane16(next, ${String(PLANES_16.block)});
      if (vineKind(nextIndex) != vine) {
        color = ivec4(0);
        return true;
      }
      // shortcut: block cells are uploaded without the apron, so at the chunk's top or bottom row the next vine's rows
      // come from this tile's own cell; upload the cell apron to draw them exactly.
      bool edge = dy < 0 ? texel.x == ${String(PAGE_APRON)} : texel.x == ${String(PAGE_APRON)} + vRect.w - 1;
      if (!edge) {
        texel = next;
        index = nextIndex;
        at = sheetAt(index);
        place = texelFetch(uSpriteSheets, at, 0);
      }
    }
  } else {
    if (place.w == ${String(SPRITE_STATE.object)}) {
      color = ivec4(0);
      return true;
    }
    bool frames = (uPresent & ${String(PRESENT.frameX | PRESENT.frameY)}) == ${String(PRESENT.frameX | PRESENT.frameY)};
    if (frames) {
      stored = ivec2(frame(texel, ${String(PLANES_16.frameX)}, ${String(PRESENT.frameX)}), frame(texel, ${String(PLANES_16.frameY)}, ${String(PRESENT.frameY)}));
    }
  }
  if (stored.x < 0 || stored.y < 0) return cellPixel(index, place, at, texel, sub, color);
  // Styles past the sheet's edge continue in its next block (wrappedFrame in frame-wrap.ts).
  ivec4 wrap = texelFetch(uSpriteSheets, at + ivec2(4, 0), 0);
  if (wrap.x > 0) {
    int block = stored.x / wrap.x;
    stored += ivec2(-block * wrap.x, block * wrap.y);
  }
  if (wrap.z > 0) {
    int block = stored.y / wrap.z;
    stored += ivec2(block * wrap.w, -block * wrap.z);
  }
  if (place.w == ${String(SPRITE_STATE.mapColor)}) return false;
  if (place.w == ${String(SPRITE_STATE.missing)}) {
    color = missingPixel(sub);
    return true;
  }
  ivec4 size = texelFetch(uSpriteSheets, at + ivec2(1, 0), 0);
  // A stored frame of a 16 × 16 cell takes the tile's shape as a framed cell does; larger frames are scaled in whole.
  ivec2 pixel = size.zw == ivec2(${String(SPRITE_TILE_PIXELS)}) ? shapedPixel(index, texel, stored, sub) : stored + sub * size.zw / ${String(SPRITE_TILE_PIXELS)};
  if (pixel.x < 0) {
    color = ivec4(0);
    return true;
  }
  if (any(greaterThanEqual(pixel, size.xy))) return false;
  color = ivec4(round(atlasTexel(place.yz, place.yz + pixel, place.x) * 255.0));
  return true;
}

// The sprite of a block over the footprint of a screen pixel centred on sprite pixel position centre (0–16 per axis,
// relative to the tile): the straight-alpha mean of uSpriteSamples² sprite pixels evenly spread over uSpriteStep sprite
// pixels, kept inside the tile. One sample (16 pixels per tile and above) is spritePixel at the centre.
bool spriteSample(uint index, ivec2 texel, vec2 centre, out ivec4 color) {
  int count = uSpriteSamples;
  ivec4 sum = ivec4(0);
  // Runtime bounds (at most MAX_SPRITE_SAMPLES) and one call: the driver inlines spritePixel once, not per sample (compile
  // time). One sample is its own mean here too (fully transparent ones are zero).
  for (int y = 0; y < count; y++) {
    for (int x = 0; x < count; x++) {
      ivec4 sampled;
      if (!spritePixel(index, texel, samplePixel(centre, x, y), sampled)) return false;
      sum += ivec4(sampled.rgb * sampled.a, sampled.a);
    }
  }
  int samples = count * count;
  color = sum.a == 0
    ? ivec4(0)
    : ivec4((2 * sum.rgb + sum.a) / (2 * sum.a), (2 * sum.a + samples) / (2 * samples));
  return true;
}

${shimmerColorSource}
// A shimmer piece's grey art at position uv (0–1) across its piece in tile tile, coloured by the base colour of the
// tile's corners.
ivec3 shimmerTint(ivec3 grey, ivec2 tile, vec2 uv) {
  vec2 t = vec2(tile);
  vec3 top = mix(shimmerBase(t), shimmerBase(t + vec2(1.0, 0.0)), uv.x);
  vec3 bottom = mix(shimmerBase(t + vec2(0.0, 1.0)), shimmerBase(t + vec2(1.0, 1.0)), uv.x);
  vec3 tint = clamp(mix(top, bottom, uv.y), 0.0, 1.0);
  return ivec3(round(vec3(grey) * tint));
}

// The art (straight alpha, 0–255) of the tile's liquid piece at sprite pixel p: cell and rect as liquidLayout
// (../chunk/liquid-layout.ts) packs them, kind 1–4 with its water sheet in the atlas. Transparent outside the piece.
ivec4 liquidPieceArt(uint cell, uint rect, int kind, ivec2 p, ivec2 tile) {
  ivec2 offset = ivec2(int(rect >> 12u) & 15, int(rect >> 8u) & 15);
  ivec2 size = ivec2(int(rect >> 4u) & 15, int(rect) & 15) + 1;
  ivec2 d = p - offset;
  if (any(lessThan(d, ivec2(0))) || any(greaterThanEqual(d, size))) return ivec4(0);
  int sourceY = int(cell) & 63;
  // The surface band lies below the 16 animation frames of 80 rows.
  ivec2 source = ivec2(int(cell >> 6u) & 63, sourceY == ${String(SURFACE_SOURCE_Y)} ? 1280 : sourceY) + d;
  ivec4 sheet = uLiquidSheets[kind - 1];
  ivec4 art = ivec4(round(atlasTexel(sheet.yz, sheet.yz + source, sheet.x) * 255.0));
  if (kind == 4) art.rgb = shimmerTint(art.rgb, tile, (vec2(d) + 0.5) / vec2(size));
  return art.a == 0 ? ivec4(0) : art;
}

// The art of the liquid behind the block at sprite pixel p (behind as liquidLayout packs it), its alpha faded in from
// its top where it fades, without its opacity: from the Liquid sheet, for a slope from its piece of the LiquidSlope
// sheet (the game's back layer draws the Liquid sheet's rectangle there, which the slope piece's triangle mostly
// covers where the block's sprite is cut away). Rows past the sheet's bottom repeat its last.
ivec4 behindArt(uint behind, int shape, ivec2 p, ivec2 tile) {
  int bits = int(behind);
  int mode = bits & 7;
  if (mode == 0) return ivec4(0);
  int step = 2 * ((bits >> 3) & 7);
  ivec4 dest = mode == 1 ? ivec4(0, 0, 16, 16) : mode == 2 ? ivec4(0, 0, 16, 4) : mode == 3 ? ivec4(0, 0, 16, 12)
    : mode == 4 ? ivec4(0, 12, 16, 4) : ivec4(mode == 7 ? 12 : 0, step, mode == 5 ? 16 : 4, 16 - step);
  ivec2 d = p - dest.xy;
  if (any(lessThan(d, ivec2(0))) || any(greaterThanEqual(d, dest.zw))) return ivec4(0);
  int kind = ((bits >> 10) & 3) + 1;
  bool slope = shape >= 2;
  ivec4 sheet = uLiquidSheets[kind + (slope ? 7 : 3)];
  if (sheet.w == 0) return ivec4(0);
  // A slope's piece lies in the tile row for row; the Liquid sheet starts at its top row or 4 rows down.
  int sourceY = slope ? dest.y : mode <= 4 ? 4 : (bits & 64) != 0 ? 0 : 4;
  ivec2 source = ivec2(d.x + (slope ? 18 * (shape - 2) : 0), min(sourceY + d.y, sheet.w - 1));
  ivec4 art = ivec4(round(atlasTexel(sheet.yz, sheet.yz + source, sheet.x) * 255.0));
  // Open to the sky at its top, a slope shows the Liquid sheet's surface rows inside its piece's outline, as the liquid
  // beside it does (the slope sheet has none).
  ivec4 plain = uLiquidSheets[kind + 3];
  if (slope && (bits & 64) != 0 && art.a != 0 && plain.w != 0) {
    art.rgb = ivec3(round(atlasTexel(plain.yz, plain.yz + ivec2(d.x, min(d.y, plain.w - 1)), plain.x).rgb * 255.0));
  }
  if (kind == 4) art.rgb = shimmerTint(art.rgb, tile, (vec2(d) + 0.5) / vec2(dest.zw));
  int code = (bits >> 7) & 7;
  if (code == ${String(BEHIND_FADING[0])} || code == ${String(BEHIND_FADING[1])}) art.a = art.a * (2 * d.y + 1) / (2 * dest.w);
  return art.a == 0 ? ivec4(0) : art;
}

// The glitter the game adds over a shimmer piece (docs/assets.md, "Liquids"), at sprite pixel p of tile tile (texel
// in the page), as colour (0–255) to add before the piece's fade: the piece's twin among the sheet's sparkle columns
// (48 to the right), in a frame its position picks, lit by the corners' glitter colours blended across the piece; on
// edge and surface pieces at 0.5, on body pieces where x + y is even at the glitter plane's opacity, elsewhere none.
vec3 shimmerGlitter(ivec2 texel, uint cell, uint rect, ivec2 p, ivec2 tile) {
  ivec2 offset = ivec2(int(rect >> 12u) & 15, int(rect >> 8u) & 15);
  ivec2 size = ivec2(int(rect >> 4u) & 15, int(rect) & 15) + 1;
  ivec2 d = p - offset;
  if (any(lessThan(d, ivec2(0))) || any(greaterThanEqual(d, size))) return vec3(0.0);
  ivec2 source = ivec2(int(cell >> 6u) & 63, int(cell) & 63);
  // A surface piece is a top piece of the grid's first row.
  if (source.y == ${String(SURFACE_SOURCE_Y)}) source.y = 0;
  bool top = source != ivec2(16, 48);
  if (!top && ((tile.x + tile.y) & 1) != 0) return vec3(0.0);
  vec2 at = vec2(tile) + 0.5;
  float wave = (at.x + at.y / 6.0) / 10.0 + (top ? 0.0 : at.x + at.y);
  int frame = (int(wave) % 16 + 16) % 16;
  ivec4 sheet = uLiquidSheets[3];
  vec4 art = atlasTexel(sheet.yz, sheet.yz + source + ivec2(48, 80 * frame) + d, sheet.x);
  vec2 uv = (vec2(d) + 0.5) / vec2(size);
  vec3 corners[4];
  for (int k = 0; k < 4; k++) {
    ivec2 corner = ivec2(k & 1, k >> 1);
    float glitter = top ? 0.5 : float(plane8(texel + corner.yx, ${String(PLANES_8.glitter)})) / 255.0;
    corners[k] = glitterColor(tile + corner, glitter);
  }
  vec3 light = mix(mix(corners[0], corners[1], uv.x), mix(corners[2], corners[3], uv.x), uv.y);
  return art.rgb * art.a * light * 255.0;
}

// The liquid layers of the tile at texel (world tile tile) at the sprite pixel under position centre, without their
// opacities: piece, the tile's liquid piece (kind 0: none); behind, the liquid behind its block (a slope's from the
// LiquidSlope sheet); glitter, shimmer's glitter to add over its piece (shimmerGlitter). One sample, also where blocks
// average several: liquid art is mostly flat, and the shader compilers of some drivers are slow on every further loop.
void liquidSamples(ivec2 texel, ivec2 tile, vec2 centre, int kind, int shape, out ivec4 piece, out ivec4 behind, out vec3 glitter) {
  ivec2 p = samplePixel(centre, 0, 0);
  uint cell = plane16(texel, ${String(PLANES_16.liquidCell)});
  uint rect = plane16(texel, ${String(PLANES_16.liquidRect)});
  piece = kind != 0 ? liquidPieceArt(cell, rect, kind, p, tile) : ivec4(0);
  glitter = kind == 4 ? shimmerGlitter(texel, cell, rect, p, tile) : vec3(0.0);
  behind = behindArt(plane16(texel, ${String(PLANES_16.liquidBehind)}), shape, p, tile);
}

// Colour c (straight alpha) with glitter folded into its colour, so that drawing it over anything adds the glitter too
// (up to where its colour saturates).
ivec4 withGlitter(ivec4 c, vec3 glitter) {
  if (c.a == 0 || glitter == vec3(0.0)) return c;
  return ivec4(min(vec3(255.0), vec3(c.rgb) + glitter * 255.0 / float(c.a)), c.a);
}

// Straight-alpha colour c with its alpha scaled by a / 255, rounded.
ivec4 withOpacity(ivec4 c, int a) {
  return ivec4(c.rgb, (c.a * a + 127) / 255);
}

// The walls of the 3 × 3 tiles around the tile being drawn, looked up once per screen pixel by wallSample. Plain
// variables rather than an array: an array indexed by a computed index is slow on some GPUs. Per wall, A = (atlas x,
// atlas y of its cell's top-left, atlas page, kind) and B = the end of its sheet in the atlas. Kind: WALL_NONE (no
// wall, or not reached by the samples), WALL_SHEET, WALL_MAPPED (its map colour on its own tile: not vanilla
// content), WALL_MISSING (no sheet: the checkerboard on its own tile).
const int WALL_NONE = 0;
const int WALL_SHEET = 1;
const int WALL_MAPPED = 2;
const int WALL_MISSING = 3;
ivec4 wallNWA;
ivec4 wallNWB;
ivec4 wallNA;
ivec4 wallNB;
ivec4 wallNEA;
ivec4 wallNEB;
ivec4 wallWA;
ivec4 wallWB;
ivec4 wallCA;
ivec4 wallCB;
ivec4 wallEA;
ivec4 wallEB;
ivec4 wallSWA;
ivec4 wallSWB;
ivec4 wallSA;
ivec4 wallSB;
ivec4 wallSEA;
ivec4 wallSEB;
// B = (the end of its sheet in the atlas, its wall paint, its drawing order: wallOrder).
// The map colour of the tile's own wall, premultiplied (zero without one).
vec4 wallOwn;

// The order the game draws overlapping walls in: those without a block in front of them first, then by wall paint,
// then by wall type (0 when not vanilla content); wallSample breaks ties row by row.
int wallOrder(ivec2 texel, uint wall, int paint) {
  int fronted = plane16(texel, ${String(PLANES_16.block)}) == ABSENT ? 0 : 1;
  return (fronted << 21) | (paint << 16) | texelFetch(uSpriteSheets, sheetAt(wall) + ivec2(5, 0), 0).z;
}

// The blend of the wall at texel (WALL_BLEND_OTHER and up for content that is not vanilla), −1 without one or past
// the world's edges.
int wallBlendAt(ivec2 texel) {
  ivec2 tile = vRect.xy + texel.yx - ${String(PAGE_APRON)};
  if (any(lessThan(tile, ivec2(0))) || any(greaterThanEqual(tile, uWorldSize))) return -1;
  uint wall = plane16(texel, ${String(PLANES_16.wall)});
  return wall == ABSENT ? -1 : texelFetch(uSpriteSheets, sheetAt(wall) + ivec2(5, 0), 0).w;
}

void loadWall(ivec2 texel, bool own, out ivec4 a, out ivec4 b) {
  a = ivec4(0);
  b = ivec4(0);
  uint cell = plane16(texel, ${String(PLANES_16.wallCell)});
  uint wall = plane16(texel, ${String(PLANES_16.wall)});
  int paint = int(plane8(texel, ${String(PLANES_8.wallPaint)}));
  if (cell == ${String(NO_CELL)}u) {
    if (own && wallOwn.a > 0.0) {
      a.w = WALL_MAPPED;
      b.w = wall == ABSENT ? 0 : wallOrder(texel, wall, paint);
    }
    return;
  }
  ivec2 sheet = sheetAt(wall) + ivec2(2, 0);
  ivec4 place = texelFetch(uSpriteSheets, sheet, 0);
  b.w = wallOrder(texel, wall, paint);
  if (place.w == ${String(SPRITE_STATE.sheet)}) {
    a = ivec4(place.yz + ivec2(int(cell >> 6u), int(cell & 63u)) * ${String(WALL_CELL_STRIDE)}, place.x, WALL_SHEET);
    // The starry glass walls (242, 243) twinkle through 8 frames of 180 rows, each tile from a frame its position picks:
    // the still frame shows ((11x + 27y) mod 160) div 20 (docs/assets.md, "Walls").
    int type = texelFetch(uSpriteSheets, sheetAt(wall) + ivec2(5, 0), 0).z;
    if (type == 242 || type == 243) {
      ivec2 tile = vRect.xy + texel.yx - ${String(PAGE_APRON)};
      a.y += 180 * ((11 * tile.x + 27 * tile.y) % 160 / 20);
    }
    b.xyz = ivec3(place.yz + texelFetch(uSpriteSheets, sheet + ivec2(1, 0), 0).xy, paint);
  } else if (own) {
    a.w = place.w == ${String(SPRITE_STATE.missing)} ? WALL_MISSING : WALL_MAPPED;
  }
}

ivec4 wallA(int dx, int dy) {
  if (dy < 0) return dx < 0 ? wallNWA : dx == 0 ? wallNA : wallNEA;
  if (dy == 0) return dx < 0 ? wallWA : dx == 0 ? wallCA : wallEA;
  return dx < 0 ? wallSWA : dx == 0 ? wallSA : wallSEA;
}

ivec4 wallB(int dx, int dy) {
  if (dy < 0) return dx < 0 ? wallNWB : dx == 0 ? wallNB : wallNEB;
  if (dy == 0) return dx < 0 ? wallWB : dx == 0 ? wallCB : wallEB;
  return dx < 0 ? wallSWB : dx == 0 ? wallSB : wallSEB;
}

// Stores the wall at (dx, dy) loaded by wallSample into its variable.
void storeWall(int dx, int dy, ivec4 a, ivec4 b) {
  if (dx == -1 && dy == -1) { wallNWA = a; wallNWB = b; }
  else if (dx == 0 && dy == -1) { wallNA = a; wallNB = b; }
  else if (dx == 1 && dy == -1) { wallNEA = a; wallNEB = b; }
  else if (dx == -1 && dy == 0) { wallWA = a; wallWB = b; }
  else if (dx == 0 && dy == 0) { wallCA = a; wallCB = b; }
  else if (dx == 1 && dy == 0) { wallEA = a; wallEB = b; }
  else if (dx == -1 && dy == 1) { wallSWA = a; wallSWB = b; }
  else if (dx == 0 && dy == 1) { wallSA = a; wallSB = b; }
  else if (dx == 1 && dy == 1) { wallSEA = a; wallSEB = b; }
}

// The page texel and world tile of the tile wallSample draws (shimmer's wall glow reads the walls around it).
ivec2 wallTexel;
ivec2 wallTile;

// The glow the game adds over the shimmer wall (347) at pixel cellPixel of its cell, at (dx, dy) from the tile drawn
// (premultiplied colour, 0–1): its glow sheet's same pixel in shimmer's glitter colours at 0.5 · 0.7, blended between
// the wall's tile corners across its 32 × 32 cell.
vec3 shimmerWallGlow(int dx, int dy, ivec2 cellPixel) {
  uint cell = plane16(wallTexel + ivec2(dy, dx), ${String(PLANES_16.wallCell)});
  ivec2 at = ivec2(int(cell >> 6u), int(cell & 63u)) * ${String(WALL_CELL_STRIDE)} + cellPixel;
  vec4 glow = atlasTexel(uWallGlow.yz, uWallGlow.yz + at, uWallGlow.x);
  ivec2 tile = wallTile + ivec2(dx, dy);
  vec2 uv = (vec2(cellPixel) + 0.5) / ${String(WALL_CELL_STRIDE - 4)}.0;
  vec3 top = mix(glitterColor(tile, 0.35), glitterColor(tile + ivec2(1, 0), 0.35), uv.x);
  vec3 bottom = mix(glitterColor(tile + ivec2(0, 1), 0.35), glitterColor(tile + ivec2(1, 1), 0.35), uv.x);
  return glow.rgb * glow.a * mix(top, bottom, uv.y);
}

// The wall at (dx, dy) from the tile drawn over below (premultiplied) at sprite pixel sub of the tile, which its cell
// covers: the cell's top-left lies WALL_OVERHANG pixels up and left of its own tile's.
vec4 drawWall(vec4 below, int dx, int dy, ivec2 sub) {
  ivec4 a = wallA(dx, dy);
  if (a.w == WALL_NONE) return below;
  vec4 top;
  if (a.w == WALL_SHEET) {
    ivec2 pixel = a.xy + sub + ${String(WALL_OVERHANG)} - ${String(SPRITE_TILE_PIXELS)} * ivec2(dx, dy);
    ivec4 b = wallB(dx, dy);
    if (any(greaterThanEqual(pixel, b.xy))) return below;
    vec4 sampled = atlasTexel(a.xy, pixel, a.z);
    if (b.z != 0) sampled.rgb = vec3(spritePainted(ivec3(round(sampled.rgb * 255.0)), b.z, true, 0)) / 255.0;
    // The rainbow walls are tinted by the disco colour (DISCO_WALLS); b.w's low bits are the wall's type (wallOrder).
    int type = b.w & 65535;
    if (${DISCO_WALLS.map((id) => `type == ${String(id)}`).join(" || ")}) sampled.rgb *= DISCO;
    top = vec4(sampled.rgb * sampled.a, sampled.a);
    if (type == 347 && uWallGlow.w != 0) {
      vec4 layered = top + below * (1.0 - top.a);
      layered.rgb = min(layered.rgb + shimmerWallGlow(dx, dy, sub + ${String(WALL_OVERHANG)} - ${String(SPRITE_TILE_PIXELS)} * ivec2(dx, dy)), vec3(layered.a));
      return layered;
    }
  } else {
    top = a.w == WALL_MISSING ? vec4(vec3(missingPixel(sub).rgb) / 255.0, 1.0) : wallOwn;
  }
  return top + below * (1.0 - top.a);
}

// The wall layer over the footprint of a screen pixel centred on sprite pixel position centre (0–16 per axis) of the
// tile at texel, straight alpha: per sample, the 32 × 32 cells (the wall cell plane) of the tile's wall and of the
// three neighbours whose ${String(WALL_OVERHANG)}-pixel overhang reaches it, drawn row by row from the top and left to right
// within a row, each over the ones before; then the mean of the samples. A wall without a cell (not vanilla content)
// shows ownMapped, its map colour, on its own tile; a wall without a sheet the missing-texture checkerboard there.
// Only the walls the samples can reach are looked up, once (texel is transposed: (y, x)); samples composite in
// premultiplied floats, which needs no division, within one unit of exact integer compositing.
ivec4 wallSample(ivec2 texel, vec2 centre, ivec4 ownMapped) {
  int count = uSpriteSamples;
  wallTexel = texel;
  wallTile = vRect.xy + texel.yx - ${String(PAGE_APRON)};
  wallOwn = ownMapped.a == 0 ? vec4(0.0) : vec4(vec3(ownMapped.rgb) / 255.0, 1.0);
  // The outermost samples lie this far from the centre; the margin only widens the walls looked up.
  vec2 reach = vec2(0.5 * uSpriteStep * (1.0 - 1.0 / float(count)) + 0.01);
  ivec2 low = clamp(ivec2(floor(centre - reach)), ivec2(0), ivec2(${String(SPRITE_TILE_PIXELS - 1)}));
  ivec2 high = clamp(ivec2(floor(centre + reach)), ivec2(0), ivec2(${String(SPRITE_TILE_PIXELS - 1)}));
  bool west = low.x < ${String(SPRITE_TILE_PIXELS / 2)};
  bool east = high.x >= ${String(SPRITE_TILE_PIXELS / 2)};
  bool north = low.y < ${String(SPRITE_TILE_PIXELS / 2)};
  bool south = high.y >= ${String(SPRITE_TILE_PIXELS / 2)};
  wallNWA = ivec4(0);
  wallNWB = ivec4(0);
  wallNA = ivec4(0);
  wallNB = ivec4(0);
  wallNEA = ivec4(0);
  wallNEB = ivec4(0);
  wallWA = ivec4(0);
  wallWB = ivec4(0);
  wallCA = ivec4(0);
  wallCB = ivec4(0);
  wallEA = ivec4(0);
  wallEB = ivec4(0);
  wallSWA = ivec4(0);
  wallSWB = ivec4(0);
  wallSA = ivec4(0);
  wallSB = ivec4(0);
  wallSEA = ivec4(0);
  wallSEB = ivec4(0);
  // Runtime bounds: one copy of loadWall, not one per neighbour.
  for (int dy = north ? -1 : 0; dy <= (south ? 1 : 0); dy++) {
    for (int dx = west ? -1 : 0; dx <= (east ? 1 : 0); dx++) {
      ivec4 a;
      ivec4 b;
      loadWall(texel + ivec2(dy, dx), dx == 0 && dy == 0, a, b);
      storeWall(dx, dy, a, b);
    }
  }
  // No wall reaches the footprint (a hole in the walls): nothing to sample.
  if ((wallNWA.w | wallNA.w | wallNEA.w | wallWA.w | wallCA.w | wallEA.w | wallSWA.w | wallSA.w | wallSEA.w) == WALL_NONE) {
    return ivec4(0);
  }
  // The sides outlined against a neighbour's wall of another blend (west, east, north, south), when the samples reach
  // their bands.
  ivec4 outlined = ivec4(0);
  int band = ${String(WALL_OUTLINE_PIXELS)};
  if (wallCA.w != WALL_NONE && (low.x < band || low.y < band || high.x >= ${String(SPRITE_TILE_PIXELS)} - band || high.y >= ${String(SPRITE_TILE_PIXELS)} - band)) {
    int own = wallBlendAt(texel);
    ivec4 next = ivec4(wallBlendAt(texel + ivec2(0, -1)), wallBlendAt(texel + ivec2(0, 1)), wallBlendAt(texel + ivec2(-1, 0)), wallBlendAt(texel + ivec2(1, 0)));
    outlined = ivec4(greaterThanEqual(next, ivec4(0))) * ivec4(notEqual(next, ivec4(own)));
  }
  vec4 sum = vec4(0.0);
  // Runtime bounds (uSpriteSamples is at most MAX_SPRITE_SAMPLES): the loops stay loops, so the shader stays small.
  for (int y = 0; y < count; y++) {
    for (int x = 0; x < count; x++) {
      ivec2 sub = samplePixel(centre, x, y);
      // The four walls covering the sample (k: the upper row, then the lower, each left to right), sorted by
      // wallOrder · 4 + k, so equal orders keep that order.
      int left = sub.x < ${String(SPRITE_TILE_PIXELS / 2)} ? -1 : 0;
      int upper = sub.y < ${String(SPRITE_TILE_PIXELS / 2)} ? -1 : 0;
      ivec4 order = ivec4(wallB(left, upper).w, wallB(left + 1, upper).w, wallB(left, upper + 1).w, wallB(left + 1, upper + 1).w)
        * 4 + ivec4(0, 1, 2, 3);
      ivec4 low = min(order.xzxy, order.ywzw);
      ivec4 high = max(order.xzxy, order.ywzw);
      order = ivec4(low.x, high.x, low.y, high.y);
      low = min(order.xyxy, order.zwzw);
      high = max(order.xyxy, order.zwzw);
      order = ivec4(low.x, min(low.y, high.x), max(low.y, high.x), high.y);
      vec4 layer = vec4(0.0);
      for (int k = 0; k < 4; k++) layer = drawWall(layer, left + (order[k] & 1), upper + ((order[k] >> 1) & 1), sub);
      int outlines = outlined.x * int(sub.x < band) + outlined.y * int(sub.x >= ${String(SPRITE_TILE_PIXELS)} - band)
        + outlined.z * int(sub.y < band) + outlined.w * int(sub.y >= ${String(SPRITE_TILE_PIXELS)} - band);
      if (outlines > 0) {
        float keep = pow(1.0 - ${String(WALL_OUTLINE_ALPHA)}.0 / 255.0, float(outlines));
        layer = vec4(layer.rgb * keep, 1.0 - (1.0 - layer.a) * keep);
      }
      sum += layer;
    }
  }
  vec4 mean = sum / float(count * count);
  if (mean.a <= 0.0) return ivec4(0);
  return ivec4(round(vec4(mean.rgb / mean.a, mean.a) * 255.0));
}

#endif

bool paletteColor(uint index, int xOffset, out ivec3 color) {
  if (index == ABSENT || int(index) >= uPaletteLength) return false;
  color = ivec3(texelFetch(uPalette, ivec2(int(index) % 256 + xOffset, int(index) / 256), 0).rgb);
  return true;
}

// Straight-alpha RGBA (0–255) of a tile relative to the instance's chunk origin, apron included (-1 to the chunk size).
// Only the planes the enabled layers need are read. In the sprite program (SPRITES), sub is the sprite pixel position (0–16 per axis)
// within the tile of the screen pixel's centre: a block with a stored frame or a framed cell, and a sheet, shows that
// sheet's pixels there (spriteSample), over the wall layer or background behind it, faded in over its map colour by
// uSpriteWeight. With framed cells the wall layer is the walls' sprites (wallSample) over the background, faded in over
// the walls' map colours likewise.
#ifdef SPRITES
// The depth the sprite program writes for the sprites behind the blocks (OBJECT_BEHIND in the object pass), in the
// game's order: 0 where a solid tile covers the pixel (its map colour, or a sprite pixel that is not transparent), its
// row's depth (rowDepth) where a tile that is not solid does, 1 elsewhere. Set by localColorAt.
float blockDepth = 1.0;
// The liquid overlay pass (uLiquidOverlay, after the object pass): the tile's liquid front layer alone, drawn again
// over the object pass's sprites (where it left the stencil bit), as the game draws its liquids after every tile. Set by
// localColorAt.
uniform int uLiquidOverlay;
ivec4 liquidOverlay = ivec4(0);
#endif

// The depth of the tiles of row y that are not solid: a later row lies nearer (ROW_DEPTH_TOP, ROW_DEPTH_SCALE).
float rowDepth(int y) {
  return max(0.3, ${ROW_DEPTH_TOP} - float(y) * ${ROW_DEPTH_SCALE});
}

// The depth of row y of a stage after the tiles that are not solid (STAGE_DEPTH_TOP, STAGE_DEPTH_SCALE).
float stageDepth(int stage, int y) {
  return ${STAGE_DEPTH_TOP} - float(stage * ${String(STAGE_ROWS)} + min(y, ${String(STAGE_ROWS - 1)})) * ${STAGE_DEPTH_SCALE};
}

ivec4 localColorAt(ivec2 local, vec2 sub) {
  ivec2 texel = ivec2(local.y + ${String(PAGE_APRON)}, local.x + ${String(PAGE_APRON)});
#ifdef SPRITES
  blockDepth = 1.0;
  liquidOverlay = ivec4(0);
#endif
  int tileY = vRect.y + local.y;

  ivec4 color = ivec4(0);
  if ((uLayers & 1) != 0) color = ivec4(texelFetch(uBackground, ivec2(tileY % 256, tileY / 256), 0));
#ifdef SPRITES
  // The liquids as the game lays them out (docs/assets.md, "Liquids"; liquidLayout in ../chunk/liquid-layout.ts),
  // uploaded with the framed cells: the tile's liquid piece of its water sheet and the liquid behind its block. A kind
  // without its sheets keeps its map colour (below).
  bool liquidLayout = (uLayers & 8) != 0 && (uPresent & ${String(PRESENT.cells)}) != 0 && (vCells & 1) != 0;
  int pieceKind = liquidLayout ? int(plane16(texel, ${String(PLANES_16.liquidCell)}) >> 12u) & 7 : 0;
  if (pieceKind != 0 && uLiquidSheets[pieceKind - 1].w == 0) pieceKind = 0;
  int liquidShape = (uPresent & ${String(PRESENT.shape)}) != 0 ? int(plane8(texel, ${String(PLANES_8.shape)})) : 0;
  ivec4 piece = ivec4(0), behindBack = ivec4(0), behindSolid = ivec4(0), behind = ivec4(0);
  vec3 glitter = vec3(0.0);
  // A fall's piece fades by one step of LIQUID_FALL_STEPS per tile below its liquid: pieceShown of pieceSteps remain.
  int pieceShown = 0, pieceSteps = 1;
  if (liquidLayout) {
    liquidSamples(texel, vRect.xy + local, sub, pieceKind, liquidShape, piece, behind, glitter);
    uint behindBits = plane16(texel, ${String(PLANES_16.liquidBehind)});
    int behindCode = int(behindBits >> 7u) & 7;
    int behindKind = (int(behindBits >> 10u) & 3) + 1;
    behindSolid = withOpacity(behind, BEHIND_ALPHA[behindCode]);
    // The back layer draws shimmer behind a block fully.
    behindBack = withOpacity(behind, behindKind == 4 ? 255 : BEHIND_ALPHA[behindCode]);
    if (pieceKind != 0) {
      pieceSteps = LIQUID_FALL_STEPS[pieceKind - 1];
      pieceShown = pieceSteps - (int(behindBits >> 12u) & 15);
      // The glitter fades with its piece's fall, but not by the front layer's opacity.
      glitter *= float(pieceShown) / float(pieceSteps);
    }
  }
  // The back layer: under the sky the liquids are drawn once opaque behind everything (the background hides them
  // below the surface). Faded in like a sprite.
  if (liquidLayout && tileY < uSurfaceY && (piece.a != 0 || behindBack.a != 0)) {
    ivec4 back = over(withOpacity(piece, (510 * pieceShown + pieceSteps) / (2 * pieceSteps)), over(behindBack, color));
    back.rgb = min(ivec3(255), back.rgb + ivec3(round(glitter)));
    color = uSpriteWeight < 256 ? (color * (256 - uSpriteWeight) + back * uSpriteWeight + 128) / 256 : back;
  }
#endif
  ivec3 content;
  uint block = (uLayers & 4) != 0 ? plane16(texel, ${String(PLANES_16.block)}) : ABSENT;
  uint wall = (uLayers & 2) != 0 ? plane16(texel, ${String(PLANES_16.wall)}) : ABSENT;
  ivec4 sprite = ivec4(0);
  bool blockShown = paletteColor(block, 0, content);
  bool hasSprite = false;
#ifdef SPRITES
  hasSprite = blockShown && spriteSample(block, texel, sub, sprite);
  if (hasSprite) {
    ivec4 drawInfo = texelFetch(uSpriteSheets, sheetAt(block) + ivec2(5, 0), 0);
    sprite.rgb = spritePainted(sprite.rgb, int(plane8(texel, ${String(PLANES_8.paint)})), false, drawInfo.x);
    // The rainbow bricks are drawn in the disco colour (DISCO_TILES).
    if (${DISCO_TILES.map((id) => `drawInfo.z == ${String(id)}`).join(" || ")}) sprite.rgb = ivec3(round(vec3(sprite.rgb) * DISCO));
    if ((uPresent & ${String(PRESENT.flags)}) != 0 && (plane16(texel, ${String(PLANES_16.flags)}) & ${String(INACTIVE_FLAG)}u) != 0u) {
      sprite.rgb = inactiveShade(sprite.rgb);
    }
  }
#endif
  // The block's map colour: shown without a sprite, and faded out under a sprite below SPRITE_FULL_ZOOM.
  ivec4 mapped = blockShown
    ? ivec4(painted(blockColor(block, content, texel), int(plane8(texel, ${String(PLANES_8.paint)})), false), 255)
    : ivec4(0);
  if (blockShown && !hasSprite) {
    color = mapped;
#ifdef SPRITES
    blockDepth = 0.0;
#endif
  } else {
    ivec4 behind = color;
    bool wallShown = paletteColor(wall, 256, content);
    if (wallShown) color = ivec4(painted(content, int(plane8(texel, ${String(PLANES_8.wallPaint)})), true), 255);
    // Wall sprites are drawn wherever the wall layer is shown, also on tiles without a wall of their own: the
    // overhang of the walls around them reaches in, each in its own paint. Nothing of them is seen under an
    // opaque block sprite, also while it fades in (it is mixed with the block's map colour, not with what lies behind
    // it), so they are skipped there. Like the block fade below, the fade mixes straight-alpha colours, so over a
    // hidden background a fading overhang darkens slightly.
#ifdef SPRITES
    bool covered = hasSprite && sprite.a == 255;
    if (!covered && (uLayers & 2) != 0 && (uPresent & ${String(PRESENT.cells)}) != 0 && (vCells & 2) != 0) {
      ivec4 walls = over(wallSample(texel, sub, wallShown ? color : ivec4(0)), behind);
      color = uSpriteWeight < 256 ? (color * (256 - uSpriteWeight) + walls * uSpriteWeight + 128) / 256 : walls;
    }
#endif
    // A sprite (painted, shaded when inactive) over what lies behind it.
#ifdef SPRITES
    if (hasSprite) {
      // The liquid behind a block lies under its sprite, and so does the end of a vine strip it holds.
      ivec4 vine = vineKind(block) == 0 && uSpriteSamples == 1 ? vineInto(texel, ivec2(sub)) : ivec4(0);
      color = over(sprite, over(behindSolid, over(vine, color)));
      if (uSpriteWeight < 256) color = (mapped * (256 - uSpriteWeight) + color * uSpriteWeight + 128) / 256;
      // The solid tiles are drawn over the sprites behind the blocks, the others row by row with them, the vines in
      // their stages after them.
      int vineStage = vineKind(block);
      if (sprite.a > 0) {
        blockDepth = (tileFlags(block) & ${String(TILE_DRAW_FLAGS.solidLayer)}) != 0 ? 0.0
          : vineStage != 0 ? stageDepth(vineStage == 1 ? ${String(DRAW_STAGE.vines)} : ${String(DRAW_STAGE.risingVines)}, tileY) : rowDepth(tileY);
      }
    }
#endif
  }

  if ((uLayers & 8) != 0) {
    uint liquid = plane8(texel, ${String(PLANES_8.liquid)});
    int amount = int(plane8(texel, ${String(PLANES_8.liquidAmount)}));
    bool own = liquid >= 1u && liquid <= 4u && amount != 0;
    ivec4 plainFront = own ? ivec4(uLiquids[liquid - 1u], amount) : ivec4(0);
#ifdef SPRITES
    // The front layer: the tile's liquid piece at its kind's opacity, faded in over the map colour of the tile's own
    // liquid like a block sprite; a kind without its sheets (or before the layout is uploaded) its map colour.
    liquidOverlay = plainFront;
    if (liquidLayout && (own ? uLiquidSheets[liquid - 1u].w != 0 : pieceKind != 0)) {
      ivec4 front = pieceKind != 0 ? withOpacity(piece, (2 * LIQUID_FRONT_ALPHA[pieceKind - 1] * pieceShown + pieceSteps) / (2 * pieceSteps)) : ivec4(0);
      liquidOverlay = uSpriteWeight < 256 ? (plainFront * (256 - uSpriteWeight) + front * uSpriteWeight + 128) / 256 : front;
      glitter *= min(1.0, float(uSpriteWeight) / 256.0);
    } else {
      glitter = vec3(0.0);
    }
    color = over(liquidOverlay, color);
    color.rgb = min(ivec3(255), color.rgb + ivec3(round(glitter)));
    // The overlay pass draws the front layer over sprites in one blend: the glitter folded into it.
    liquidOverlay = withGlitter(liquidOverlay, glitter);
#else
    if (own) color = over(plainFront, color);
#endif
  }

  // In sprite mode the wire pass draws the wires (wireFragmentSource), over the object pass.
#ifndef SPRITES
  int shown = (uLayers >> 4) & 31;
  int wires = shown != 0 && (uPresent & ${String(PRESENT.flags)}) != 0
    ? int(plane16(texel, ${String(PLANES_16.flags)})) & shown
    : 0;
  if (wires != 0) {
    ivec3 wire = ivec3(0);
    for (int i = 4; i >= 0; i--) {
      if ((wires & uWireBits[i]) != 0) wire = uWireColors[i];
    }
    // renderChunk's wire rule: blended over an opaque pixel, replacing any other.
    color = color.a == 255 ? over(ivec4(wire, uWireAlpha), color) : ivec4(wire, uWireAlpha);
  }
#endif
  return color;
}

ivec4 localColor(ivec2 local) {
  return localColorAt(local, vec2(0.0));
}

// Straight-alpha RGBA (0–255) of a tile inside the instance's chunk; tiles outside it are clamped to its edge.
ivec4 tileColor(ivec2 tile) {
  return localColor(clamp(tile - vRect.xy, ivec2(0), vRect.zw - 1));
}
`;

/** Chunk pass: every instance is one chunk drawn on the canvas at one tile per `1 / uZoom` pixels. */
export const chunkVertexSource: string = header + `
uniform vec2 uCamera;
uniform float uZoom;
uniform vec2 uViewport;
${instanceInputs}
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 tile = vec2(aRect.xy) + corner * vec2(aRect.zw);
  vec2 screen = (tile - uCamera) * uZoom;
  gl_Position = vec4(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0, 0.0, 1.0);
  passInstance();
}
`;


/**
 * Chunk pass fragment. At one pixel per tile and above (uFilter 0) a pixel is the one tile under it, bit-exact with
 * `renderChunk`. Below (uFilter 1) it is the box filter of `filterTiles` (../chunk/box-filter.ts): the premultiplied
 * mean of the in-world tiles its footprint covers, weighted by covered area in 1 / FILTER_SUBTILE tile units, in
 * unsigned integers so that it equals the CPU reference. A footprint of at most MAX_FILTER_TILES tiles around a
 * centre inside the chunk covers at most three tiles per axis and stays within the page apron.
 */
const chunkFragmentBody = `
uniform vec2 uCamera;
uniform float uZoom;
uniform vec2 uViewport;
uniform int uFilter;
// Tiles per pixel of the box filter (filterTilesPerPixel); the world size in tiles is uWorldSize.
uniform float uStep;
out vec4 outColor;
${tileColorSource}
const int SUBTILE = ${String(FILTER_SUBTILE)};

ivec2 subtileEdge(vec2 pixel) {
  return ivec2(floor((uCamera + pixel * uStep) * float(SUBTILE) + 0.5));
}

ivec4 filtered(ivec2 pixel) {
  ivec2 first = subtileEdge(vec2(pixel));
  ivec2 last = subtileEdge(vec2(pixel + 1));
  ivec2 firstTile = ivec2(floor(vec2(first) / float(SUBTILE)));
  // In-world tiles the page holds: the chunk and its apron.
  ivec2 low = max(ivec2(0), vRect.xy - ${String(PAGE_APRON)});
  ivec2 high = min(uWorldSize, vRect.xy + vRect.zw + ${String(PAGE_APRON)});
  uint area = 0u;
  uint alpha = 0u;
  uvec3 sum = uvec3(0u);
  for (int dy = 0; dy < 3; dy++) {
    int y = firstTile.y + dy;
    if (y * SUBTILE >= last.y) break;
    if (y < low.y || y >= high.y) continue;
    uint height = uint(min(last.y, (y + 1) * SUBTILE) - max(first.y, y * SUBTILE));
    for (int dx = 0; dx < 3; dx++) {
      int x = firstTile.x + dx;
      if (x * SUBTILE >= last.x) break;
      if (x < low.x || x >= high.x) continue;
      uint weight = height * uint(min(last.x, (x + 1) * SUBTILE) - max(first.x, x * SUBTILE));
      ivec4 color = localColor(ivec2(x, y) - vRect.xy);
      area += weight;
      alpha += uint(color.a) * weight;
      sum += uvec3(color.rgb * color.a) * weight;
    }
  }
  if (alpha == 0u) return ivec4(0);
  return ivec4(ivec3((2u * sum + alpha) / (2u * alpha)), int((2u * alpha + area) / (2u * area)));
}

// The tile under a pixel, and with sprites the sprite position within it. A pixel this chunk's quad covers can compute
// a tile just across the chunk's border (the quad's edge and this position are rounded apart): its centre then lies on
// the border, so it is the nearest edge of the chunk's own tile, not the far side of it.
ivec4 pointColor(vec2 screen) {
  vec2 world = uCamera + screen / uZoom;
  ivec2 local = ivec2(floor(world)) - vRect.xy;
  ivec2 inside = clamp(local, ivec2(0), vRect.zw - 1);
  vec2 sub = fract(world) * ${String(SPRITE_TILE_PIXELS)}.0 + vec2(local - inside) * ${String(SPRITE_TILE_PIXELS)}.0;
  return localColorAt(inside, clamp(sub, vec2(0.0), vec2(${String(SPRITE_TILE_PIXELS)}.0)));
}

void main() {
  vec2 screen = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y);
#ifdef SPRITES
  // Sprites start at SPRITE_MIN_ZOOM, far above the box filter (uFilter, below one pixel per tile), so this program
  // has none: the filter's loop would inline the whole sprite code once per tile it averages (minutes of D3D11 compile).
  ivec4 color = pointColor(screen);
  if (uLiquidOverlay != 0) {
    if (liquidOverlay.a == 0) discard;
    outColor = vec4(liquidOverlay) / 255.0;
    return;
  }
#else
  ivec4 color = uFilter != 0 ? filtered(ivec2(floor(screen))) : pointColor(screen);
#endif
  outColor = vec4(color) / 255.0;
#ifdef SPRITES
  gl_FragDepth = blockDepth;
#endif
}
`;
export const chunkFragmentSource: string = header + chunkFragmentBody;
/**
 * The chunk pass with sprites (SPRITES): the same pass, plus the blocks' and walls' sprites. A separate program, so
 * map mode and the overview build pass never run (or compile) the sprite code; the renderer links it on first use.
 */
export const chunkSpriteFragmentSource: string = header + "#define SPRITES\n" + chunkFragmentBody;

/** The uniforms the object and wire passes share: the camera and the sprite sampling of spriteSampling(). */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types -- an interpolated template needs it under isolatedDeclarations
export const spritePassInputs: string = `
precision highp sampler2DArray;
precision highp usampler2DArray;
uniform vec2 uCamera;
uniform float uZoom;
uniform vec2 uViewport;
uniform sampler2DArray uAtlas;
uniform highp usampler2DArray uAtlasHalf;
uniform int uSpriteSamples;
uniform float uSpriteStep;
uniform int uSpriteLevel;
uniform int uSpriteWeight;
out vec4 outColor;
${atlasTexelSource}
${overSource}
// Sprite pixel position (16 per tile) in the world of the centre of the screen pixel being drawn.
vec2 worldSpritePixel() {
  vec2 screen = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y);
  return (uCamera + screen / uZoom) * ${String(SPRITE_TILE_PIXELS)}.0;
}

// Sample (x, y) of uSpriteSamples² spread over the footprint (uSpriteStep sprite pixels) of a screen pixel centred on
// sprite pixel position centre, kept inside [0, size): the pixel it reads, at level 1 the even top-left of its 2 × 2.
ivec2 samplePixelIn(vec2 centre, ivec2 size, int x, int y) {
  vec2 at = centre + ((vec2(x, y) + 0.5) / float(uSpriteSamples) - 0.5) * uSpriteStep;
  ivec2 sub = clamp(ivec2(floor(at)), ivec2(0), size - 1);
  return uSpriteLevel == 1 ? sub & ivec2(~1) : sub;
}

// A straight-alpha colour (0–255) faded in by uSpriteWeight, written premultiplied for the blending of the passes drawn
// over the chunk pass (one, one minus source alpha); nothing is written where it is transparent.
void writeFaded(ivec4 color) {
  float alpha = float(color.a) / 255.0 * float(uSpriteWeight) / 256.0;
  if (alpha <= 0.0) discard;
  outColor = vec4(vec3(color.rgb) / 255.0 * alpha, alpha);
}

// Colour (0–255) added over what lies below, faded in like writeFaded (premultiplied output, alpha 0).
void writeAdded(vec3 color) {
  vec3 added = color / 255.0 * float(uSpriteWeight) / 256.0;
  if (all(lessThanEqual(added, vec3(0.0)))) discard;
  outColor = vec4(added, 0.0);
}
`;
