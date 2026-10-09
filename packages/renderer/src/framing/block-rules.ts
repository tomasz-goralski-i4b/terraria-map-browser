/**
 * The block layout's cell choice (docs/assets.md, "Measuring the sheet" and "Choosing the cell"): the measured side
 * code of every cell of the stone sheet, and the steps that pick a look from the letters of the eight neighbours.
 *
 * Letters are numbers: AIR (`x`, absent or a seam), OWN (`o`, like itself or a connecting relative), PARTNER (`d`).
 * A side code is N·27 + E·9 + S·3 + W, a corner code NW·27 + NE·9 + SE·3 + SW. Cells are packed as column·64 + row.
 */

export const AIR = 0;
export const OWN = 1;
export const PARTNER = 2;

/** The side code `NESW` of every cell of `Tiles_1` (S), rows 0–14; `----` marks an empty cell. */
const SHEET_MAP = [
  "ooox xooo xooo xooo oxoo oxox xxox xxox xxox xoxx oooo oooo xxxo xodo xodo xodo",
  "ooox oooo oooo oooo oxoo oxox oooo oooo oooo xoxx oooo oooo xxxo doxo doxo doxo",
  "ooox ooxo ooxo ooxo oxoo oxox oooo oooo oooo xoxx oooo oooo xxxo odox odox odox",
  "xoox xxoo xoox xxoo xoox xxoo oxxx oxxx oxxx xxxx xxxx xxxx ---- oxod oxod oxod",
  "ooxx oxxo ooxx oxxo ooxx oxxo xoxo xoxo xoxo ---- ---- ---- ---- ---- ---- ----",
  "oooo oooo dood ddoo oodx oxdo xxdx oxdx oodo oodo oodo ddod dodd ---- ---- ----",
  "oooo oooo oodd oddo oodx oxdo xxdx oxdx dooo dooo dooo ddod dodd ---- ---- ----",
  "oooo oooo dood ddoo oodx oxdo xxdx oxdx odoo oood odod ddod dodd ---- ---- ----",
  "oooo oooo oodd oddo doox dxoo dxxx dxox odoo oood odod oddd dddo ---- ---- ----",
  "oooo oooo dood ddoo doox dxoo dxxx dxox odoo oood odod oddd dddo ---- ---- ----",
  "oooo oooo oodd oddo doox dxoo dxxx dxox dodo dodo dodo oddd dddo ---- ---- ----",
  "xood xood xood xdoo xdoo xdoo dddd dddd dddd xdxd xdxd xdxd ---- ---- ---- ----",
  "ooxd ooxd ooxd odxo odxo odxo dxdx ---- ---- ---- ---- ---- ---- ---- ---- ----",
  "xxxd xxxd xxxd xdxx xdxx xdxx dxdx ---- ---- ---- ---- ---- ---- ---- ---- ----",
  "xoxd xoxd xoxd xdxo xdxo xdxo dxdx ---- ---- ---- ---- ---- ---- ---- ---- ----",
] as const;

/** The nine interior looks (corners NW NE SE SW) in the order step 2 walks them, each with its variant-0 cell. */
const INTERIOR_ORDER: readonly (readonly [corners: string, column: number, row: number])[] = [
  ["oodo", 0, 5], ["oood", 1, 5], ["odoo", 0, 6], ["dooo", 1, 6],
  ["ooxx", 6, 2], ["xxoo", 6, 1], ["oxxo", 11, 0], ["xoox", 10, 0], ["oooo", 1, 1],
];

const NOTCHES_NW_NE = 6 * 64 + 1;

const letterOf = (char: string): number => (char === "o" ? OWN : char === "d" ? PARTNER : AIR);

function codeOf(letters: string): number {
  let code = 0;
  for (const char of letters) code = code * 3 + letterOf(char);
  return code;
}

/** Packed cell → side code (−1: empty or outside the map). */
const sidesByCell = new Int8Array(64 * 64).fill(-1);
/** Side code → its variant-0 cell, the first in reading order (−1: no cell). */
const cellBySides = new Int16Array(81).fill(-1);
for (let row = 0; row < SHEET_MAP.length; row++) {
  const looks = SHEET_MAP[row]?.split(" ") ?? [];
  looks.forEach((look, column) => {
    if (look === "----") return;
    const sides = codeOf(look);
    sidesByCell[column * 64 + row] = sides;
    if (look !== "oooo" && cellBySides[sides] === -1) cellBySides[sides] = column * 64 + row;
  });
}

/** Corner code → the interior cell of step 2. */
const cellByCorners = new Int16Array(81);
for (let corners = 0; corners < 81; corners++) {
  const wanted = [27, 9, 3, 1].map((scale) => Math.floor(corners / scale) % 3);
  if (wanted.every((letter) => letter === AIR)) {
    cellByCorners[corners] = NOTCHES_NW_NE;
    continue;
  }
  const look = INTERIOR_ORDER.find(([pattern]) =>
    wanted.every((letter, k) => pattern.charAt(k) === "o" || letterOf(pattern.charAt(k)) === letter));
  // The plain interior has no non-`o` corner, so the walk always ends on it.
  cellByCorners[corners] = look === undefined ? 1 * 64 + 1 : look[1] * 64 + look[2];
}

const ALL_OWN = codeOf("oooo");

/** `code` with every PARTNER letter turned into AIR (step 1's fallback). */
function withoutRims(code: number): number {
  let result = 0;
  for (let scale = 27; scale >= 1; scale /= 3) {
    const letter = Math.floor(code / scale) % 3;
    result += (letter === PARTNER ? AIR : letter) * scale;
  }
  return result;
}

/** Steps 1 and 2 of "Choosing the cell": the variant-0 cell (packed) of a block-layout tile. */
export function chooseBlockCell(sides: number, corners: number): number {
  if (sides === ALL_OWN) return cellByCorners[corners] ?? NOTCHES_NW_NE;
  const cell = cellBySides[sides] ?? -1;
  // All 16 codes without PARTNER have a cell, so the fallback always finds one.
  return cell !== -1 ? cell : cellBySides[withoutRims(sides)] ?? -1;
}

/** The letter (AIR, OWN or PARTNER) of a block-layout cell's side `side` (0 N, 1 E, 2 S, 3 W); −1 when unknown. */
export function cellSide(cell: number, side: number): number {
  const sides = cell < 0 || cell >= sidesByCell.length ? -1 : sidesByCell[cell] ?? -1;
  return sides === -1 ? -1 : Math.floor(sides / 3 ** (3 - side)) % 3;
}
