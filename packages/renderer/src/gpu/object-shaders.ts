// GLSL of sprite mode's object pass (object-pass.ts).
import { SPRITE_TILE_PIXELS, header, spritePaintSource, spritePassInputs } from "./shaders.js";

/** Per-instance attributes of the object pass: the sprite's rectangle in world sprite pixels and its atlas source. */
export const OBJECT_DEST_ATTRIBUTE = 0;
export const OBJECT_SOURCE_ATTRIBUTE = 1;
/** The object pass's source flags: mirrored left to right, and the shift of 255 minus its opacity. */
export const OBJECT_FLIP = 1;
export const OBJECT_FADE_SHIFT = 1;
/** The object pass's source flag of a sprite multiplied by uTint (bit 9, above the fade's 8 bits). */
export const OBJECT_TINT = 512;
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
  vec2 tile = (vec2(aDest.xy) + corner * vec2(aDest.zw)) / ${String(SPRITE_TILE_PIXELS)}.0;
  vec2 screen = (tile - uCamera) * uZoom;
  // Sprites behind the blocks (OBJECT_BEHIND) at depth 0.25: not where the chunk pass left 0 (a block pixel); the
  // others at depth 0, over everything.
  float depth = (aSource.w & ${String(OBJECT_BEHIND)}) != 0 ? -0.5 : -1.0;
  gl_Position = vec4(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0, depth, 1.0);
  vDest = aDest;
  vSource = aSource;
}
`;

/**
 * Object pass fragment: the straight-alpha mean of uSpriteSamples² atlas pixels of the object's source rectangle (its
 * top-left (x, y) on page `page`: vSource = (page, x, y, flags)), sampled as the chunk pass samples sprites, faded in.
 * Flags (OBJECT_FLIP, OBJECT_FADE_SHIFT): bit 0 mirrors the rectangle left to right, bits 1–8 hold 255 minus the
 * opacity its pixels are scaled by (a waterfall's fade; 0 for an opaque sprite), bit 9 (OBJECT_TINT) multiplies its
 * colour by uTint (shimmer's map colour, for its grey waterfall sheet), bits 12–19 (OBJECT_PAINT_SHIFT) paint it and
 * bit 20 (OBJECT_INACTIVE) shades it as an inactive tile, bits 21–24 (OBJECT_GROUP_SHIFT) name its special group.
 */
export const objectFragmentSource: string = header + spritePassInputs + `
uniform ivec3 uTint;
uniform ivec3 uTintEdge;
uniform int uLayers;
flat in ivec4 vDest;
flat in ivec4 vSource;
${spritePaintSource}
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
      // Tinted (shimmer's waterfall edge band): from uTint to uTintEdge by the band's grey (200 at its edge).
      if ((vSource.w & ${String(OBJECT_TINT)}) != 0) sampled.rgb = uTint + (uTintEdge - uTint) * min(sampled.r, 200) / 200;
      sum += ivec4(sampled.rgb * sampled.a, sampled.a);
    }
  }
  int samples = count * count;
  if (sum.a == 0) discard;
  ivec3 rgb = spritePainted((2 * sum.rgb + sum.a) / (2 * sum.a), (vSource.w >> ${String(OBJECT_PAINT_SHIFT)}) & 255, false,
    (vSource.w >> ${String(OBJECT_GROUP_SHIFT)}) & 15);
  if ((vSource.w & ${String(OBJECT_INACTIVE)}) != 0) rgb = inactiveShade(rgb);
  writeFaded(ivec4(rgb, (2 * sum.a + samples) / (2 * samples)));
}
`;
