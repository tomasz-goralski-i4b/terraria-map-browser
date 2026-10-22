/** Instanced strokes, square handles, dimension ticks and hollow rings, with widths in CSS pixels. */
export const annotationVertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec4 aEndpoints;
layout(location=1) in vec3 aColor;
layout(location=2) in vec2 aStyle;
uniform vec2 uCamera;
uniform vec2 uViewport;
uniform float uZoom;
uniform float uDensity;
out vec2 vOffset;
flat out vec3 vColor;
flat out float vWidth;
flat out float vKind;
void main() {
  vec2 from = (aEndpoints.xy - uCamera) * uZoom;
  vec2 to = (aEndpoints.zw - uCamera) * uZoom;
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 direction = to - from;
  direction = length(direction) > 0.0001 ? normalize(direction) : vec2(1.0, 0.0);
  vec2 normal = vec2(-direction.y, direction.x);
  vec2 position;
  vWidth = aStyle.x;
  vKind = aStyle.y;
  vColor = aColor;
  if (vKind == 1.0 || vKind == 3.0) {
    vOffset = (corner * 2.0 - 1.0) * vWidth * 0.5;
    position = from + vOffset * uDensity;
  } else {
    float across = (corner.x * 2.0 - 1.0) * (vWidth * 0.5 + 1.0);
    vOffset = vec2(across, 0.0);
    position = vKind == 2.0
      ? from + normal * (corner.y * 2.0 - 1.0) * 4.0 * uDensity + direction * across * uDensity
      : mix(from, to, corner.y) + normal * across * uDensity;
  }
  gl_Position = vec4(position / uViewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}
`;
export const annotationFragmentSource = `#version 300 es
precision highp float;
in vec2 vOffset;
flat in vec3 vColor;
flat in float vWidth;
flat in float vKind;
out vec4 outColor;
void main() {
  float edge = vWidth * 0.5 - max(abs(vOffset.x), abs(vOffset.y));
  // A ring is a 2 px light band between 1 px dark ones and leaves its inside to the map.
  if (vKind == 3.0 && edge > 4.0) discard;
  bool ink = vKind == 3.0 ? edge > 1.0 && edge <= 3.0
    : vKind == 1.0 ? edge <= 1.5
    : abs(vOffset.x) <= vWidth * 0.5;
  // Opaque strokes and a dark halo also preserve straight alpha over transparent terrain.
  outColor = vec4(ink ? vColor : vec3(0.06, 0.09, 0.14), 1.0);
}
`;
