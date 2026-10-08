// GLSL for the WebGL2 backend. The colour rules mirror `renderChunk` (../chunk/render.ts) and use integer arithmetic so
// the chunk pass is bit-exact: no tie-breaking can differ because (l*a + c*(255-a)) / 255 never has a .5 fraction.
import { FILTER_SUBTILE } from "../chunk/box-filter.js";

/** Tiles of neighbouring chunks stored around each chunk's page layer, so the box filter can cross chunk edges. */
export const PAGE_APRON = 1;

/**
 * Planes of a chunk page, one array layer each per chunk: layer `slot * planes + plane`, where slot is the chunk's
 * place in its page. Each layer is stored transposed (planes are column-major): texel (s, t) = (y, x) of the chunk,
 * offset by the apron. A new plane is one more entry here (and in the renderer's upload table), not a new texture.
 */
export const PLANES_16 = { block: 0, wall: 1, flags: 2, frameX: 3, frameY: 4 } as const;
export const PLANES_8 = { liquid: 0, liquidAmount: 1, paint: 2, wallPaint: 3 } as const;
export const PLANE_COUNT_16: number = Object.keys(PLANES_16).length;
export const PLANE_COUNT_8: number = Object.keys(PLANES_8).length;

/** Bits of `uPresent`: optional planes the world has. An absent plane reads as 0 and is never uploaded. */
export const PRESENT = { flags: 1, frameX: 2, frameY: 4 } as const;

/**
 * Rules texture: 256 texels per row. Rows 0–255 hold one header per palette index (index % 256, index / 256):
 * (first range, range count, axis 0 frameX / 1 frameY, colour of option 0 as 0xRRGGBB); a count of 0 means no rule.
 * Ranges follow from row RULE_HEADER_ROWS, one texel each: (from, to, colour of its option).
 */
export const RULE_ROW = 256;
export const RULE_HEADER_ROWS = 256;

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
`;

/** Shared by both chunk passes: the colour of one world tile, resolved from its chunk's page layers. */
const tileColorSource = `
precision highp usampler2DArray;
precision highp usampler2D;
precision highp isampler2D;
// Chunk pages, uploaded straight from the world's planes: uPlanes16 holds the 16-bit planes (block, wall, flags,
// frameX, frameY as their 16-bit pattern), uPlanes8 the 8-bit ones (liquid kind, liquid amount, block paint, wall
// paint). A chunk's plane p is layer vLayer * planes + p, holding the chunk and an apron of PAGE_APRON tiles of its
// neighbours, transposed: texel (s, t) = (y in chunk + PAGE_APRON, x in chunk + PAGE_APRON).
uniform usampler2DArray uPlanes16;
uniform usampler2DArray uPlanes8;
uniform int uPresent; // optional planes the world has: bit 0 flags, 1 frameX, 2 frameY
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
flat in ivec4 vRect;
flat in int vLayer;

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

bool paletteColor(uint index, int xOffset, out ivec3 color) {
  if (index == ABSENT || int(index) >= uPaletteLength) return false;
  color = ivec3(texelFetch(uPalette, ivec2(int(index) % 256 + xOffset, int(index) / 256), 0).rgb);
  return true;
}

// Straight-alpha RGBA (0–255) of a tile relative to the instance's chunk origin, apron included (-1 to the chunk size).
// Only the planes the enabled layers need are read.
ivec4 localColor(ivec2 local) {
  ivec2 texel = ivec2(local.y + ${String(PAGE_APRON)}, local.x + ${String(PAGE_APRON)});
  int tileY = vRect.y + local.y;

  ivec4 color = ivec4(0);
  if ((uLayers & 1) != 0) color = ivec4(texelFetch(uBackground, ivec2(tileY % 256, tileY / 256), 0));
  ivec3 content;
  uint block = (uLayers & 4) != 0 ? plane16(texel, ${String(PLANES_16.block)}) : ABSENT;
  uint wall = (uLayers & 2) != 0 ? plane16(texel, ${String(PLANES_16.wall)}) : ABSENT;
  if (paletteColor(block, 0, content)) {
    content = blockColor(block, content, texel);
    color = ivec4(painted(content, int(plane8(texel, ${String(PLANES_8.paint)})), false), 255);
  } else if (paletteColor(wall, 256, content)) {
    color = ivec4(painted(content, int(plane8(texel, ${String(PLANES_8.wallPaint)})), true), 255);
  }

  if ((uLayers & 8) != 0) {
    uint liquid = plane8(texel, ${String(PLANES_8.liquid)});
    int amount = int(plane8(texel, ${String(PLANES_8.liquidAmount)}));
    if (liquid >= 1u && liquid <= 4u && amount != 0) {
      ivec3 tint = uLiquids[liquid - 1u];
      if (color.a == 255) {
        color.rgb = (2 * (tint * amount + color.rgb * (255 - amount)) + 255) / 510;
      } else {
        color = ivec4(tint, amount);
      }
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
    if (color.a == 255) {
      color.rgb = (2 * (wire * uWireAlpha + color.rgb * (255 - uWireAlpha)) + 255) / 510;
    } else {
      color = ivec4(wire, uWireAlpha);
    }
  }
  return color;
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
  vLayer = aLayer;
}
`;

/**
 * Chunk pass fragment. At one pixel per tile and above (uFilter 0) a pixel is the one tile under it, bit-exact with
 * `renderChunk`. Below (uFilter 1) it is the box filter of `filterTiles` (../chunk/box-filter.ts): the premultiplied
 * mean of the in-world tiles its footprint covers, weighted by covered area in 1 / FILTER_SUBTILE tile units, in
 * unsigned integers so that it equals the CPU reference. A footprint of at most MAX_FILTER_TILES tiles around a
 * centre inside the chunk covers at most three tiles per axis and stays within the page apron.
 */
export const chunkFragmentSource: string = header + `
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

void main() {
  vec2 screen = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y);
  outColor = vec4(uFilter != 0 ? filtered(ivec2(floor(screen))) : tileColor(ivec2(floor(uCamera + screen / uZoom)))) / 255.0;
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
