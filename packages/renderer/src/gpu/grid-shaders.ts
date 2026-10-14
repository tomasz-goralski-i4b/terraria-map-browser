/** Attribute-free fullscreen triangle for presenting the existing terrain framebuffer. */
export const gridVertexSource = `#version 300 es
precision highp float;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * Screen-space boundaries and world-anchored dashes, with one opacity even at intersections. Solid interval lines
 * stay while dashed block lines (`uMinor` 0) would be too dense.
 */
export const gridFragmentSource = `#version 300 es
precision highp float;
uniform vec2 uCamera;
uniform vec2 uViewport;
uniform vec2 uWorld;
uniform float uZoom;
uniform float uSpacing;
uniform float uOpacity;
uniform float uDensity;
uniform float uMinor;
uniform sampler2D uScene;
out vec4 outColor;
void main() {
  vec4 scene = texelFetch(uScene, ivec2(gl_FragCoord.xy), 0);
  outColor = scene;
  vec2 pixel = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y);
  vec2 position = uCamera * uZoom + pixel;
  vec2 tile = position / uZoom;
  if (any(lessThan(tile, vec2(0.0))) || any(greaterThanEqual(tile, uWorld))) return;
  bvec2 interval = lessThan(mod(position, uZoom * uSpacing), vec2(uDensity));
  bvec2 block = lessThan(mod(position, uZoom), vec2(uDensity));
  bool vertical = interval.x || (uMinor > 0.5 && block.x && mod(position.y / uDensity, 5.0) < 2.0);
  bool horizontal = interval.y || (uMinor > 0.5 && block.y && mod(position.x / uDensity, 5.0) < 2.0);
  if (!vertical && !horizontal) return;
  // One colour everywhere: a contrast switch would cut visibly across the sky's 256-step gradient.
  vec3 color = vec3(200.0, 205.0, 210.0) / 255.0;
  // Canvas uses straight alpha: normalize the composite, including transparent or partially opaque terrain.
  float alpha = uOpacity + scene.a * (1.0 - uOpacity);
  outColor = vec4((color * uOpacity + scene.rgb * scene.a * (1.0 - uOpacity)) / alpha, alpha);
}
`;
