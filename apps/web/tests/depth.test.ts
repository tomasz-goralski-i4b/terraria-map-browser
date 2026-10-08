import { expect, test } from "vitest";
import { depthLabel } from "../src/world/depth.js";

const world = { height: 1200, surfaceLevel: 300, rockLevel: 450 };

test.each([
  [0, "sky"],
  [99, "sky"],
  [100, "surface"],
  [299, "surface"],
  [300, "underground"],
  [449, "underground"],
  [450, "caverns"],
  [999, "caverns"],
  [1000, "underworld"],
  [1199, "underworld"],
] as const)("row %i is in the %s band", (y, label) => {
  expect(depthLabel(y, world)).toBe(label);
});

test("fractional levels are compared as stored", () => {
  expect(depthLabel(300, { ...world, surfaceLevel: 300.5 })).toBe("surface");
  expect(depthLabel(301, { ...world, surfaceLevel: 300.5 })).toBe("underground");
});
