import { describe, expect, test } from "vitest";
import { inactiveSpriteColor, spritePaintedColor } from "../src/index.js";

type Rgb = readonly [number, number, number];

/** Inputs of the samples below: a muted, a dark and a saturated colour. */
const INPUTS: readonly Rgb[] = [[85, 170, 136], [51, 34, 17], [255, 238, 0]];

/**
 * What the game's tile shader made of INPUTS under each paint (scripts/sprite-paint/observe.ps1, docs/assets.md,
 * "Paint"): [paint, layer, outputs].
 */
const OBSERVED: readonly (readonly [number, "block" | "wall", readonly Rgb[]])[] = [
  [1, "block", [[170, 85, 85], [51, 17, 17], [255, 0, 0]]],
  [2, "block", [[170, 128, 85], [51, 34, 17], [255, 128, 0]]],
  [3, "block", [[170, 170, 85], [51, 51, 17], [255, 255, 0]]],
  [4, "block", [[128, 170, 85], [34, 51, 17], [128, 255, 0]]],
  [5, "block", [[85, 170, 85], [17, 51, 17], [0, 255, 0]]],
  [6, "block", [[85, 170, 128], [17, 51, 34], [0, 255, 128]]],
  [7, "block", [[85, 170, 170], [17, 51, 51], [0, 255, 255]]],
  [8, "block", [[85, 128, 170], [17, 34, 51], [0, 128, 255]]],
  [9, "block", [[85, 85, 170], [17, 17, 51], [0, 0, 255]]],
  [10, "block", [[128, 85, 170], [34, 17, 51], [128, 0, 255]]],
  [11, "block", [[170, 85, 170], [51, 17, 51], [255, 0, 255]]],
  [12, "block", [[170, 85, 128], [51, 17, 34], [255, 0, 128]]],
  [13, "block", [[170, 34, 34], [51, 7, 7], [255, 0, 0]]],
  [14, "block", [[170, 102, 34], [51, 29, 7], [255, 128, 0]]],
  [15, "block", [[170, 170, 34], [51, 51, 7], [255, 255, 0]]],
  [16, "block", [[102, 170, 34], [29, 51, 7], [128, 255, 0]]],
  [17, "block", [[34, 170, 34], [7, 51, 7], [0, 255, 0]]],
  [18, "block", [[34, 170, 102], [7, 51, 29], [0, 255, 128]]],
  [19, "block", [[34, 170, 170], [7, 51, 51], [0, 255, 255]]],
  [20, "block", [[34, 102, 170], [7, 29, 51], [0, 128, 255]]],
  [21, "block", [[34, 34, 170], [7, 7, 51], [0, 0, 255]]],
  [22, "block", [[102, 34, 170], [29, 7, 51], [128, 0, 255]]],
  [23, "block", [[170, 34, 170], [51, 7, 51], [255, 0, 255]]],
  [24, "block", [[170, 34, 102], [51, 7, 29], [255, 0, 128]]],
  [25, "block", [[38, 38, 38], [10, 10, 10], [38, 38, 38]]],
  [26, "block", [[217, 217, 217], [76, 76, 76], [255, 255, 255]]],
  [27, "block", [[128, 128, 128], [34, 34, 34], [128, 128, 128]]],
  [28, "block", [[170, 119, 83], [51, 36, 25], [255, 178, 125]]],
  [29, "block", [[6, 6, 6], [2, 2, 2], [6, 6, 6]]],
  [30, "block", [[170, 85, 119], [204, 221, 238], [0, 17, 255]]],
  [31, "block", INPUTS],
  [30, "wall", [[21, 0, 0], [89, 123, 157], [0, 0, 191]]],
];

describe("sprite paint", () => {
  test.each(OBSERVED)("paint %i on a %s sprite matches the game's tile shader within one step", (paint, layer, outputs) => {
    INPUTS.forEach((input, index) => {
      const actual = spritePaintedColor(input, paint, layer);
      const expected = outputs[index] ?? [0, 0, 0];
      for (let channel = 0; channel < 3; channel++) {
        expect(Math.abs((actual[channel] ?? 0) - (expected[channel] ?? 0)), `${input.join(",")} → ${actual.join(",")}`).toBeLessThanOrEqual(1);
      }
    });
  });

  test("unpainted sprites, unknown paints and black under negative paint keep their colour", () => {
    expect(spritePaintedColor([85, 170, 136], 0, "block")).toEqual([85, 170, 136]);
    expect(spritePaintedColor([85, 170, 136], 99, "wall")).toEqual([85, 170, 136]);
    expect(spritePaintedColor([0, 0, 0], 30, "block")).toEqual([0, 0, 0]);
    expect(spritePaintedColor([0, 0, 0], 30, "wall")).toEqual([0, 0, 0]);
  });

  test("an inactive (actuated) tile's sprite is drawn at 102/255 of its colour, as the game shades it", () => {
    expect(inactiveSpriteColor([255, 255, 255])).toEqual([102, 102, 102]);
    expect(inactiveSpriteColor([100, 150, 200])).toEqual([40, 60, 80]);
  });
});
