// Turns the output of observe.ps1 into answers to the open framing questions of docs/assets.md ("Tile framing"):
//   node scripts/framing/analyse.mjs <observed.json> [report.md]
// Pure functions over the observation (exported for observe.test.mjs) plus a Markdown report. Cells are
// (column, row) in units of 18 pixels, the convention of docs/assets.md. Nothing here is committed output.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Neighbour order of the exhaustive codes in observe.ps1: NW, N, NE, W, E, SW, S, SE. */
export const NEIGHBOURS = ["NW", "N", "NE", "W", "E", "SW", "S", "SE"];
/** Letters of a neighbour digit, as the viewer contract writes them for a centre and one other type. */
const DIGITS = ["x", "o", "d"];

/** The code of a neighbourhood given its digit per neighbour (0 air, 1 the centre's type, 2 the other type). */
export function codeOf(digits) {
  return digits.reduce((code, digit, index) => code + digit * 3 ** index, 0);
}

/** The cells of one exhaustively observed pair, by code: `[column, row]` plus the type when framing changed it. */
export function cellsOf(pair) {
  return pair.cells.split(";").map((cell) => {
    const [column, row, type] = cell.split(",");
    return { column: Number(column), row: Number(row), ...(type === undefined ? {} : { type: Number(type.slice(1)) }) };
  });
}

export function pairOf(observed, centre, other) {
  const pair = observed.neighbourhoods.find((entry) => entry.centre === centre && entry.other === other);
  if (pair === undefined) throw new Error(`no neighbourhoods observed for ${String(centre)} with ${String(other)}`);
  return cellsOf(pair);
}

const key = ({ column, row }) => `(${String(column)},${String(row)})`;

/** Digits for sides N, E, S, W and corners NW, NE, SE, SW, in the observer's order. */
function digitsFor(sides, corners) {
  const [n, e, s, w] = sides;
  const [nw, ne, se, sw] = corners;
  return [nw, n, ne, w, e, sw, s, se];
}

/** Side code letters NESW of four digits. */
const sideCode = (sides) => sides.map((digit) => DIGITS[digit]).join("");

/**
 * The missing-rim fallback (O3, step 1): for a centre whose corners are all its own type, every side code with a
 * `d`. The fallback held when the cell equals the cell of the same code with every `d` turned into `x`.
 */
export function rimFallback(observed, centre, other) {
  const cells = pairOf(observed, centre, other);
  const result = [];
  for (let code = 0; code < 81; code++) {
    const sides = [0, 1, 2, 3].map((index) => Math.floor(code / 3 ** index) % 3);
    if (!sides.includes(2)) continue;
    const cell = cells[codeOf(digitsFor(sides, [1, 1, 1, 1]))];
    const fallback = cells[codeOf(digitsFor(sides.map((digit) => (digit === 2 ? 0 : digit)), [1, 1, 1, 1]))];
    if (cell === undefined || fallback === undefined) continue;
    result.push({ sides: sideCode(sides), cell: key(cell), fellBack: key(cell) === key(fallback) });
  }
  return result;
}

/** Corner looks for sides `oooo` (O3, step 2): every combination of corner digits from `alphabet`. */
export function cornerLooks(observed, centre, other, alphabet) {
  const cells = pairOf(observed, centre, other);
  const result = [];
  const combinations = alphabet.length ** 4;
  for (let index = 0; index < combinations; index++) {
    const corners = [0, 1, 2, 3].map((position) => alphabet[Math.floor(index / alphabet.length ** position) % alphabet.length] ?? 0);
    const cell = cells[codeOf(digitsFor([1, 1, 1, 1], corners))];
    if (cell === undefined) continue;
    result.push({ corners: ["NW", "NE", "SE", "SW"].map((name, position) => `${name}${DIGITS[corners[position] ?? 0] ?? "?"}`).join(" "), cell: key(cell) });
  }
  return result;
}

/** Whether the centre ever takes a cell from row `from` on with the other type around: it merges with that type. */
export function usesRows(observed, centre, other, from, to = Infinity) {
  return pairOf(observed, centre, other).filter((cell) => cell.row >= from && cell.row <= to).length;
}

/** The focus tile of a case: its `#` when the catalogue pattern has one, else the centre of its rectangle. */
function focusIndex(entry, exported, patterns) {
  const pattern = patterns.get(entry.id);
  const margin = exported.margin;
  if (pattern !== undefined) {
    const row = pattern.findIndex((line) => line.includes("#"));
    if (row >= 0) return (row + margin) * exported.width + pattern[row].indexOf("#") + margin;
  }
  return Math.floor(exported.height / 2) * exported.width + Math.floor(exported.width / 2);
}

/** Expected cells written in a catalogue entry, `cells (a,b)/(c,d)/(e,f)`, or null. */
export function expectedCells(text) {
  const match = /cells ((?:\(\d+,\d+\)\/?){3})/.exec(text);
  return match === null ? null : (match[1]?.match(/\(\d+,\d+\)/g) ?? null);
}

/** Every catalogue case with the observed cells of its focus tile at variants 0–2. */
export function caseResults(observed, exportedCases, catalogue) {
  const patterns = new Map(catalogue.map((entry) => [entry.id, entry.pattern]));
  const byId = new Map(exportedCases.map((entry) => [entry.id, entry]));
  return observed.cases.map((entry) => {
    const exported = byId.get(entry.id);
    if (exported === undefined) throw new Error(`case ${String(entry.id)} was not exported`);
    const focus = focusIndex(entry, exported, patterns);
    const cells = entry.variants.map((tiles) => {
      const tile = tiles[focus];
      return tile === null || tile === undefined ? "air" : `(${String(tile[0] / 18)},${String(tile[1] / 18)})`;
    });
    const expected = expectedCells(exported.expected);
    return {
      id: entry.id, section: exported.section, expected: exported.expected, cells,
      matches: expected === null ? null : expected.every((cell, variant) => cell === cells[variant]),
    };
  });
}

/** All tiles of a case at variant 0, as rows of cells (`..` for air), for the shape and other look-only cases. */
export function caseGrid(observed, exportedCases, id) {
  const entry = observed.cases.find((candidate) => candidate.id === id);
  const exported = exportedCases.find((candidate) => candidate.id === id);
  if (entry === undefined || exported === undefined) throw new Error(`no case ${id}`);
  const rows = [];
  for (let y = 0; y < exported.height; y++) {
    const row = [];
    for (let x = 0; x < exported.width; x++) {
      const tile = entry.variants[0]?.[y * exported.width + x];
      const shape = exported.tiles[y * exported.width + x]?.[1] ?? 0;
      row.push(tile === null || tile === undefined ? "  ..  " : `${(`(${String(tile[0] / 18)},${String(tile[1] / 18)})`).padEnd(7)}${shape === 0 ? "" : `s${String(shape)}`}`);
    }
    rows.push(row.join(" "));
  }
  return rows;
}

/**
 * Large-frame patterns (O4): for each type whose interior depends on position, the smallest period (px, py) over
 * world coordinates that explains both slabs, and the cell of each (x mod px, y mod py) in the interior.
 */
export function largeFramePatterns(observed) {
  return observed.largeFrames.map(({ id, slab, origins }) => {
    const interior = [];
    for (const { left, top, cells } of origins) {
      for (let y = 1; y < slab - 1; y++) {
        for (let x = 1; x < slab - 1; x++) {
          const at = (y * slab + x) * 2;
          interior.push({ x: left + x, y: top + y, cell: `(${String(cells[at])},${String(cells[at + 1])})` });
        }
      }
    }
    for (const [px, py] of [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1], [1, 3], [3, 2], [2, 3], [3, 3], [3, 4], [4, 3], [4, 4], [6, 4], [3, 6], [6, 6]]) {
      const table = new Map();
      let consistent = true;
      for (const { x, y, cell } of interior) {
        const slot = `${String(((x % px) + px) % px)},${String(((y % py) + py) % py)}`;
        const known = table.get(slot);
        if (known !== undefined && known !== cell) {
          consistent = false;
          break;
        }
        table.set(slot, cell);
      }
      if (consistent) return { id, period: [px, py], table: Object.fromEntries([...table].sort()) };
    }
    return { id, period: null, table: null };
  });
}

/**
 * The interior looks for sides `oooo` in the order of docs/assets.md ("Choosing the cell", step 2), each with the
 * corners it requires (every other corner is `o`) and its variant-0 cell.
 */
export const INTERIOR_LOOKS = [
  { name: "rim SE", corners: { SE: "d" }, cell: "(0,5)" },
  { name: "rim SW", corners: { SW: "d" }, cell: "(1,5)" },
  { name: "rim NE", corners: { NE: "d" }, cell: "(0,6)" },
  { name: "rim NW", corners: { NW: "d" }, cell: "(1,6)" },
  { name: "notches SE+SW", corners: { SE: "x", SW: "x" }, cell: "(6,2)" },
  { name: "notches NW+NE", corners: { NW: "x", NE: "x" }, cell: "(6,1)" },
  { name: "notches NE+SE", corners: { NE: "x", SE: "x" }, cell: "(11,0)" },
  { name: "notches NW+SW", corners: { NW: "x", SW: "x" }, cell: "(10,0)" },
  { name: "plain interior", corners: {}, cell: "(1,1)" },
];

/** The documented corner rule: all four corners `x` → NW+NE, else the first look whose required corners all match. */
export function predictInterior(corners) {
  if (["NW", "NE", "SE", "SW"].every((corner) => corners[corner] === "x")) return "(6,1)";
  const look = INTERIOR_LOOKS.find((candidate) => Object.entries(candidate.corners).every(([corner, letter]) => corners[corner] === letter));
  return look?.cell ?? "none";
}

/**
 * The corner rule against every observed corner combination of a centre with sides `oooo`. `letters` maps a corner
 * digit (0 air, 1 the centre's type, 2 the other type) to its wanted letter for this pair.
 */
export function cornerRule(observed, centre, other, alphabet, letters) {
  const cells = pairOf(observed, centre, other);
  const mismatches = [];
  let total = 0;
  for (let index = 0; index < alphabet.length ** 4; index++) {
    const digits = [0, 1, 2, 3].map((position) => alphabet[Math.floor(index / alphabet.length ** position) % alphabet.length] ?? 0);
    const corners = Object.fromEntries(["NW", "NE", "SE", "SW"].map((name, position) => [name, letters[digits[position] ?? 0]]));
    const cell = cells[codeOf(digitsFor([1, 1, 1, 1], digits))];
    if (cell === undefined) continue;
    total++;
    if (predictInterior(corners) !== key(cell)) mismatches.push({ corners, predicted: predictInterior(corners), seen: key(cell) });
  }
  return { total, mismatches };
}

/**
 * What changed between two observations, for example before and after a game update: catalogue cases with another
 * cell, neighbourhood and shape codes with another cell, large-frame ids added, removed or with another pattern.
 */
export function compareObservations(before, after) {
  const changes = [];
  const beforeCases = new Map(before.cases.map((entry) => [entry.id, JSON.stringify(entry.variants)]));
  for (const entry of after.cases) {
    const previous = beforeCases.get(entry.id);
    if (previous === undefined) changes.push(`case ${String(entry.id)}: new`);
    else if (previous !== JSON.stringify(entry.variants)) changes.push(`case ${String(entry.id)}: other cells`);
  }
  for (const pair of after.neighbourhoods) {
    const previous = before.neighbourhoods.find((entry) => entry.centre === pair.centre && entry.other === pair.other);
    if (previous === undefined) {
      changes.push(`neighbourhoods ${String(pair.centre)}/${String(pair.other)}: new`);
      continue;
    }
    const a = previous.cells.split(";");
    const b = pair.cells.split(";");
    const differing = b.filter((cell, code) => cell !== a[code]).length;
    if (differing > 0) changes.push(`neighbourhoods ${String(pair.centre)}/${String(pair.other)}: ${String(differing)} of ${String(b.length)} codes`);
  }
  if (before.shapes !== undefined && after.shapes !== undefined) {
    const a = before.shapes.cells.split(";");
    const differing = after.shapes.cells.split(";").filter((cell, code) => cell !== a[code]).length;
    if (differing > 0) changes.push(`shapes: ${String(differing)} codes`);
  }
  const frames = (observed) => new Map(observed.largeFrames.map((entry) => [entry.id, JSON.stringify(entry.origins)]));
  const beforeFrames = frames(before);
  const afterFrames = frames(after);
  for (const [id, pattern] of afterFrames) {
    if (!beforeFrames.has(id)) changes.push(`large frame ${String(id)}: new`);
    else if (beforeFrames.get(id) !== pattern) changes.push(`large frame ${String(id)}: other pattern`);
  }
  for (const id of beforeFrames.keys()) if (!afterFrames.has(id)) changes.push(`large frame ${String(id)}: gone`);
  return changes;
}

/** Faces each CWM shape cuts, in side order N, E, S, W (1 half; 2–5 slopes top-right, top-left, bottom-right, bottom-left). */
export const CUT_FACES = [[], ["N"], ["N", "E"], ["N", "W"], ["S", "E"], ["S", "W"]];
const SIDES = ["N", "E", "S", "W"];
const OPPOSITE = { N: "S", E: "W", S: "N", W: "E" };

/** Side code (letters NESW) → variant-0 cell of a dirt centre whose corners are dirt, from the dirt/stone neighbourhoods. */
function dirtSideCells(observed) {
  const cells = pairOf(observed, 0, 1);
  const map = new Map();
  for (let code = 0; code < 16; code++) {
    const sides = [0, 1, 2, 3].map((index) => (code >> index) & 1);
    const cell = cells[codeOf(digitsFor(sides, [1, 1, 1, 1]))];
    if (cell !== undefined) map.set(sides.map((digit) => (digit === 1 ? "o" : "x")).join(""), key(cell));
  }
  return map;
}

/**
 * The shape rule (O5) against every observed shape neighbourhood: a side is connected (`o`) only when the centre's own
 * face there is whole and the neighbour on it is present with a whole face toward the centre. Returns the number of
 * neighbourhoods and those the rule does not predict.
 */
export function shapeRule(observed) {
  const sideCells = dirtSideCells(observed);
  const cells = observed.shapes.cells.split(";");
  const mismatches = [];
  cells.forEach((cell, code) => {
    const centreShape = Math.floor(code / 2401);
    const sides = SIDES.map((_, index) => Math.floor((code % 2401) / 7 ** index) % 7);
    const predicted = SIDES.map((side, index) => {
      const digit = sides[index] ?? 0;
      if ((CUT_FACES[centreShape] ?? []).includes(side) || digit === 0) return "x";
      return (CUT_FACES[digit - 1] ?? []).includes(OPPOSITE[side]) ? "x" : "o";
    }).join("");
    const expected = sideCells.get(predicted);
    const [column, row] = cell.split(",");
    const seen = `(${String(column)},${String(row)})`;
    if (expected !== seen) {
      mismatches.push({ centreShape, sides: sides.map((digit) => (digit === 0 ? "air" : `s${String(digit - 1)}`)).join(" "), predicted, expected, seen });
    }
  });
  return { total: cells.length, mismatches };
}

/** The Markdown report: every open question with the observed answer. */
export function report(observed, exportedCases, catalogue) {
  const lines = [`# Framing observation report (Terraria ${String(observed.gameVersion)})`, ""];
  const count = (values) => [0, 1, 2].map((variant) => values.filter((value) => value === variant).length);
  lines.push("## O1 — variants", "",
    `Reframing with reset, 90 times: variants 0/1/2 drawn ${count(observed.variants.resetSamples).join("/")} times.`,
    `Reframing without reset, 30 times: ${count(observed.variants.keptSamples).join("/")} (the remembered variant).`, "");

  lines.push("## Catalogue cases (focus tile, variants 0/1/2)", "", "| Case | Section | Observed | Expected | Match |", "|---|---|---|---|---|");
  for (const result of caseResults(observed, exportedCases, catalogue)) {
    lines.push(`| ${result.id} | ${result.section} | ${result.cells.join(" ")} | ${result.expected.replaceAll("|", "/")} | ${result.matches === null ? "–" : result.matches ? "yes" : "**no**"} |`);
  }

  for (const [centre, other, name] of [[1, 0, "stone with dirt"], [0, 1, "dirt with stone"], [7, 0, "copper with dirt"], [58, 57, "hellstone with ash"], [315, 0, "coralstone with dirt"]]) {
    const fallback = rimFallback(observed, centre, other);
    lines.push("", `## O3 — missing-rim fallback, ${name} (corners all ${name.split(" ")[0]})`, "",
      `Side codes with \`d\`: ${String(fallback.length)}; fell back to the code with \`d → x\`: ${String(fallback.filter((entry) => entry.fellBack).length)}.`,
      `Fell back: ${fallback.filter((entry) => entry.fellBack).map((entry) => entry.sides).join(" ") || "none"}.`,
      `Kept a rim: ${fallback.filter((entry) => !entry.fellBack).map((entry) => `${entry.sides} ${entry.cell}`).join(", ") || "none"}.`);
  }

  lines.push("", "## O3 — the documented corner rule against the game", "");
  for (const [centre, other, alphabet, letters, name] of [
    [0, 1, [0, 1], ["x", "o", "o"], "dirt, corners air or dirt"], [1, 0, [0, 1], ["x", "o", "d"], "stone, corners air or stone"],
    [1, 0, [0, 1, 2], ["x", "o", "d"], "stone, corners air, stone or dirt"],
  ]) {
    const result = cornerRule(observed, centre, other, alphabet, letters);
    lines.push(`- ${name}: ${String(result.total - result.mismatches.length)} of ${String(result.total)} predicted${result.mismatches.length === 0 ? "" : `; not: ${result.mismatches.map((entry) => `${JSON.stringify(entry.corners)} → ${entry.seen} (rule ${entry.predicted})`).join(", ")}`}`);
  }

  for (const [centre, other, alphabet, name] of [
    [0, 1, [0, 1], "dirt, corners air or dirt"], [1, 0, [0, 1], "stone, corners air or stone"], [1, 0, [0, 1, 2], "stone, corners air, stone or dirt"],
  ]) {
    lines.push("", `## O3 — corner looks for sides oooo, ${name}`, "", "| Corners | Cell (v0) |", "|---|---|");
    for (const entry of cornerLooks(observed, centre, other, alphabet)) lines.push(`| ${entry.corners} | ${entry.cell} |`);
  }

  lines.push("", "## Merge partners (rows 5–14 are the rim looks)", "", "| Centre | Other | Codes with a rim cell | Codes in rows 15–21 |", "|---|---|---|---|");
  for (const pair of observed.neighbourhoods) {
    lines.push(`| ${String(pair.centre)} | ${String(pair.other)} | ${String(usesRows(observed, pair.centre, pair.other, 5, 14))} | ${String(usesRows(observed, pair.centre, pair.other, 15))} |`);
  }

  const shapes = shapeRule(observed);
  lines.push("", "## O5 — shapes", "", `Shape neighbourhoods: ${String(shapes.total)}; not predicted by the face rule: ${String(shapes.mismatches.length)}.`);
  const groups = new Map();
  for (const entry of shapes.mismatches) {
    const group = `centre s${String(entry.centreShape)}, predicted ${entry.predicted} ${String(entry.expected)}, seen ${entry.seen}`;
    groups.set(group, [...(groups.get(group) ?? []), entry.sides]);
  }
  for (const [group, list] of [...groups].sort((a, b) => b[1].length - a[1].length).slice(0, 40)) {
    lines.push(`- ${group}: ${String(list.length)} (e.g. N E S W = ${list.slice(0, 3).join(" | ")})`);
  }
  lines.push("", "## O4 — large-frame patterns", "", "| Id | Ignores the variant | Period (x, y) | Cell by (x mod px, y mod py) |", "|---|---|---|---|");
  for (const pattern of largeFramePatterns(observed)) {
    const ignores = observed.largeFrames.find((entry) => entry.id === pattern.id)?.ignoresVariant;
    lines.push(`| ${String(pattern.id)} | ${ignores === true ? "yes" : "no"} | ${pattern.period === null ? "none found" : pattern.period.join(" × ")} | ${pattern.table === null ? "" : Object.entries(pattern.table).map(([slot, cell]) => `${slot}→${cell}`).join(" ")} |`);
  }

  for (const section of ["Shapes", "Diagonal hole", "Coralstone", "Moss", "Large frame"]) {
    lines.push("", `## ${section} cases (variant 0; sN = shape N)`);
    for (const entry of exportedCases.filter((candidate) => candidate.section === section)) {
      lines.push("", `### ${entry.id}`, "", "```", ...caseGrid(observed, exportedCases, entry.id), "```");
    }
  }
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === "--compare") {
  const [, beforePath, afterPath] = process.argv.slice(2);
  if (beforePath === undefined || afterPath === undefined) throw new Error("usage: node scripts/framing/analyse.mjs --compare <before.json> <after.json>");
  const before = JSON.parse(readFileSync(beforePath, "utf8"));
  const after = JSON.parse(readFileSync(afterPath, "utf8"));
  const changes = compareObservations(before, after);
  console.log(`Terraria ${String(before.gameVersion)} → ${String(after.gameVersion)}: ${changes.length === 0 ? "no framing change" : `${String(changes.length)} changes`}`);
  for (const change of changes) console.log(`- ${change}`);
} else if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [observedPath, casesPath, output] = process.argv.slice(2);
  if (observedPath === undefined || casesPath === undefined) {
    throw new Error("usage: node scripts/framing/analyse.mjs <observed.json> <cases.json> [report.md]");
  }
  const observed = JSON.parse(readFileSync(observedPath, "utf8"));
  const { cases } = JSON.parse(readFileSync(casesPath, "utf8"));
  const catalogue = JSON.parse(readFileSync("dotnet/Terraria.WorldCodec.Synthetic/framing-cases.json", "utf8"));
  const text = report(observed, cases, catalogue);
  if (output === undefined) process.stdout.write(text);
  else writeFileSync(output, text);
}
