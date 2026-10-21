// GLSL of sprite mode's wire pass (wire-pass.ts).
import { WIRE_CELL_STRIDE } from "../objects/wires.js";
import {
  PAGE_APRON, PLANES_16, PLANE_COUNT_16, PRESENT, SPRITE_TILE_PIXELS, header, instanceInputs, spritePassInputs,
} from "./shaders.js";

/** Per-instance attribute of the wire pass: the run of tiles (x, y, width, height) its quad covers. */
export const WIRE_RUN_ATTRIBUTE = 2;

/**
 * Wire pass vertex: the chunk pass's instance inputs (its chunk's rectangle and page layer, which the fragment reads the
 * flags by), but the quad covers only the instance's run of tiles with a wire or actuator.
 */
export const wireVertexSource: string = header + `
uniform vec2 uCamera;
uniform float uZoom;
uniform vec2 uViewport;
${instanceInputs}
layout(location = ${String(WIRE_RUN_ATTRIBUTE)}) in ivec4 aRun;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 tile = vec2(aRun.xy) + corner * vec2(aRun.zw);
  vec2 screen = (tile - uCamera) * uZoom;
  gl_Position = vec4(screen.x / uViewport.x * 2.0 - 1.0, 1.0 - screen.y / uViewport.y * 2.0, 0.0, 1.0);
  passInstance();
}
`;

/**
 * Wire pass (docs/assets.md, "Wires"): in sprite mode, after the object pass, the runs of tiles with a wire or actuator
 * of every chunk (wireVertexSource), drawing only its wires and actuators: per colour (red, blue, green, yellow, in that order) the WiresNew piece its four
 * same-colour side neighbours give, then the actuator over them, faded in over the colour overlay below
 * SPRITE_FULL_ZOOM. Without the wire sheet it draws the overlay; an actuator without its sheet its overlay colour.
 */
export const wireFragmentSource: string = header + spritePassInputs + `
precision highp usampler2DArray;
uniform usampler2DArray uPlanes16;
uniform int uPresent;
uniform int uLayers;
uniform ivec3 uWireColors[5];
uniform int uWireBits[5];
uniform int uWireAlpha;
uniform ivec2 uWorldSize;
// The wire pieces (WiresNew) and the actuator in the atlas: (page, x, y, 1), or all 0 without that sheet.
uniform ivec4 uWireSheet;
uniform ivec4 uActuatorSheet;
flat in ivec4 vRect;
flat in int vLayer;
flat in int vCells;

// The CWM flags of the tile local (relative to the chunk's origin, apron included), 0 past the world's edges (the
// apron holds stale values there).
int flagsAt(ivec2 local) {
  ivec2 tile = vRect.xy + local;
  if (any(lessThan(tile, ivec2(0))) || any(greaterThanEqual(tile, uWorldSize))) return 0;
  ivec2 texel = ivec2(local.y + ${String(PAGE_APRON)}, local.x + ${String(PAGE_APRON)});
  return int(texelFetch(uPlanes16, ivec3(texel, vLayer * ${String(PLANE_COUNT_16)} + ${String(PLANES_16.flags)}), 0).r);
}

// The highest of bits 0–3 set in bits, -1 for none (GLSL ES 3.00 has no findMSB).
int highestBit(int bits) {
  return (bits & 8) != 0 ? 3 : (bits & 4) != 0 ? 2 : (bits & 2) != 0 ? 1 : (bits & 1) != 0 ? 0 : -1;
}

// The wires (bits 0–3 of wires) and actuator (bit 4) of a tile at sprite pixel sub, straight alpha; up, right, down
// and left are the flags of its side neighbours.
ivec4 wirePixel(int wires, int up, int right, int down, int left, ivec2 sub) {
  ivec4 color = ivec4(0);
  // Runtime bounds (up to the topmost colour drawn): the loop stays a loop, so the shader stays small.
  int last = highestBit(wires & 15);
  for (int k = 0; k <= last; k++) {
    int bit = 1 << k;
    if ((wires & bit) == 0) continue;
    int column = ((up & bit) != 0 ? 1 : 0) | ((right & bit) != 0 ? 2 : 0) | ((down & bit) != 0 ? 4 : 0) | ((left & bit) != 0 ? 8 : 0);
    ivec2 pixel = ivec2(column, k) * ${String(WIRE_CELL_STRIDE)} + sub;
    color = over(ivec4(round(atlasTexel(uWireSheet.yz, uWireSheet.yz + pixel, uWireSheet.x) * 255.0)), color);
  }
  if ((wires & 16) != 0) {
    ivec4 actuator = uActuatorSheet.w != 0
      ? ivec4(round(atlasTexel(uActuatorSheet.yz, uActuatorSheet.yz + sub, uActuatorSheet.x) * 255.0))
      : ivec4(uWireColors[4], uWireAlpha);
    color = over(actuator, color);
  }
  return color;
}

void main() {
  vec2 world = worldSpritePixel() / ${String(SPRITE_TILE_PIXELS)}.0;
  ivec2 local = clamp(ivec2(floor(world)) - vRect.xy, ivec2(0), vRect.zw - 1);
  vec2 centre = clamp((world - vec2(vRect.xy + local)) * ${String(SPRITE_TILE_PIXELS)}.0, vec2(0.0), vec2(${String(SPRITE_TILE_PIXELS)}.0));
  int shown = (uLayers >> 4) & 31;
  int wires = (uPresent & ${String(PRESENT.flags)}) != 0 ? flagsAt(local) & shown : 0;
  if (wires == 0) discard;
  ivec3 wire = ivec3(0);
  for (int i = 4; i >= 0; i--) {
    if ((wires & uWireBits[i]) != 0) wire = uWireColors[i];
  }
  // The overlay, faded out as the sprites fade in (premultiplied, for blending with one, one minus source alpha).
  float fade = uWireSheet.w != 0 ? float(uSpriteWeight) / 256.0 : 0.0;
  vec4 overlay = vec4(vec3(wire) / 255.0, 1.0) * (float(uWireAlpha) / 255.0) * (1.0 - fade);
  vec4 sprite = vec4(0.0);
  if (fade > 0.0) {
    int up = flagsAt(local - ivec2(0, 1));
    int down = flagsAt(local + ivec2(0, 1));
    int left = flagsAt(local - ivec2(1, 0));
    int right = flagsAt(local + ivec2(1, 0));
    int count = uSpriteSamples;
    ivec4 sum = ivec4(0);
    for (int y = 0; y < count; y++) {
      for (int x = 0; x < count; x++) {
        ivec4 sampled = wirePixel(wires, up, right, down, left, samplePixelIn(centre, ivec2(${String(SPRITE_TILE_PIXELS)}), x, y));
        sum += ivec4(sampled.rgb * sampled.a, sampled.a);
      }
    }
    int samples = count * count;
    if (sum.a > 0) {
      ivec4 mean = ivec4((2 * sum.rgb + sum.a) / (2 * sum.a), (2 * sum.a + samples) / (2 * samples));
      sprite = vec4(vec3(mean.rgb) / 255.0, 1.0) * (float(mean.a) / 255.0) * fade;
    }
  }
  vec4 color = overlay + sprite;
  if (color.a <= 0.0) discard;
  outColor = color;
}
`;
