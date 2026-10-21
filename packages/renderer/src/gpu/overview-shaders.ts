// GLSL of the overview (overview.ts): the build pass from chunk pages and the display pass.
import { header, instanceInputs, tileColorSource } from "./shaders.js";

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
  passInstance();
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
