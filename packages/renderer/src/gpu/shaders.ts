// GLSL for the WebGL2 backend. The colour rules mirror `renderChunk` (../chunk/render.ts) and use integer arithmetic so
// the chunk pass is bit-exact: no tie-breaking can differ because (l*a + c*(255-a)) / 255 never has a .5 fraction.

/** Vertex attribute locations of the per-chunk instance data, bound before linking. */
export const RECT_ATTRIBUTE = 0;
export const LAYER_ATTRIBUTE = 1;

const header = `#version 300 es
precision highp float;
precision highp int;
`;

// Per instance: the chunk's tile rectangle (origin x, origin y, columns, rows) and its layer in the page.
const instanceInputs = `
layout(location = ${String(RECT_ATTRIBUTE)}) in ivec4 aRect;
layout(location = ${String(LAYER_ATTRIBUTE)}) in int aLayer;
flat out ivec4 vRect;
flat out int vLayer;
`;

/** Shared by both chunk passes: the colour of one world tile, resolved from its chunk's page layer. */
const tileColorSource = `
precision highp usampler2D;
precision highp usampler2DArray;
// Chunk pages: one layer per chunk, stored transposed (planes are column-major): texel (s, t) = (y in chunk, x in chunk).
// uWide holds block, wall, variant (0 for the palette colour, else 1 + its index in uVariantColors); uNarrow holds
// liquid kind, liquid amount, block paint, wall paint.
uniform usampler2DArray uWide;
uniform usampler2DArray uNarrow;
// Row r holds palette entries 256r…256r+255: block colours in x 0…255, wall colours in x 256…511.
uniform usampler2D uPalette;
// Background colour of world row y at texel (y % 256, y / 256), resolved on the CPU by backgroundColor();
// row uPaintRow holds the paint colours by paint ID.
uniform usampler2D uBackground;
// Colours of frame-selected map options (256 per row), resolved on the CPU by the same mapOption() as renderChunk.
uniform usampler2D uVariantColors;
uniform int uPaintRow;
uniform int uPaintCount; // 0 without a map palette: paint is ignored
uniform int uPaletteLength;
uniform int uLayers; // bit 0 background, 1 walls, 2 blocks, 3 liquids
uniform ivec3 uLiquids[4]; // colours of CWM liquid kinds 1–4
flat in ivec4 vRect;
flat in int vLayer;

const uint ABSENT = 65535u;

// Mirrors paintedColor() in ../palette/map-palette.ts.
ivec3 painted(ivec3 base, int paint, bool wall) {
  if (paint == 0 || paint >= uPaintCount) return base;
  if (paint == 29) return ivec3(base.b / 34);
  if (paint == 30) return wall ? (255 - base) >> 1 : 255 - base;
  ivec3 tint = ivec3(texelFetch(uBackground, ivec2(paint, uPaintRow), 0).rgb);
  return tint * max(base.r, max(base.g, base.b)) / 255;
}

bool paletteColor(uint index, int xOffset, out ivec3 color) {
  if (index == ABSENT || int(index) >= uPaletteLength) return false;
  color = ivec3(texelFetch(uPalette, ivec2(int(index) % 256 + xOffset, int(index) / 256), 0).rgb);
  return true;
}

// Straight-alpha RGBA (0–255) of a tile inside the instance's chunk; tiles outside it are clamped to its edge.
ivec4 tileColor(ivec2 tile) {
  ivec2 local = clamp(tile - vRect.xy, ivec2(0), vRect.zw - 1);
  ivec3 texel = ivec3(local.y, local.x, vLayer);
  uvec4 wide = texelFetch(uWide, texel, 0);
  uvec4 narrow = texelFetch(uNarrow, texel, 0);
  int tileY = vRect.y + local.y;

  ivec4 color = ivec4(0);
  if ((uLayers & 1) != 0) color = ivec4(texelFetch(uBackground, ivec2(tileY % 256, tileY / 256), 0));
  ivec3 content;
  if ((uLayers & 4) != 0 && paletteColor(wide.r, 0, content)) {
    int variant = int(wide.b);
    if (variant != 0) content = ivec3(texelFetch(uVariantColors, ivec2((variant - 1) % 256, (variant - 1) / 256), 0).rgb);
    color = ivec4(painted(content, int(narrow.b), false), 255);
  } else if ((uLayers & 2) != 0 && paletteColor(wide.g, 256, content)) {
    color = ivec4(painted(content, int(narrow.a), true), 255);
  }

  uint liquid = narrow.r;
  int amount = int(narrow.g);
  if ((uLayers & 8) != 0 && liquid >= 1u && liquid <= 4u && amount != 0) {
    ivec3 tint = uLiquids[liquid - 1u];
    if (color.a == 255) {
      color.rgb = (2 * (tint * amount + color.rgb * (255 - amount)) + 255) / 510;
    } else {
      color = ivec4(tint, amount);
    }
  }
  return color;
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
  vLayer = aLayer;
}
`;

export const chunkFragmentSource: string = header + `
uniform vec2 uCamera;
uniform float uZoom;
uniform vec2 uViewport;
out vec4 outColor;
${tileColorSource}
void main() {
  vec2 screen = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y);
  outColor = vec4(tileColor(ivec2(floor(uCamera + screen / uZoom)))) / 255.0;
}
`;

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
  vLayer = aLayer;
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
