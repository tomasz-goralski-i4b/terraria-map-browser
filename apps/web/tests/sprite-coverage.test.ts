import { describe, expect, test } from "vitest";
import type { ContentRef } from "@studio/world-model";
import { contentWithoutSprite } from "../src/assets/sprite-coverage.js";

const ABSENT = 0xffff;

/** Column-major planes of one column: block palette index and frameX per tile (-1 = no stored frame). */
function planes(tiles: readonly (readonly [number, number])[]): { block: Uint16Array; frameX: Int16Array } {
  return {
    block: Uint16Array.from(tiles.map(([block]) => block)),
    frameX: Int16Array.from(tiles.map(([, frame]) => frame)),
  };
}

const palette: readonly ContentRef[] = [
  { kind: "vanilla", id: 21 }, // 0 chest: has a sheet
  { kind: "vanilla", id: 900 }, // 1 newer than the install: no sheet
  { kind: "mod", mod: "Calamity", internalName: "Relic" }, // 2 mod content
  { kind: "vanilla", id: 5 }, // 3 tree: deferred, keeps its map colour
  { kind: "vanilla", id: 1 }, // 4 stone: no stored frame
  { kind: "vanilla", id: 901 }, // 5 no sheet, but never placed with a frame
];

describe("contentWithoutSprite", () => {
  test("lists the content placed with a stored frame that has no sheet, once each, in palette order", () => {
    const world = planes([[0, 0], [1, 18], [2, 0], [1, 0], [3, 22], [4, -1], [5, -1], [ABSENT, -1]]);
    expect(contentWithoutSprite(world, palette, new Set([21, 5, 1]))).toEqual([palette[1], palette[2]]);
  });

  test("is empty when every framed content has a sheet, or the world stores no frames", () => {
    expect(contentWithoutSprite(planes([[0, 0], [4, -1]]), palette, new Set([21]))).toEqual([]);
    expect(contentWithoutSprite({ block: Uint16Array.from([1, 2]) }, palette, new Set())).toEqual([]);
  });
});
