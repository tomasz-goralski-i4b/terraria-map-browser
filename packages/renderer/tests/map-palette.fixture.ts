import type { MapPalette } from "../src/index.js";

/**
 * Authored synthetic colours (not taken from the game): tile 1 has two map options chosen by frameX (option 1 for
 * frameX 18–35), tile 3 three chosen by frameY (option 1 for 36–71, option 2 for 72–107), tile 2 and wall 0 have none,
 * the sky runs from (0, 0, 255) at the top to (0, 255, 255) at the surface, and paint 1 is red, 2 orange, 25 dark grey.
 */
export const syntheticMapPalette: MapPalette = {
  gameVersion: "0.0.0-synthetic",
  tiles: [[0x76583e], [0x6c7078, 0x60666e], [], [0x112233, 0x445566, 0x778899]],
  tileOptions: {
    1: { axis: "frameX", ranges: [[18, 35, 1]] },
    3: { axis: "frameY", ranges: [[36, 71, 1], [72, 107, 2]] },
  },
  walls: [[], [0x52565c]],
  liquids: [0x2068d2, 0xe44418, 0xdea424, 0x9854d8],
  background: { sky: Array.from({ length: 256 }, (_, index) => (index << 8) | 0xff), dirt: 0x5a3c28, rock: 0x464646, hell: 0x321414 },
  paints: Array.from({ length: 32 }, (_, id) => ({ 1: 0xff0000, 2: 0xff7f00, 25: 0x4b4b4b } as Record<number, number>)[id] ?? 0xffffff),
};
