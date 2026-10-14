// The content highlight's passes (#186), drawn over the presented terrain. The chunk overlay is the GPU side of
// `highlightOverlay` (../chunk/highlight.ts); the mask pass draws the overview's match mask (`createHighlightMask`).
import { HIGHLIGHT_BLOCK_BIT, HIGHLIGHT_WALL_BIT } from "../chunk/highlight.js";
import { PAGE_APRON, PLANES_16, PLANES_8, PLANE_COUNT_16, PLANE_COUNT_8 } from "./shaders.js";

/**
 * Chunk overlay fragment, drawn with the chunk pass's vertex shader over the resident chunks (one instance each). A
 * tile matches when its block (wall) index is below uPaletteLength and has HIGHLIGHT_BLOCK_BIT (HIGHLIGHT_WALL_BIT) in
 * the lookup (R8UI, 256 × 256, texel (index % 256, index / 256)), or bit `liquid & 7` of uLiquids is set. The page
 * apron holds the neighbours across the chunk's edges; neighbours past the world's edge are never read.
 */
export const highlightChunkFragmentSource: string = "#version 300 es\n" + `precision highp float;
precision highp int;
precision highp usampler2DArray;
precision highp usampler2D;
uniform usampler2DArray uPlanes16;
uniform usampler2DArray uPlanes8;
uniform usampler2D uHighlight;
uniform int uLiquids;
uniform int uPaletteLength;
uniform vec2 uCamera;
uniform float uZoom;
uniform vec2 uViewport;
uniform ivec2 uWorldSize;
uniform vec3 uColor;
// Alphas (0–1) of the dim layer (0 without dimming) and of the tint; uOutline the outline's width in pixels, 0 to tint.
uniform float uDimAlpha;
uniform float uTintAlpha;
uniform float uOutline;
flat in ivec4 vRect;
flat in int vLayer;
flat in int vCells;
out vec4 outColor;

bool listed(uint index, uint bit) {
  if (int(index) >= uPaletteLength) return false;
  return (texelFetch(uHighlight, ivec2(int(index) & 255, int(index) >> 8), 0).r & bit) != 0u;
}

bool matches(ivec2 tile) {
  ivec2 local = tile - vRect.xy;
  ivec2 texel = ivec2(local.y + ${String(PAGE_APRON)}, local.x + ${String(PAGE_APRON)});
  uint block = texelFetch(uPlanes16, ivec3(texel, vLayer * ${String(PLANE_COUNT_16)} + ${String(PLANES_16.block)}), 0).r;
  if (listed(block, ${String(HIGHLIGHT_BLOCK_BIT)}u)) return true;
  uint wall = texelFetch(uPlanes16, ivec3(texel, vLayer * ${String(PLANE_COUNT_16)} + ${String(PLANES_16.wall)}), 0).r;
  if (listed(wall, ${String(HIGHLIGHT_WALL_BIT)}u)) return true;
  uint liquid = texelFetch(uPlanes8, ivec3(texel, vLayer * ${String(PLANE_COUNT_8)} + ${String(PLANES_8.liquid)}), 0).r;
  return ((uLiquids >> int(liquid & 7u)) & 1) != 0;
}

// Whether the neighbour of tile at offset step breaks the match (the world's edge does not).
bool differs(ivec2 tile, ivec2 step) {
  ivec2 next = tile + step;
  if (any(lessThan(next, ivec2(0))) || any(greaterThanEqual(next, uWorldSize))) return false;
  return !matches(next);
}

void main() {
  vec2 screen = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y);
  vec2 world = uCamera + screen / uZoom;
  // A pixel the quad covers can compute a tile just across the chunk's border: it keeps the chunk's own tile.
  ivec2 tile = clamp(ivec2(floor(world)), vRect.xy, vRect.xy + vRect.zw - 1);
  if (!matches(tile)) {
    if (uDimAlpha <= 0.0) discard;
    outColor = vec4(0.0, 0.0, 0.0, uDimAlpha);
    return;
  }
  if (uOutline <= 0.0) {
    outColor = vec4(uColor, uTintAlpha);
    return;
  }
  vec2 inside = clamp(world - vec2(tile), 0.0, 1.0) * uZoom;
  bool ink = (inside.x < uOutline && differs(tile, ivec2(-1, 0)))
    || (uZoom - inside.x < uOutline && differs(tile, ivec2(1, 0)))
    || (inside.y < uOutline && differs(tile, ivec2(0, -1)))
    || (uZoom - inside.y < uOutline && differs(tile, ivec2(0, 1)));
  if (!ink) discard;
  outColor = vec4(uColor, 1.0);
}
`;

/**
 * Mask pass fragment, drawn with the overview's vertex shader (the whole world as one quad): a mask texel above 0 (any
 * match below it: the levels hold maxima, sampled nearest) is the highlight colour, any other the dim layer.
 */
export const highlightMaskFragmentSource = `#version 300 es
precision highp float;
uniform sampler2D uMask;
uniform vec3 uColor;
uniform float uDimAlpha;
in vec2 vUv;
out vec4 outColor;
void main() {
  if (texture(uMask, vUv).r > 0.0) {
    outColor = vec4(uColor, 1.0);
  } else {
    if (uDimAlpha <= 0.0) discard;
    outColor = vec4(0.0, 0.0, 0.0, uDimAlpha);
  }
}
`;
