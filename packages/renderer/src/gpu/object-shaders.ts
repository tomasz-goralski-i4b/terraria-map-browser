// GLSL of sprite mode's object pass (object-pass.ts).
import {
  ROW_DEPTH_SCALE, ROW_DEPTH_TOP, SPRITE_TILE_PIXELS, STAGE_DEPTH_SCALE, STAGE_DEPTH_TOP, STAGE_ROWS, header,
  shimmerColorSource, spritePaintSource, spritePassInputs,
} from "./shaders.js";

/**
 * Per-instance attributes of the object pass: the sprite's rectangle in world sprite pixels (x, y, width | height << 16,
 * its order: objectOrder) and its atlas source.
 */
export const OBJECT_DEST_ATTRIBUTE = 0;
export const OBJECT_SOURCE_ATTRIBUTE = 1;
/** The object pass's source flags: mirrored left to right, and the shift of 255 minus its opacity. */
export const OBJECT_FLIP = 1;
export const OBJECT_FADE_SHIFT = 1;
/**
 * The object pass's source flag of a sprite that lies behind the blocks (bit 10): frame-important tiles, which the
 * game draws under the blocks around them (docs/assets.md, "Draw offsets"). The chunk pass writes depth 0 where a
 * block covers a pixel; such a sprite is drawn only elsewhere.
 */
export const OBJECT_BEHIND = 1024;
/** The object pass's source bits 12–19: the paint of the tile the sprite belongs to. */
export const OBJECT_PAINT_SHIFT = 12;
/** The object pass's source flag of a sprite of an inactive (actuated) tile (bit 20). */
export const OBJECT_INACTIVE = 1_048_576;
/** The object pass's source bits 21–24: the special group (1-based, 0 for none) the sprite is painted with. */
export const OBJECT_GROUP_SHIFT = 21;
/** The object pass's source bits 25–26: how the sprite's art is coloured (ObjectSprite.color), 0 as drawn. */
export const OBJECT_COLOR_SHIFT = 25;
export const OBJECT_COLORS = { shimmer: 1, glitter: 2, disco: 3 } as const;

/**
 * Where a sprite lies in the game's order (docs/assets.md, "Draw order"), as the object pass's order attribute: its
 * row + 2 when drawn with the tiles that are not solid; −(1 + stage · 4096 + row) when drawn in a stage after them
 * (DRAW_STAGE); 0 with the waterfalls; 1 with the solid tiles, behind their sprites.
 */
export function objectOrder(sprite: { readonly row?: number; readonly stage?: number; readonly solidLayer?: boolean }): number {
  if (sprite.solidLayer === true) return 1;
  if (sprite.row === undefined) return 0;
  if (sprite.stage === undefined) return sprite.row + 2;
  return -(1 + sprite.stage * STAGE_ROWS + Math.min(sprite.row, STAGE_ROWS - 1));
}

/**
 * Object pass (docs/assets.md, "Trees", "Minecart tracks"): in sprite mode, after the chunk pass, one instanced quad
 * per object sprite (tree trunk cells, tops and branches, mushroom caps, track decorations and bumpers), placed at its
 * rectangle in world sprite pixels (16 per tile), which may reach past its tile into the tiles around it.
 */
export const objectVertexSource: string = header + `
uniform vec2 uCamera;
uniform float uZoom;
uniform vec2 uViewport;
layout(location = ${String(OBJECT_DEST_ATTRIBUTE)}) in ivec4 aDest;
layout(location = ${String(OBJECT_SOURCE_ATTRIBUTE)}) in ivec4 aSource;
flat out ivec4 vDest;
flat out ivec4 vSource;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  ivec2 size = ivec2(aDest.z & 65535, aDest.z >> 16);
  vec2 tile = (vec2(aDest.xy) + corner * vec2(size)) / ${String(SPRITE_TILE_PIXELS)}.0;
  vec2 screen = (tile - uCamera) * uZoom;
  // The game's order (docs/assets.md, "Draw order"; objectOrder): the sprites of the tiles that are not solid row by
  // row (half a row in front of their own row's depth, rowDepth in the chunk pass), so a later row's tile or sprite
  // covers them, then the stages after them (from ${STAGE_DEPTH_TOP} down, a stage after another and a row after another nearer),
  // the waterfalls (0.25), the pieces drawn with the solid tiles behind them (0.001) and the solid tiles (0); the other
  // sprites over everything (0).
  float depth = 0.0;
  if ((aSource.w & ${String(OBJECT_BEHIND)}) != 0) {
    depth = aDest.w > 1 ? max(0.3, ${ROW_DEPTH_TOP} - (float(aDest.w - 2) + 0.5) * ${ROW_DEPTH_SCALE})
      : aDest.w < 0 ? ${STAGE_DEPTH_TOP} - float(-aDest.w - 1) * ${STAGE_DEPTH_SCALE} : aDest.w == 1 ? 0.001 : 0.25;
  }
  gl_Position = vec4(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0, 2.0 * depth - 1.0, 1.0);
  vDest = ivec4(aDest.xy, size);
  vSource = aSource;
}
`;

/**
 * Object pass fragment: the straight-alpha mean of uSpriteSamples² atlas pixels of the object's source rectangle (its
 * top-left (x, y) on page `page`: vSource = (page, x, y, flags)), sampled as the chunk pass samples sprites, faded in.
 * Flags (OBJECT_FLIP, OBJECT_FADE_SHIFT): bit 0 mirrors the rectangle left to right, bits 1–8 hold 255 minus the
 * opacity its pixels are scaled by (a waterfall's fade; 0 for an opaque sprite), bits 12–19 (OBJECT_PAINT_SHIFT)
 * paint it and bit 20 (OBJECT_INACTIVE) shades it as an inactive tile, bits 21–24 (OBJECT_GROUP_SHIFT) name its special
 * group, bits 25–26 (OBJECT_COLOR_SHIFT) colour it: by shimmer's base colour at the corners of the tile under its
 * centre, blended across it; added over what lies below in shimmer's glitter colours (0.5) there; tinted by DISCO.
 */
export const objectFragmentSource: string = header + spritePassInputs + `
uniform int uLayers;
flat in ivec4 vDest;
flat in ivec4 vSource;
${spritePaintSource}
${shimmerColorSource}
// The colour of shimmer (glitter: of its glitter) at sprite pixel sub of the sprite, blended between the corners of
// the tile under its centre.
vec3 shimmerLight(ivec2 sub, bool glitter) {
  // shortcut: the corners of the tile under the sprite's centre stand for the stream tile's (at most one tile off in a
  // wave 10 tiles long); carry the tile in the instance to place them exactly.
  ivec2 tile = (vDest.xy + vDest.zw / 2) / ${String(SPRITE_TILE_PIXELS)};
  vec2 uv = (vec2(sub) + 0.5) / vec2(vDest.zw);
  vec3 corners[4];
  for (int k = 0; k < 4; k++) {
    ivec2 corner = tile + ivec2(k & 1, k >> 1);
    corners[k] = glitter ? glitterColor(corner, 0.5) : shimmerBase(vec2(corner));
  }
  return mix(mix(corners[0], corners[1], uv.x), mix(corners[2], corners[3], uv.x), uv.y);
}

void main() {
  vec2 centre = worldSpritePixel() - vec2(vDest.xy);
  int count = uSpriteSamples;
  ivec4 sum = ivec4(0);
  for (int y = 0; y < count; y++) {
    for (int x = 0; x < count; x++) {
      ivec2 sub = samplePixelIn(centre, vDest.zw, x, y);
      if ((vSource.w & ${String(OBJECT_FLIP)}) != 0) sub.x = vDest.z - 1 - sub.x;
      ivec4 sampled = ivec4(round(atlasTexel(vSource.yz, vSource.yz + sub, vSource.x) * 255.0));
      sampled.a = sampled.a * (255 - ((vSource.w >> ${String(OBJECT_FADE_SHIFT)}) & 255)) / 255;
      int coloring = (vSource.w >> ${String(OBJECT_COLOR_SHIFT)}) & 3;
      if (coloring == ${String(OBJECT_COLORS.shimmer)}) sampled.rgb = ivec3(round(vec3(sampled.rgb) * shimmerLight(sub, false)));
      else if (coloring == ${String(OBJECT_COLORS.glitter)}) sampled.rgb = ivec3(round(vec3(sampled.rgb) * shimmerLight(sub, true)));
      else if (coloring == ${String(OBJECT_COLORS.disco)}) sampled.rgb = ivec3(round(vec3(sampled.rgb) * DISCO));
      sum += ivec4(sampled.rgb * sampled.a, sampled.a);
    }
  }
  int samples = count * count;
  if (sum.a == 0) discard;
  ivec3 rgb = spritePainted((2 * sum.rgb + sum.a) / (2 * sum.a), (vSource.w >> ${String(OBJECT_PAINT_SHIFT)}) & 255, false,
    (vSource.w >> ${String(OBJECT_GROUP_SHIFT)}) & 15);
  if ((vSource.w & ${String(OBJECT_INACTIVE)}) != 0) rgb = inactiveShade(rgb);
  int alpha = (2 * sum.a + samples) / (2 * samples);
  // Glitter is added: its art, faded, times its colour.
  if (((vSource.w >> ${String(OBJECT_COLOR_SHIFT)}) & 3) == ${String(OBJECT_COLORS.glitter)}) writeAdded(vec3(rgb) * float(alpha) / 255.0);
  else writeFaded(ivec4(rgb, alpha));
}
`;
