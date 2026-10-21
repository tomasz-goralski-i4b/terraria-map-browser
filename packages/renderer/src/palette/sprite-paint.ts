// Paint and the inactive shade on sprites (docs/assets.md, "Paint"). Observed from the game's tile shader on
// synthetic colours (scripts/sprite-paint/observe.ps1); the rules are our own description of its results and are
// mirrored by spritePainted() and INACTIVE_SHADE in ../gpu/shaders.ts.

type Rgb = readonly [number, number, number];

const DEEP_PAINTS = 12;
const BLACK_PAINT = 25;
const WHITE_PAINT = 26;
const GRAY_PAINT = 27;
const BROWN_PAINT = 28;
const SHADOW_PAINT = 29;
const NEGATIVE_PAINT = 30;
/** Brown paint scales the brightest channel by these. */
const BROWN = [1, 0.7, 0.49] as const;
/** An inactive tile's sprite is drawn at this share (of 255) of its colour. */
export const INACTIVE_SPRITE_SHADE = 102;

const clamp = (value: number): number => Math.round(Math.min(255, Math.max(0, value)));
const grey = (value: number): Rgb => {
  const v = clamp(value);
  return [v, v, v];
};

/**
 * A sprite pixel's colour under paint `paint`, as the game draws painted tiles and walls. With max M and min m of the
 * channels: paints 1–12 keep the brightness and saturation and take hue 30° · (paint − 1); deep paints 13–24 do the
 * same with saturation 0.6 + 0.4 · S; black is 0.3 · L (L = (M + m) / 2), gray L, shadow 0.05 · L, white
 * (L + 0.2 (M − m)) (2 − L) on a 0–1 scale; brown M times (1, 0.7, 0.49); negative inverts (on walls 2 (1 − c) − 1.25,
 * clamped) except black. Paint 0, 31 (illuminant: no colour of its own) and unknown IDs leave the colour unchanged.
 */
export function spritePaintedColor(color: Rgb, paint: number, layer: "block" | "wall"): Rgb {
  const [red, green, blue] = color;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  if (paint >= 1 && paint <= 2 * DEEP_PAINTS) {
    // Hue replaced in HSV: a channel lies between `low` and the brightness by its distance from the hue.
    const low = paint > DEEP_PAINTS ? 0.4 * min : min;
    const hue = ((paint - 1) % DEEP_PAINTS) / 2;
    const channel = (n: number): number => {
      const k = (n + hue) % 6;
      const share = Math.max(0, Math.min(k, 4 - k, 1));
      return Math.round(max - (max - low) * share);
    };
    return [channel(5), channel(3), channel(1)];
  }
  const lightness = (max + min) / 2;
  switch (paint) {
    case BLACK_PAINT: return grey(0.3 * lightness);
    case WHITE_PAINT: return grey(((lightness + 0.2 * (max - min)) * (510 - lightness)) / 255);
    case GRAY_PAINT: return grey(lightness);
    case BROWN_PAINT: return [clamp(max * BROWN[0]), clamp(max * BROWN[1]), clamp(max * BROWN[2])];
    case SHADOW_PAINT: return grey(0.05 * lightness);
    case NEGATIVE_PAINT: {
      if (max === 0) return color;
      const invert = (value: number): number => (layer === "wall" ? clamp(2 * (255 - value) - 318.75) : 255 - value);
      return [invert(red), invert(green), invert(blue)];
    }
    default: return color;
  }
}

/** An inactive (actuated) tile's sprite pixel: its colour at INACTIVE_SPRITE_SHADE / 255. */
export function inactiveSpriteColor(color: Rgb): Rgb {
  const [red, green, blue] = color;
  const shade = (value: number): number => Math.round((value * INACTIVE_SPRITE_SHADE) / 255);
  return [shade(red), shade(green), shade(blue)];
}
