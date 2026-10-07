import type { MapPalette } from "../src/index.js";

/** Authored synthetic colours (not taken from the game): tile 1 has two map options, tile 2 and wall 0 have none. */
export const syntheticMapPalette: MapPalette = {
  gameVersion: "0.0.0-synthetic",
  tiles: [[0x76583e], [0x6c7078, 0x60666e], []],
  walls: [[], [0x52565c]],
  liquids: [0x2068d2, 0xe44418, 0xdea424, 0x9854d8],
};
