// GLSL for the WebGL2 backend. The colour rules mirror `renderChunk` (../chunk/render.ts) and use integer arithmetic so
// the chunk pass is bit-exact: no tie-breaking can differ because (l*a + c*(255-a)) / 255 never has a .5 fraction.
import { FILTER_SUBTILE } from "../chunk/box-filter.js";
import { BLOCK_CELL_STRIDE } from "../framing/chunk-cells.js";
import { NO_CELL } from "../framing/frame-block.js";
import { WALL_CELL_STRIDE, WALL_OVERHANG } from "../framing/frame-wall.js";

/** Tiles of neighbouring chunks stored around each chunk's page layer, so the box filter can cross chunk edges. */
export const PAGE_APRON = 1;

/**
 * Planes of a chunk page, one array layer each per chunk: layer `slot * planes + plane`, where slot is the chunk's
 * place in its page. Each layer is stored transposed (planes are column-major): texel (s, t) = (y, x) of the chunk,
 * offset by the apron. A new plane is one more entry here (and in the renderer's upload table), not a new texture.
 */
export const PLANES_16 = { block: 0, wall: 1, flags: 2, frameX: 3, frameY: 4, cell: 5, wallCell: 6 } as const;
export const PLANES_8 = { liquid: 0, liquidAmount: 1, paint: 2, wallPaint: 3, shape: 4 } as const;
export const PLANE_COUNT_16: number = Object.keys(PLANES_16).length;
export const PLANE_COUNT_8: number = Object.keys(PLANES_8).length;

/**
 * Bits of `uPresent`: optional planes the world has. An absent plane reads as 0 and is never uploaded. `cells` is set
 * for a chunk pass that draws framed cells (the cell planes of blocks and walls, computed by the renderer, not read
 * from the world); each instance then says whether its chunk's cells are uploaded (CELLS_INSTANCE_BIT).
 */
export const PRESENT = { flags: 1, frameX: 2, frameY: 4, shape: 8, cells: 16 } as const;

/**
 * Rules texture: 256 texels per row. Rows 0–255 hold one header per palette index (index % 256, index / 256):
 * (first range, range count, axis 0 frameX / 1 frameY, colour of option 0 as 0xRRGGBB); a count of 0 means no rule.
 * Ranges follow from row RULE_HEADER_ROWS, one texel each: (from, to, colour of its option).
 */
export const RULE_ROW = 256;
export const RULE_HEADER_ROWS = 256;

/**
 * Sprite sheet lookup texture (RGBA32I): five texels per palette index, at (index % 256 × 5 + k, index / 256): the
 * index's tile sheet in k = 0 (atlas page, x, y, state: SPRITE_STATE) and k = 1 (sheet width, height, frame width,
 * frame height), its wall sheet likewise in k = 2 and 3, and in k = 4 how its stored frames wrap past the sheet's edge
 * (SPRITE_FRAME_WRAPS: period along x, shift along y, period along y, shift along x; 0 for none).
 */
export const SPRITE_SHEET_ROW = 256;
/** Texels per palette index in the sprite sheet lookup. */
export const SPRITE_SHEET_TEXELS = 5;

/** The state of a palette index in the sprite sheet lookup. */
export const SPRITE_STATE = {
  /** No sprite: the map colour (no atlas, or content sprite mode defers, such as trees). */
  mapColor: 0,
  /** Drawn from its sheet. */
  sheet: 1,
  /** No sheet in the atlas (newer than the install, mod, unknown): the missing-texture checkerboard. */
  missing: 2,
} as const;

/** The missing-texture checkerboard: magenta and black squares, 2 × 2 per tile. Generated, not a game asset. */
export const MISSING_SPRITE_COLORS: readonly (readonly [number, number, number])[] = [[255, 0, 255], [0, 0, 0]];

/** Sprite pixels across one tile: a frame's cell is scaled into these. */
const SPRITE_TILE_PIXELS = 16;

/** Pixels per tile from which sprite mode samples the atlas: below SPRITE_FULL_ZOOM it fades in over the map colour. */
export const SPRITE_MIN_ZOOM = 5;
/** Pixels per tile from which sprites are drawn whole, without the map colour. */
export const SPRITE_FULL_ZOOM = 7.5;
/** At most this many sprite samples per axis and screen pixel (4 × 4 at SPRITE_MIN_ZOOM). */
const MAX_SPRITE_SAMPLES = 4;

/**
 * How the chunk pass samples sprites at `zoom` pixels per tile: `samples` × `samples` sprite samples per screen pixel,
 * `step` sprite pixels apart in total per axis (the pixel's footprint, 16 / zoom), averaged within the tile, so a sprite
 * shown smaller than its 16 × 16 pixels is downscaled rather than point-sampled; and the sprite's `weight` (0–256)
 * over the map colour, rising linearly from SPRITE_MIN_ZOOM to SPRITE_FULL_ZOOM.
 */
export function spriteSampling(zoom: number): { readonly samples: number; readonly step: number; readonly weight: number } {
  const step = SPRITE_TILE_PIXELS / zoom;
  const samples = Math.min(MAX_SPRITE_SAMPLES, Math.max(1, Math.ceil(step - 1e-9)));
  const fade = (zoom - SPRITE_MIN_ZOOM) / (SPRITE_FULL_ZOOM - SPRITE_MIN_ZOOM);
  return { samples, step, weight: Math.round(256 * Math.min(1, Math.max(0, fade))) };
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

const header = `#version 300 es
precision highp float;
precision highp int;
`;

// Per instance: the chunk's tile rectangle (origin x, origin y, columns, rows) and its slot in the page.
const instanceInputs = `
layout(location = ${String(RECT_ATTRIBUTE)}) in ivec4 aRect;
layout(location = ${String(LAYER_ATTRIBUTE)}) in int aLayer;
flat out ivec4 vRect;
flat out int vLayer;
flat out int vCells;
`;

/** Shared by both chunk passes: the colour of one world tile, resolved from its chunk's page layers. */
const tileColorSource = `
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
uniform int uLayers; // bit 0 background, 1 walls, 2 blocks, 3 liquids; bits 4–8 the wire mask (ChunkLayers.wires)
// Wire overlay colours in priority order (yellow, green, blue, red, actuator) and their flag bits; see WIRE_COLORS.
uniform ivec3 uWireColors[5];
uniform int uWireBits[5];
uniform int uWireAlpha;
uniform ivec3 uLiquids[4]; // colours of CWM liquid kinds 1–4
#ifdef SPRITES
// Sprite mode (#91), compiled only into the chunk pass's sprite program (chunkSpriteFragmentSource), which draws from
// SPRITE_MIN_ZOOM pixels per tile with an atlas: the atlas pages (RGBA8, straight alpha) and the tile and wall sheets
// of each palette index (SPRITE_SHEET_ROW).
uniform sampler2DArray uAtlas;
uniform isampler2D uSpriteSheets;
// spriteSampling(): samples per axis, their footprint in sprite pixels, and the sprite's weight over the map colour.
uniform int uSpriteSamples;
uniform float uSpriteStep;
uniform int uSpriteWeight;
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

// Straight-alpha top over below, in integers. Over an opaque pixel it is renderChunk's rounded blend (map mode only ever
// has opaque or empty pixels, so it stays bit-exact); over a partly transparent one (a half-transparent sprite pixel
// with nothing behind it) the general rule, alpha and colour rounded to nearest.
ivec4 over(ivec4 top, ivec4 below) {
  if (top.a == 0) return below;
  if (below.a == 0 || top.a == 255) return top;
  if (below.a == 255) return ivec4((2 * (top.rgb * top.a + below.rgb * (255 - top.a)) + 255) / 510, 255);
  int weight = below.a * (255 - top.a);
  int alpha = top.a + (weight + 127) / 255;
  return ivec4((top.rgb * top.a * 255 + below.rgb * weight + alpha * 255 / 2) / (alpha * 255), alpha);
}

#ifdef SPRITES
// The missing-texture checkerboard at sprite pixel sub.
ivec4 missingPixel(ivec2 sub) {
  bool first = ((sub.x / ${String(SPRITE_TILE_PIXELS / 2)} + sub.y / ${String(SPRITE_TILE_PIXELS / 2)}) & 1) == 0;
  return ivec4(first ? ivec3(${MISSING_SPRITE_COLORS[0]?.join(", ") ?? "0"}) : ivec3(${MISSING_SPRITE_COLORS[1]?.join(", ") ?? "0"}), 255);
}

// Where the sheets of palette index index start in the sprite sheet lookup: its tile sheet, then (+2) its wall sheet.
ivec2 sheetAt(uint index) {
  return ivec2(int(index) % ${String(SPRITE_SHEET_ROW)} * ${String(SPRITE_SHEET_TEXELS)}, int(index) / ${String(SPRITE_SHEET_ROW)});
}

// The atlas pixel of a self-framed block at sprite pixel sub: its framed cell (the cell plane), cut by its shape into
// eight 2-pixel columns as shapedColumns() (../framing/chunk-cells.ts) gives them; transparent where the shape cuts
// it away. False without framed cells or a cell (a falling block with nothing below it, or not self-framed), for
// content sprite mode leaves in map colours, or past the sheet's edge.
bool cellPixel(ivec4 place, ivec2 at, ivec2 texel, ivec2 sub, out ivec4 color) {
  if ((uPresent & ${String(PRESENT.cells)}) == 0 || (vCells & 1) == 0) return false;
  uint cell = plane16(texel, ${String(PLANES_16.cell)});
  if (cell == ${String(NO_CELL)}u || place.w == ${String(SPRITE_STATE.mapColor)}) return false;
  if (place.w == ${String(SPRITE_STATE.missing)}) {
    color = missingPixel(sub);
    return true;
  }
  int shape = (uPresent & ${String(PRESENT.shape)}) != 0 ? int(plane8(texel, ${String(PLANES_8.shape)})) : 0;
  int column = sub.x / 2;
  // Column (sourceY, destY, height) per shape: half, slopes cut at NE, NW, SE, SW; anything else is full.
  ivec3 rows = ivec3(0, 0, 16);
  if (shape == 1) rows = ivec3(0, 8, 8);
  else if (shape == 2) rows = ivec3(0, 2 * column, 16 - 2 * column);
  else if (shape == 3) rows = ivec3(0, 14 - 2 * column, 2 * column + 2);
  else if (shape == 4) rows = ivec3(2 * column, 0, 16 - 2 * column);
  else if (shape == 5) rows = ivec3(0, 0, 2 * column + 2);
  if (sub.y < rows.y || sub.y >= rows.y + rows.z) {
    color = ivec4(0);
    return true;
  }
  ivec4 size = texelFetch(uSpriteSheets, at + ivec2(1, 0), 0);
  ivec2 origin = ivec2(int(cell >> 6u), int(cell & 63u)) * ${String(BLOCK_CELL_STRIDE)};
  ivec2 pixel = origin + ivec2(sub.x, rows.x + sub.y - rows.y);
  if (any(greaterThanEqual(pixel, size.xy))) return false;
  color = ivec4(round(texelFetch(uAtlas, ivec3(place.yz + pixel, place.x), 0) * 255.0));
  return true;
}

// The atlas pixel of a block at sprite pixel sub (0–15 per axis) of its tile. A stored frame selects its cell, scaled
// into the tile, or the missing-texture checkerboard for content without a sheet; a block without one (frames of -1)
// shows its framed cell (cellPixel). False for content sprite mode leaves in map colours, or past the sheet's edge.
bool spritePixel(uint index, ivec2 texel, ivec2 sub, out ivec4 color) {
  ivec2 at = sheetAt(index);
  ivec4 place = texelFetch(uSpriteSheets, at, 0);
  bool frames = (uPresent & ${String(PRESENT.frameX | PRESENT.frameY)}) == ${String(PRESENT.frameX | PRESENT.frameY)};
  ivec2 stored = frames
    ? ivec2(frame(texel, ${String(PLANES_16.frameX)}, ${String(PRESENT.frameX)}), frame(texel, ${String(PLANES_16.frameY)}, ${String(PRESENT.frameY)}))
    : ivec2(-1);
  if (stored.x < 0 || stored.y < 0) return cellPixel(place, at, texel, sub, color);
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
  ivec2 pixel = stored + sub * size.zw / ${String(SPRITE_TILE_PIXELS)};
  if (any(greaterThanEqual(pixel, size.xy))) return false;
  color = ivec4(round(texelFetch(uAtlas, ivec3(place.yz + pixel, place.x), 0) * 255.0));
  return true;
}

// The sprite of a block over the footprint of a screen pixel centred on sprite pixel position centre (0–16 per axis,
// relative to the tile): the straight-alpha mean of uSpriteSamples² sprite pixels evenly spread over uSpriteStep sprite
// pixels, kept inside the tile. One sample (16 pixels per tile and above) is spritePixel at the centre.
bool spriteSample(uint index, ivec2 texel, vec2 centre, out ivec4 color) {
  int count = uSpriteSamples;
  ivec4 sum = ivec4(0);
  for (int y = 0; y < ${String(MAX_SPRITE_SAMPLES)}; y++) {
    if (y >= count) break;
    for (int x = 0; x < ${String(MAX_SPRITE_SAMPLES)}; x++) {
      if (x >= count) break;
      vec2 at = centre + ((vec2(x, y) + 0.5) / float(count) - 0.5) * uSpriteStep;
      ivec2 sub = clamp(ivec2(floor(at)), ivec2(0), ivec2(${String(SPRITE_TILE_PIXELS - 1)}));
      ivec4 sampled;
      if (!spritePixel(index, texel, sub, sampled)) return false;
      sum += ivec4(sampled.rgb * sampled.a, sampled.a);
    }
  }
  int samples = count * count;
  color = sum.a == 0
    ? ivec4(0)
    : ivec4((2 * sum.rgb + sum.a) / (2 * sum.a), (2 * sum.a + samples) / (2 * samples));
  return true;
}

// Sample (x, y) of uSpriteSamples² spread over the footprint (uSpriteStep sprite pixels) of a screen pixel centred on
// sprite pixel position centre, kept inside the tile: the sprite pixel it reads (as spriteSample places them).
ivec2 samplePixel(vec2 centre, int x, int y) {
  vec2 at = centre + ((vec2(x, y) + 0.5) / float(uSpriteSamples) - 0.5) * uSpriteStep;
  return clamp(ivec2(floor(at)), ivec2(0), ivec2(${String(SPRITE_TILE_PIXELS - 1)}));
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
ivec2 wallNWB;
ivec4 wallNA;
ivec2 wallNB;
ivec4 wallNEA;
ivec2 wallNEB;
ivec4 wallWA;
ivec2 wallWB;
ivec4 wallCA;
ivec2 wallCB;
ivec4 wallEA;
ivec2 wallEB;
ivec4 wallSWA;
ivec2 wallSWB;
ivec4 wallSA;
ivec2 wallSB;
ivec4 wallSEA;
ivec2 wallSEB;
// The map colour of the tile's own wall, premultiplied (zero without one).
vec4 wallOwn;

void loadWall(ivec2 texel, bool own, out ivec4 a, out ivec2 b) {
  a = ivec4(0);
  b = ivec2(0);
  uint cell = plane16(texel, ${String(PLANES_16.wallCell)});
  if (cell == ${String(NO_CELL)}u) {
    if (own && wallOwn.a > 0.0) a.w = WALL_MAPPED;
    return;
  }
  ivec2 sheet = sheetAt(plane16(texel, ${String(PLANES_16.wall)})) + ivec2(2, 0);
  ivec4 place = texelFetch(uSpriteSheets, sheet, 0);
  if (place.w == ${String(SPRITE_STATE.sheet)}) {
    a = ivec4(place.yz + ivec2(int(cell >> 6u), int(cell & 63u)) * ${String(WALL_CELL_STRIDE)}, place.x, WALL_SHEET);
    b = place.yz + texelFetch(uSpriteSheets, sheet + ivec2(1, 0), 0).xy;
  } else if (own) {
    a.w = place.w == ${String(SPRITE_STATE.missing)} ? WALL_MISSING : WALL_MAPPED;
  }
}

ivec4 wallA(int dx, int dy) {
  if (dy < 0) return dx < 0 ? wallNWA : dx == 0 ? wallNA : wallNEA;
  if (dy == 0) return dx < 0 ? wallWA : dx == 0 ? wallCA : wallEA;
  return dx < 0 ? wallSWA : dx == 0 ? wallSA : wallSEA;
}

ivec2 wallB(int dx, int dy) {
  if (dy < 0) return dx < 0 ? wallNWB : dx == 0 ? wallNB : wallNEB;
  if (dy == 0) return dx < 0 ? wallWB : dx == 0 ? wallCB : wallEB;
  return dx < 0 ? wallSWB : dx == 0 ? wallSB : wallSEB;
}

// Stores the wall at (dx, dy) loaded by wallSample into its variable.
void storeWall(int dx, int dy, ivec4 a, ivec2 b) {
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

// The wall at (dx, dy) from the tile drawn over below (premultiplied) at sprite pixel sub of the tile, which its cell
// covers: the cell's top-left lies WALL_OVERHANG pixels up and left of its own tile's.
vec4 drawWall(vec4 below, int dx, int dy, ivec2 sub) {
  ivec4 a = wallA(dx, dy);
  if (a.w == WALL_NONE) return below;
  vec4 top;
  if (a.w == WALL_SHEET) {
    ivec2 pixel = a.xy + sub + ${String(WALL_OVERHANG)} - ${String(SPRITE_TILE_PIXELS)} * ivec2(dx, dy);
    if (any(greaterThanEqual(pixel, wallB(dx, dy)))) return below;
    vec4 sampled = texelFetch(uAtlas, ivec3(pixel, a.z), 0);
    top = vec4(sampled.rgb * sampled.a, sampled.a);
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
  wallNWB = ivec2(0);
  wallNA = ivec4(0);
  wallNB = ivec2(0);
  wallNEA = ivec4(0);
  wallNEB = ivec2(0);
  wallWA = ivec4(0);
  wallWB = ivec2(0);
  wallCA = ivec4(0);
  wallCB = ivec2(0);
  wallEA = ivec4(0);
  wallEB = ivec2(0);
  wallSWA = ivec4(0);
  wallSWB = ivec2(0);
  wallSA = ivec4(0);
  wallSB = ivec2(0);
  wallSEA = ivec4(0);
  wallSEB = ivec2(0);
  // Runtime bounds: one copy of loadWall, not one per neighbour.
  for (int dy = north ? -1 : 0; dy <= (south ? 1 : 0); dy++) {
    for (int dx = west ? -1 : 0; dx <= (east ? 1 : 0); dx++) {
      ivec4 a;
      ivec2 b;
      loadWall(texel + ivec2(dy, dx), dx == 0 && dy == 0, a, b);
      storeWall(dx, dy, a, b);
    }
  }
  // No wall reaches the footprint (a hole in the walls): nothing to sample.
  if ((wallNWA.w | wallNA.w | wallNEA.w | wallWA.w | wallCA.w | wallEA.w | wallSWA.w | wallSA.w | wallSEA.w) == WALL_NONE) {
    return ivec4(0);
  }
  vec4 sum = vec4(0.0);
  // Runtime bounds (uSpriteSamples is at most MAX_SPRITE_SAMPLES): the loops stay loops, so the shader stays small.
  for (int y = 0; y < count; y++) {
    for (int x = 0; x < count; x++) {
      ivec2 sub = samplePixel(centre, x, y);
      // The four walls covering the sample, in drawing order: the upper row, then the lower, each left to right.
      int left = sub.x < ${String(SPRITE_TILE_PIXELS / 2)} ? -1 : 0;
      int upper = sub.y < ${String(SPRITE_TILE_PIXELS / 2)} ? -1 : 0;
      vec4 layer = vec4(0.0);
      for (int k = 0; k < 4; k++) layer = drawWall(layer, left + (k & 1), upper + (k >> 1), sub);
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
ivec4 localColorAt(ivec2 local, vec2 sub) {
  ivec2 texel = ivec2(local.y + ${String(PAGE_APRON)}, local.x + ${String(PAGE_APRON)});
  int tileY = vRect.y + local.y;

  ivec4 color = ivec4(0);
  if ((uLayers & 1) != 0) color = ivec4(texelFetch(uBackground, ivec2(tileY % 256, tileY / 256), 0));
  ivec3 content;
  uint block = (uLayers & 4) != 0 ? plane16(texel, ${String(PLANES_16.block)}) : ABSENT;
  uint wall = (uLayers & 2) != 0 ? plane16(texel, ${String(PLANES_16.wall)}) : ABSENT;
  ivec4 sprite = ivec4(0);
  bool blockShown = paletteColor(block, 0, content);
  bool hasSprite = false;
#ifdef SPRITES
  hasSprite = blockShown && spriteSample(block, texel, sub, sprite);
#endif
  // The block's map colour: shown without a sprite, and faded out under a sprite below SPRITE_FULL_ZOOM.
  ivec4 mapped = blockShown
    ? ivec4(painted(blockColor(block, content, texel), int(plane8(texel, ${String(PLANES_8.paint)})), false), 255)
    : ivec4(0);
  if (blockShown && !hasSprite) {
    color = mapped;
  } else {
    ivec4 behind = color;
    bool wallShown = paletteColor(wall, 256, content);
    if (wallShown) color = ivec4(painted(content, int(plane8(texel, ${String(PLANES_8.wallPaint)})), true), 255);
    // Wall sprites are drawn wherever the wall layer is shown, also on tiles without a wall of their own: the
    // overhang of the walls around them reaches in. Paint is not applied to sprites. Nothing of them is seen under an
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
    // A sprite over what lies behind it (paint is not applied to sprites).
#ifdef SPRITES
    if (hasSprite) {
      color = over(sprite, color);
      if (uSpriteWeight < 256) color = (mapped * (256 - uSpriteWeight) + color * uSpriteWeight + 128) / 256;
    }
#endif
  }

  if ((uLayers & 8) != 0) {
    uint liquid = plane8(texel, ${String(PLANES_8.liquid)});
    int amount = int(plane8(texel, ${String(PLANES_8.liquidAmount)}));
    if (liquid >= 1u && liquid <= 4u && amount != 0) {
      color = over(ivec4(uLiquids[liquid - 1u], amount), color);
    }
  }

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
  vRect = aRect;
  vLayer = aLayer & ${String(CELLS_INSTANCE_BIT - 1)};
  vCells = (aLayer >> 16) & 3;
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
// Tiles per pixel of the box filter (filterTilesPerPixel) and the world size in tiles.
uniform float uStep;
uniform ivec2 uWorldSize;
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
  outColor = vec4(uFilter != 0 ? filtered(ivec2(floor(screen))) : pointColor(screen)) / 255.0;
}
`;
export const chunkFragmentSource: string = header + chunkFragmentBody;
/**
 * The chunk pass with sprites (SPRITES): the same pass, plus the blocks' and walls' sprites. A separate program, so
 * map mode and the overview build pass never run (or compile) the sprite code; the renderer links it on first use.
 */
export const chunkSpriteFragmentSource: string = header + "#define SPRITES\n" + chunkFragmentBody;

/**
 * Overview build pass: every instance is one chunk drawn into the overview texture, one texel per uFactor × uFactor
 * tiles. A texel is the mean of its tiles inside the chunk, premultiplied so that mipmaps average it correctly.
 * Texel row r holds tile rows r × uFactor onwards (no vertical flip).
 */
export const overviewBuildVertexSource: string = header + `
uniform int uFactor;
uniform vec2 uTarget;
${instanceInputs}
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 start = vec2(aRect.xy / uFactor);
  vec2 end = vec2((aRect.xy + aRect.zw + uFactor - 1) / uFactor);
  vec2 texel = start + corner * (end - start);
  gl_Position = vec4(texel / uTarget * 2.0 - 1.0, 0.0, 1.0);
  vRect = aRect;
  vLayer = aLayer & ${String(CELLS_INSTANCE_BIT - 1)};
  vCells = (aLayer >> 16) & 3;
}
`;

export const overviewBuildFragmentSource: string = header + `
uniform int uFactor;
out vec4 outColor;
${tileColorSource}
void main() {
  ivec2 first = ivec2(gl_FragCoord.xy) * uFactor;
  vec4 sum = vec4(0.0);
  float count = 0.0;
  for (int dy = 0; dy < uFactor; dy++) {
    for (int dx = 0; dx < uFactor; dx++) {
      ivec2 local = first + ivec2(dx, dy) - vRect.xy;
      if (any(lessThan(local, ivec2(0))) || any(greaterThanEqual(local, vRect.zw))) continue;
      vec4 color = vec4(tileColor(vRect.xy + local));
      sum += vec4(color.rgb * color.a / 255.0, color.a);
      count += 1.0;
    }
  }
  outColor = count == 0.0 ? vec4(0.0) : sum / (255.0 * count);
}
`;

/** Overview display pass: the whole world as one quad, sampled with mipmaps and drawn in straight alpha. */
export const overviewVertexSource: string = header + `
uniform vec2 uCamera;
uniform float uZoom;
uniform vec2 uViewport;
uniform vec2 uWorld;
// Tiles covered by the overview texture: its size times the factor (at least the world size).
uniform vec2 uExtent;
out vec2 vUv;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 tile = corner * uWorld;
  vec2 screen = (tile - uCamera) * uZoom;
  gl_Position = vec4(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0, 0.0, 1.0);
  vUv = tile / uExtent;
}
`;

export const overviewFragmentSource: string = header + `
uniform sampler2D uOverview;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 color = texture(uOverview, vUv);
  outColor = color.a == 0.0 ? vec4(0.0) : vec4(color.rgb / color.a, color.a);
}
`;
