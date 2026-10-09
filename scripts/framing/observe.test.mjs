// Opt-in conformance (ADR 0003): the framing rules of docs/assets.md ("Tile framing") against what a local Terraria
// installation frames. Run with TERRARIA_ASSEMBLY set to TerrariaServer.exe; skipped otherwise (never in CI). Needs the
// built codec (scripts/build.sh) and the .NET SDK, which generate the observation world. Nothing is kept: the world,
// the cases and the observation live in a temporary directory.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { caseResults, cornerRule, largeFramePatterns, pairOf, rimFallback, shapeRule } from "./analyse.mjs";
import { exportCases } from "./export-cases.mjs";

const assembly = process.env.TERRARIA_ASSEMBLY;
const powershell = process.platform === "win32" ? "powershell.exe" : "pwsh";
const skip = assembly === undefined && "set TERRARIA_ASSEMBLY to a local TerrariaServer.exe to run it";

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
}

function observe() {
  const directory = mkdtempSync(join(tmpdir(), "terraria-framing-observe-"));
  try {
    const world = join(directory, "framing.wld");
    run("dotnet", ["run", "--project", resolve("dotnet/Terraria.WorldCodec.Synthetic"), "--", "generate", resolve("packages/test-fixtures/worlds/SJCO1.wld"), world]);
    const cases = exportCases(new Uint8Array(readFileSync(world)), JSON.parse(readFileSync(`${world}.manifest.json`, "utf8")));
    const casesPath = join(directory, "cases.json");
    writeFileSync(casesPath, JSON.stringify({ cases }));
    const output = join(directory, "observed.json");
    // The host may end with a non-zero code after the output is written (the game's background thread); the
    // completion marker in the output is what counts.
    spawnSync(powershell, [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", resolve("scripts/framing/observe.ps1"),
      "-TerrariaAssembly", assembly, "-CasesPath", casesPath, "-OutputPath", output,
    ], { encoding: "utf8" });
    const observed = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(observed.complete, true, "the observation did not complete");
    return { observed, cases };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const catalogue = JSON.parse(readFileSync("dotnet/Terraria.WorldCodec.Synthetic/framing-cases.json", "utf8"));
const result = assembly === undefined ? undefined : observe();
/** Whether two exhaustively observed pairs frame every neighbourhood alike. */
function same(centre, other, centre2, other2) {
  const first = pairOf(result.observed, centre, other).map((cell) => JSON.stringify(cell));
  const second = pairOf(result.observed, centre2, other2).map((cell) => JSON.stringify(cell));
  return first.every((cell, code) => cell === second[code]);
}

/** The 28 side codes without a cell, as docs/assets.md ("Choosing the cell", step 1) lists them. */
const FALLBACK_CODES = `dddx ddox ddxd ddxo ddxx dodx doxd doxx dxdd dxdo dxod dxxd dxxo oddx odxd odxx oxdd oxxd xddd xddo xddx
  xdod xdox xodd xodx xxdd xxdo xxod`.split(/\s+/);

test("every catalogue case with documented cells is framed with exactly those cells (worked examples, grass)", { skip }, () => {
  const checked = caseResults(result.observed, result.cases, catalogue).filter((entry) => entry.matches !== null);
  assert.ok(checked.length >= 30, "the catalogue lost its documented cases");
  for (const entry of checked) assert.equal(entry.matches, true, `${entry.id}: observed ${entry.cells.join(" ")}, expected ${entry.expected}`);
});

test("exactly the 28 documented side codes fall back to d → x, for every dirt-partner block", { skip }, () => {
  for (const [centre, other] of [[1, 0], [7, 0], [58, 57], [315, 0]]) {
    const fellBack = rimFallback(result.observed, centre, other).filter((entry) => entry.fellBack).map((entry) => entry.sides);
    assert.deepEqual([...fellBack].sort(), [...FALLBACK_CODES].sort(), `${String(centre)} with ${String(other)}`);
  }
});

test("the corner order of step 2 (with rim NE before rim NW) predicts every corner combination", { skip }, () => {
  for (const [centre, other, alphabet, letters] of [
    [0, 1, [0, 1], ["x", "o", "o"]], [1, 0, [0, 1], ["x", "o", "d"]], [1, 0, [0, 1, 2], ["x", "o", "d"]],
  ]) {
    const { total, mismatches } = cornerRule(result.observed, centre, other, alphabet, letters);
    assert.ok(total >= 16);
    assert.deepEqual(mismatches, [], `${String(centre)} with ${String(other)}`);
  }
});

test("the face rule predicts every side-shape neighbourhood", { skip }, () => {
  const { total, mismatches } = shapeRule(result.observed);
  assert.equal(total, 6 * 2401);
  assert.deepEqual(mismatches.slice(0, 5), []);
});

test("dirt-partner blocks frame alike, ores draw seams, and the jungle grasses take mud as partner", { skip }, () => {
  assert.ok(same(1, 0, 7, 0), "stone and copper against dirt");
  assert.ok(same(1, 0, 58, 57), "stone against dirt, hellstone against ash");
  assert.ok(same(1, 0, 315, 0), "stone and coralstone against dirt");
  assert.ok(same(7, 1, 7, 6), "copper beside stone and beside iron");
  for (const jungle of [60, 661, 662]) assert.ok(same(jungle, 59, 2, 0), `${String(jungle)} on mud like grass on dirt`);
});

test("moss uses the grass rows 15–21 and frames the same beside stone and dirt", { skip }, () => {
  assert.ok(pairOf(result.observed, 179, 1).some((cell) => cell.row >= 15));
  assert.ok(same(179, 1, 179, 0));
});

test("the 24 large-frame ids follow the documented position patterns and ignore the variant", { skip }, () => {
  const threeByFour = [273, 274, 284, 325, 357, 618, 736];
  const twoByTwo = [409, 669, 670, 671, 672, 673, 674, 675, 676, 735, 737, 741, 742, 743, 745, 746, 749];
  const ignoring = result.observed.largeFrames.filter((entry) => entry.ignoresVariant).map((entry) => entry.id);
  assert.deepEqual([...ignoring].sort((a, b) => a - b), [...threeByFour, ...twoByTwo].sort((a, b) => a - b));
  const patterns = new Map(largeFramePatterns(result.observed).map((entry) => [entry.id, entry]));
  for (const id of threeByFour) {
    assert.deepEqual(patterns.get(id)?.table, {
      "0,0": "(2,1)", "0,1": "(1,1)", "0,2": "(2,1)", "0,3": "(1,1)", "1,0": "(3,6)", "1,1": "(3,1)",
      "1,2": "(2,1)", "1,3": "(1,1)", "2,0": "(2,1)", "2,1": "(1,1)", "2,2": "(3,6)", "2,3": "(3,1)",
    }, String(id));
  }
  for (const id of twoByTwo) assert.deepEqual(patterns.get(id)?.table, { "0,0": "(1,1)", "0,1": "(3,1)", "1,0": "(2,1)", "1,1": "(3,6)" }, String(id));
});

test("variants are random when a frame is reset and kept otherwise", { skip }, () => {
  assert.ok(new Set(result.observed.variants.resetSamples).size >= 2);
  assert.equal(new Set(result.observed.variants.keptSamples).size, 1);
});

test("the committed framing database matches the installed game (3 000 random samples)", { skip }, async () => {
  const { loadFramingDatabase } = await import("../../packages/renderer/dist/framing/framing-database.js");
  const { terrariaFramingData } = await import("../../packages/renderer/dist/framing/terraria-framing.generated.js");
  const database = await loadFramingDatabase(terrariaFramingData);
  // A fixed pseudo-random sample: centre, other (or none), neighbourhood, variant.
  let seed = 20261009;
  const next = (limit) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % limit; };
  const samples = [];
  const expected = [];
  while (samples.length < 3000) {
    const centre = database.blockTypes[next(database.blockTypes.length)];
    const other = next(4) === 0 ? null : database.blockTypes[next(database.blockTypes.length)];
    if (other === centre) continue;
    const code = next(6561);
    const variant = next(3);
    const base = database.blockCell(centre, other, code);
    const cell = base === null ? null : database.blockVariant(centre, base, variant);
    if (cell === null) continue;
    samples.push([centre, other ?? -1, code, variant]);
    expected.push(cell);
  }
  const directory = mkdtempSync(join(tmpdir(), "terraria-framing-check-"));
  try {
    const input = join(directory, "samples.json");
    const output = join(directory, "checked.json");
    writeFileSync(input, JSON.stringify(samples));
    spawnSync(powershell, [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", resolve("scripts/framing/observe.ps1"),
      "-TerrariaAssembly", assembly, "-Mode", "Check", "-CasesPath", input, "-OutputPath", output,
    ], { encoding: "utf8" });
    const checked = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(checked.gameVersion, database.gameVersion, "the database was generated from another game version");
    const differing = samples.flatMap((sample, index) => (JSON.stringify(checked.cells[index]) === JSON.stringify(expected[index])
      ? [] : [`[centre, other, code, variant] ${JSON.stringify(sample)}: game ${JSON.stringify(checked.cells[index])}, database ${JSON.stringify(expected[index])}`]));
    assert.deepEqual(differing, [], `${String(differing.length)} of ${String(samples.length)} samples differ`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
