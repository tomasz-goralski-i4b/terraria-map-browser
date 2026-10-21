// GLSL of the sprite atlas's half-resolution copy (sprite-atlas.ts).
import { header } from "./shaders.js";

/**
 * Half-resolution atlas pass: one RGBA8UI texel per 2 × 2 atlas pixels of page uPage, their straight-alpha mean as the
 * chunk pass averages sprite samples (colour weighted by alpha, both rounded to nearest, in integers). Sheets packed
 * at even positions keep their cells apart: every cell, gutter and shape column starts at an even pixel.
 */
export const halfAtlasVertexSource: string = header + `
void main() {
  // One triangle over the whole target.
  gl_Position = vec4(float((gl_VertexID & 1) * 4 - 1), float((gl_VertexID >> 1) * 4 - 1), 0.0, 1.0);
}
`;

export const halfAtlasFragmentSource: string = header + `
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform int uPage;
out uvec4 outColor;
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy) * 2;
  ivec4 sum = ivec4(0);
  for (int k = 0; k < 4; k++) {
    ivec4 color = ivec4(round(texelFetch(uAtlas, ivec3(at + ivec2(k & 1, k >> 1), uPage), 0) * 255.0));
    sum += ivec4(color.rgb * color.a, color.a);
  }
  outColor = sum.a == 0 ? uvec4(0u) : uvec4(uvec3((2 * sum.rgb + sum.a) / (2 * sum.a)), uint((2 * sum.a + 4) / 8));
}
`;
