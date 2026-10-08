// GLSL for the chunk pass. The colour rules mirror `renderChunk` (../chunk/render.ts) and use integer arithmetic so
// the output is bit-exact: no tie-breaking can differ because (l*a + c*(255-a)) / 255 never has a .5 fraction.

export const vertexSource = `#version 300 es
precision highp float;
uniform vec2 uCamera;
uniform float uZoom;
uniform vec2 uViewport;
uniform ivec2 uOrigin;
uniform ivec2 uSize;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 tile = vec2(uOrigin) + corner * vec2(uSize);
  vec2 screen = (tile - uCamera) * uZoom;
  gl_Position = vec4(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0, 0.0, 1.0);
}
`;

export const fragmentSource = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
// Chunk planes are stored transposed (planes are column-major): texel (s, t) = (y in chunk, x in chunk).
uniform usampler2D uBlock;
uniform usampler2D uWall;
uniform usampler2D uLiquid;
uniform usampler2D uAmount;
uniform usampler2D uPaint;
uniform usampler2D uWallPaint;
// Row r holds palette entries 256r…256r+255: block colours in x 0…255, wall colours in x 256…511.
uniform usampler2D uPalette;
// Background colour of world row y at texel (y % 256, y / 256), resolved on the CPU by backgroundColor();
// row uPaintRow holds the paint colours by paint ID.
uniform usampler2D uBackground;
// Per tile (like the planes): 0 for the palette colour, else 1 + the index of its frame-selected colour in
// uVariantColors (256 per row), resolved on the CPU by the same mapOption() as renderChunk.
uniform usampler2D uVariant;
uniform usampler2D uVariantColors;
uniform int uPaintRow;
uniform int uPaintCount; // 0 without a map palette: paint is ignored
uniform vec2 uCamera;
uniform float uZoom;
uniform vec2 uViewport;
uniform ivec2 uOrigin;
uniform ivec2 uSize;
uniform int uPaletteLength;
uniform int uLayers; // bit 0 background, 1 walls, 2 blocks, 3 liquids
uniform ivec3 uLiquids[4]; // colours of CWM liquid kinds 1–4
out vec4 outColor;

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

bool blockColor(ivec2 texel, out ivec3 color) {
  if (!paletteColor(texelFetch(uBlock, texel, 0).r, 0, color)) return false;
  int variant = int(texelFetch(uVariant, texel, 0).r);
  if (variant != 0) color = ivec3(texelFetch(uVariantColors, ivec2((variant - 1) % 256, (variant - 1) / 256), 0).rgb);
  return true;
}

void main() {
  vec2 screen = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y);
  ivec2 tile = ivec2(floor(uCamera + screen / uZoom));
  ivec2 local = clamp(tile - uOrigin, ivec2(0), uSize - 1);
  ivec2 texel = ivec2(local.y, local.x);
  int tileY = uOrigin.y + local.y;

  ivec4 color = ivec4(0);
  if ((uLayers & 1) != 0) color = ivec4(texelFetch(uBackground, ivec2(tileY % 256, tileY / 256), 0));
  ivec3 content;
  if ((uLayers & 4) != 0 && blockColor(texel, content)) {
    color = ivec4(painted(content, int(texelFetch(uPaint, texel, 0).r), false), 255);
  } else if ((uLayers & 2) != 0 && paletteColor(texelFetch(uWall, texel, 0).r, 256, content)) {
    color = ivec4(painted(content, int(texelFetch(uWallPaint, texel, 0).r), true), 255);
  }

  uint liquid = texelFetch(uLiquid, texel, 0).r;
  int amount = int(texelFetch(uAmount, texel, 0).r);
  if ((uLayers & 8) != 0 && liquid >= 1u && liquid <= 4u && amount != 0) {
    ivec3 tint = uLiquids[liquid - 1u];
    if (color.a == 255) {
      color.rgb = (2 * (tint * amount + color.rgb * (255 - amount)) + 255) / 510;
    } else {
      color = ivec4(tint, amount);
    }
  }
  outColor = vec4(color) / 255.0;
}
`;
