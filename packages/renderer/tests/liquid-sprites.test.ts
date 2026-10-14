// Liquid sprite rules (docs/assets.md, "Liquids"): the sheet of each liquid kind, the fill height of a liquid amount
// and the sheet row a sprite pixel of a liquid tile reads.
import { describe, expect, test } from "vitest";
import { LIQUID_BODY_ROW, LIQUID_SHEETS, LIQUID_SPRITE_ALPHA, liquidFillPixels, liquidSheetRow } from "../src/index.js";

describe("liquid sprites", () => {
  test("water, lava and honey draw from Liquid_0, Liquid_1 and Liquid_11; shimmer keeps its map colour", () => {
    expect(LIQUID_SHEETS).toEqual([0, 1, 11, null]);
    expect(LIQUID_SPRITE_ALPHA.length).toBe(4);
    for (const alpha of LIQUID_SPRITE_ALPHA) expect(alpha).toBeGreaterThan(0);
  });

  test("the fill height rounds the amount up to whole pixels of the 16-pixel tile", () => {
    expect(liquidFillPixels(0)).toBe(0);
    expect(liquidFillPixels(1)).toBe(1);
    expect(liquidFillPixels(127)).toBe(8);
    expect(liquidFillPixels(128)).toBe(9);
    expect(liquidFillPixels(255)).toBe(16);
  });

  test("a surface tile shows the frame from its top row at the liquid's top; a covered one only the body rows", () => {
    // Half full (8 px): nothing above row 8.
    expect(liquidSheetRow(7, 8, true)).toBeNull();
    expect(liquidSheetRow(8, 8, true)).toBe(0);
    expect(liquidSheetRow(15, 8, true)).toBe(7);
    // Full and covered by liquid: the body rows from LIQUID_BODY_ROW, repeated.
    expect(LIQUID_BODY_ROW).toBe(4);
    expect(liquidSheetRow(0, 16, false)).toBe(4);
    expect(liquidSheetRow(11, 16, false)).toBe(15);
    expect(liquidSheetRow(12, 16, false)).toBe(4);
    expect(liquidSheetRow(15, 16, false)).toBe(7);
  });
});
