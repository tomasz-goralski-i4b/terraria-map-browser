// Liquid sprite rules (docs/assets.md, "Liquids"): the sheet of each liquid kind, the fill height of a liquid amount
// and the sheet row a sprite pixel of a liquid tile reads.
import { describe, expect, test } from "vitest";
import { LIQUID_BODY_ROW, LIQUID_SHEETS, LIQUID_SPRITE_ALPHA, liquidFillPixels, LIQUID_BLEED, liquidBleed, shimmerPixel, liquidHasSurface, liquidSheetRow, shapedTileLiquid } from "../src/index.js";

describe("liquid sprites", () => {
  test("water, lava and honey draw from Liquid_0, Liquid_1 and Liquid_11; shimmer is drawn flat in its map colour", () => {
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

  test("a half block or slope without liquid of its own holds the liquid flowing in from above or its sides", () => {
    const none = { kind: 0, amount: 0 };
    // Liquid above fills the tile, under liquid (no surface).
    expect(shapedTileLiquid({ kind: 1, amount: 40 }, none, none)).toEqual({ kind: 1, amount: 255, surface: false });
    // Otherwise the fuller side neighbour, at its level, with the surface; the left one on a tie.
    expect(shapedTileLiquid(none, { kind: 1, amount: 127 }, { kind: 2, amount: 200 })).toEqual({ kind: 2, amount: 200, surface: true });
    expect(shapedTileLiquid(none, { kind: 3, amount: 90 }, { kind: 1, amount: 90 })).toEqual({ kind: 3, amount: 90, surface: true });
    expect(shapedTileLiquid(none, none, none)).toBeNull();
  });

  test("a block beside or below liquid shows it in its edge pixels next to it, under its sprite", () => {
    const none = { kind: 0, amount: 0 };
    const water = { kind: 1, amount: 255 };
    const half = { kind: 2, amount: 127 };
    // The block art is transparent up to 2 rows deep at its edges (G: in the game no air shows there).
    expect(LIQUID_BLEED).toBe(2);
    // Liquid above reaches into the top rows, full.
    expect(liquidBleed(5, 0, water, none, none)).toEqual({ side: "above", kind: 1, amount: 255 });
    expect(liquidBleed(5, LIQUID_BLEED, water, none, none)).toBeNull();
    // Liquid beside reaches into the columns next to it at its own level.
    expect(liquidBleed(0, 9, none, half, none)).toEqual({ side: "left", kind: 2, amount: 127 });
    expect(liquidBleed(15, 9, none, none, water)).toEqual({ side: "right", kind: 1, amount: 255 });
    expect(liquidBleed(LIQUID_BLEED, 9, none, half, none)).toBeNull();
    expect(liquidBleed(7, 7, water, water, water)).toBeNull();
  });

  test("shimmer shows its measured surface rows, body and sparkles (G: in-game screenshot)", () => {
    expect(shimmerPixel(0, 3, 5)).toEqual([163, 118, 246]);
    expect(shimmerPixel(1, 3, 5)).toEqual([234, 108, 255]);
    expect(shimmerPixel(3, 3, 5)).toEqual([199, 108, 255]);
    // The body, except at its sparkles: about one pixel in 61, the same at every frame.
    let sparkles = 0;
    for (let y = 0; y < 61; y++) for (let x = 0; x < 61; x++) {
      const pixel = shimmerPixel(8, x, y);
      if (pixel.join() === "154,109,233") continue;
      expect(pixel).toEqual([222, 178, 255]);
      sparkles++;
    }
    expect(sparkles).toBeGreaterThan(30);
    expect(sparkles).toBeLessThan(100);
  });

  test("a liquid has its surface unless the tile above holds liquid, its own or flowing into its shape", () => {
    const none = { kind: 0, amount: 0 };
    const water = { kind: 1, amount: 255 };
    // Liquid above: no surface.
    expect(liquidHasSurface(water, 0, none, none, none)).toBe(false);
    // Air above: surface.
    expect(liquidHasSurface(none, 0, water, water, water)).toBe(true);
    // A slope above holding the liquid beside it: no surface; a dry slope above: surface.
    expect(liquidHasSurface(none, 2, none, water, none)).toBe(false);
    expect(liquidHasSurface(none, 2, none, none, none)).toBe(true);
  });
});
