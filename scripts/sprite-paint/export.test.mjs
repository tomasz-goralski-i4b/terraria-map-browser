// The sprite paint exporter on a small synthetic observation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STYLES, paintGroups } from "./export.mjs";

const plain = { UseSpecialGroups: false, SpecialGroupMinimalHueValue: 0, SpecialGroupMaximumHueValue: 0, SpecialGroupMinimumSaturationValue: 0, SpecialGroupMaximumSaturationValue: 0, HueTestOffset: 0, InvertSpecialGroupResult: false };
const leaves = { ...plain, UseSpecialGroups: true, SpecialGroupMinimalHueValue: 0.2, SpecialGroupMaximumHueValue: 0.8, SpecialGroupMaximumSaturationValue: 1 };
const dirt = { ...leaves, HueTestOffset: 0.5, InvertSpecialGroupResult: true };
const keys = (kind, id, styles) => styles.map((style) => `${kind}:${String(id)}:${String(style)}`);

test("special groups become numbered ranges; types keep one group, or one per style when it varies", () => {
  const data = paintGroups({
    gameVersion: "v1",
    groups: [
      { settings: plain, keys: [...keys("tile", 1, STYLES), ...keys("tile", 5, [0, 1, 2, 3, 4, 5, 6, 7, 8]), ...keys("foliage", 9, STYLES)] },
      { settings: leaves, keys: [...keys("tile", 5, [-1]), ...keys("foliage", 0, STYLES)] },
      { settings: dirt, keys: keys("tile", 2, STYLES) },
    ],
  });
  assert.deepEqual(data, {
    gameVersion: "v1",
    groups: [[0.2, 0.8, 0, 1, 0, 0], [0.2, 0.8, 0, 1, 0.5, 1]],
    tiles: [[2, 2], [5, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    foliage: [[0, 1]],
  });
});

test("an entry missing a style is refused", () => {
  assert.throws(() => paintGroups({ groups: [{ settings: leaves, keys: keys("tile", 5, [0]) }] }), /misses a style/);
});
