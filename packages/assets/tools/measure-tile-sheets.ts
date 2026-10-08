// Prints the measured look of every cell of a block sheet from the user's own Terraria install
// (docs/assets.md, "Tile framing" → "Measuring the sheet"). Output goes to the terminal only; nothing is written.
//
//   pnpm --filter @studio/assets build
//   node packages/assets/tools/measure-tile-sheets.ts --content "<Terraria>/Content" --tile 1 --partner 0 --compare 7
//
// --content defaults to TERRARIA_CONTENT. Partner colours, at most one of:
//   --partner <id>        every colour of Tiles_<id>, matched exactly;
//   --partner-near <id>   the colours of Tiles_<id> except its outline, matched within --tolerance (default 8);
//   --partner self        the colours the sheet uses only outside the rim-free block (columns 0–12, rows 0–4).
// --notch r,g,b (repeatable) adds notch colours (dirt: 191,143,111 and 169,125,93). --rows <n> measures n rows
// (default 15; grass and moss sheets have 22). --compare <id> (repeatable) lists the cells whose look differs.
// --agree <id> (repeatable) tests whether Tiles_<id> shares the measured layout (layoutAgreement).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readXnbTexture } from "@studio/assets";
import {
  SELF_REGION,
  coloursOutside,
  compareLooks,
  formatSheetMap,
  groupLooks,
  layoutAgreement,
  measureSheet,
  missingRimCodes,
  nearColours,
  sheetColours,
  type MeasureOptions,
  type SheetPixels,
} from "./sheet-measure.ts";

const { values } = parseArgs({
  options: {
    content: { type: "string" },
    tile: { type: "string" },
    partner: { type: "string" },
    "partner-near": { type: "string" },
    tolerance: { type: "string" },
    notch: { type: "string", multiple: true },
    rows: { type: "string" },
    compare: { type: "string", multiple: true },
    agree: { type: "string", multiple: true },
  },
});

const content = values.content ?? process.env["TERRARIA_CONTENT"];
if (content === undefined || values.tile === undefined) {
  console.error(
    "usage: measure-tile-sheets.ts --content <Terraria/Content> --tile <id> [--partner <id>|self | --partner-near <id> [--tolerance <n>]] [--notch r,g,b]… [--rows <n>] [--compare <id>]… [--agree <id>]…",
  );
  process.exit(2);
}

function load(id: string): SheetPixels {
  return readXnbTexture(new Uint8Array(readFileSync(join(content ?? "", "Images", `Tiles_${id}.xnb`))));
}

const rows = values.rows === undefined ? 15 : Number(values.rows);

function partnerFor(sheet: SheetPixels): ReadonlySet<string> | undefined {
  if (values.partner === "self") return coloursOutside(sheet, SELF_REGION);
  if (values.partner !== undefined) return sheetColours(load(values.partner));
  if (values["partner-near"] !== undefined) {
    const partner = load(values["partner-near"]);
    const outline = new Set(measureSheet(partner).outlineColours);
    const body = new Set([...sheetColours(partner)].filter((colour) => !outline.has(colour)));
    return nearColours(sheet, body, values.tolerance === undefined ? 8 : Number(values.tolerance));
  }
  return undefined;
}

function optionsFor(sheet: SheetPixels): MeasureOptions {
  const partnerColours = partnerFor(sheet);
  return {
    rows,
    ...(partnerColours === undefined ? {} : { partnerColours }),
    ...(values.notch === undefined ? {} : { notchColours: new Set(values.notch) }),
  };
}

const sheet = load(values.tile);
const result = measureSheet(sheet, optionsFor(sheet));
const looks = groupLooks(result.cells);
const rimCodes = new Set(result.cells.map((cell) => cell.sides).filter((sides) => sides.includes("d")));

console.log(`Tiles_${values.tile}: ${String(sheet.width)} × ${String(sheet.height)}`);
console.log(`outline colours: ${result.outlineColours.join("  ") || "(none)"}`);
console.log(`non-empty cells: ${String(result.cells.length)}, looks: ${String(looks.size)}, rim side codes: ${String(rimCodes.size)}`);
console.log(`looks without exactly 3 cells: ${[...looks].filter(([, cells]) => cells.length !== 3).map(([look, cells]) => `${look}×${String(cells.length)}`).join(" ") || "(none)"}`);
console.log(`rim side codes without a cell (${String(missingRimCodes(result.cells).length)}): ${missingRimCodes(result.cells).join(" ")}`);
console.log("\nsheet map (sides NESW):");
console.log(formatSheetMap(result.cells, rows));
console.log("\nall-open looks (corners NW NE SE SW → cells v0 v1 v2):");
for (const [look, cells] of looks)
  if (look.startsWith("oooo/"))
    console.log(`  ${look.slice(5)}  ${cells.map((cell) => `(${String(cell.column)},${String(cell.row)})`).join(" ")}`);

for (const other of values.compare ?? []) {
  const otherSheet = load(other);
  const differences = compareLooks(result.cells, measureSheet(otherSheet, optionsFor(otherSheet)).cells);
  console.log(`\ncompare with Tiles_${other}: ${String(differences.length)} cells differ`);
  for (const difference of differences) console.log(`  ${difference}`);
}

for (const other of values.agree ?? []) {
  const otherSheet = load(other);
  const agreement = layoutAgreement(otherSheet, result.cells);
  console.log(
    `\nagreement of Tiles_${other} (${String(otherSheet.width)} × ${String(otherSheet.height)}): ${String(agreement.agreeing)}/${String(agreement.total)} sides`,
  );
  if (agreement.disagreements.length > 0) console.log(`  ${agreement.disagreements.join(" ")}`);
}
