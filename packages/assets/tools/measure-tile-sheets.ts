// Prints the measured look of every cell of a block sheet from the user's own Terraria install
// (docs/assets.md, "Tile framing" → "Measuring the sheet"). Output goes to the terminal only; nothing is written.
//
//   pnpm --filter @studio/assets build
//   node packages/assets/tools/measure-tile-sheets.ts --content "<Terraria>/Content" --tile 1 --partner 0 --compare 7
//
// --content defaults to TERRARIA_CONTENT. --notch r,g,b (repeatable) adds notch colours (dirt: 191,143,111 and
// 169,125,93).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readXnbTexture } from "@studio/assets";
import {
  compareLooks,
  formatSheetMap,
  groupLooks,
  measureSheet,
  missingRimCodes,
  sheetColours,
  type MeasureOptions,
  type SheetPixels,
} from "./sheet-measure.ts";

const { values } = parseArgs({
  options: {
    content: { type: "string" },
    tile: { type: "string" },
    partner: { type: "string" },
    notch: { type: "string", multiple: true },
    compare: { type: "string", multiple: true },
  },
});

const content = values.content ?? process.env["TERRARIA_CONTENT"];
if (content === undefined || values.tile === undefined) {
  console.error("usage: measure-tile-sheets.ts --content <Terraria/Content> --tile <id> [--partner <id>] [--notch r,g,b]… [--compare <id>]…");
  process.exit(2);
}

function load(id: string): SheetPixels {
  return readXnbTexture(new Uint8Array(readFileSync(join(content ?? "", "Images", `Tiles_${id}.xnb`))));
}

const options: MeasureOptions = {
  ...(values.partner === undefined ? {} : { partnerColours: sheetColours(load(values.partner)) }),
  ...(values.notch === undefined ? {} : { notchColours: new Set(values.notch) }),
};
const sheet = load(values.tile);
const result = measureSheet(sheet, options);
const looks = groupLooks(result.cells);
const rimCodes = new Set(result.cells.map((cell) => cell.sides).filter((sides) => sides.includes("d")));

console.log(`Tiles_${values.tile}: ${String(sheet.width)} × ${String(sheet.height)}`);
console.log(`outline colours: ${result.outlineColours.join("  ") || "(none)"}`);
console.log(`non-empty cells: ${String(result.cells.length)}, looks: ${String(looks.size)}, rim side codes: ${String(rimCodes.size)}`);
console.log(`looks without exactly 3 cells: ${[...looks].filter(([, cells]) => cells.length !== 3).map(([look, cells]) => `${look}×${String(cells.length)}`).join(" ") || "(none)"}`);
console.log(`rim side codes without a cell (${String(missingRimCodes(result.cells).length)}): ${missingRimCodes(result.cells).join(" ")}`);
console.log("\nsheet map (sides NESW):");
console.log(formatSheetMap(result.cells));
console.log("\nall-open looks (corners NW NE SE SW → cells v0 v1 v2):");
for (const [look, cells] of looks)
  if (look.startsWith("oooo/"))
    console.log(`  ${look.slice(5)}  ${cells.map((cell) => `(${String(cell.column)},${String(cell.row)})`).join(" ")}`);

for (const other of values.compare ?? []) {
  const differences = compareLooks(result.cells, measureSheet(load(other), options).cells);
  console.log(`\ncompare with Tiles_${other}: ${String(differences.length)} cells differ`);
  for (const difference of differences) console.log(`  ${difference}`);
}
