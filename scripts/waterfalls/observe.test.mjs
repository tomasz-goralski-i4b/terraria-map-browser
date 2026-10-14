// Opt-in (TERRARIA_ASSEMBLY set to a local TerrariaServer.exe; never in CI): the viewer's waterfall source rule
// (packages/renderer, waterfallSources) against the installed game's own source finder on the same synthetic tiles
// (ADR 0003, waterfall addendum). Needs the renderer built (`pnpm --filter @studio/renderer build`).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const assembly = process.env["TERRARIA_ASSEMBLY"];
const SIZE = 64;
const CENTRE = 32;
/** The observer's codes in the CWM: game slopes 1–4 are CWM shapes 2–5, liquids W, L, Y, S are kinds 1–4. */
const SIDE = [".", "#", "h", "s1", "s2", "s3", "s4", "p", "W255", "W161", "W160", "W20", "L255", "Y255", "S255"];
const ABOVE = [".", "#", "h", "s1", "p", "W20", "W255"];

/** Every case: a half block (or another centre) with liquid or tiles around it. */
function cases() {
  const out = [];
  for (const centre of ["h", "#", "s1", "s2", "p"]) for (const left of SIDE) for (const right of SIDE) out.push([[0, 0, centre], [-1, 0, left], [1, 0, right]]);
  for (const above of ABOVE) for (const below of [".", "#", "W255"]) out.push([[0, 0, "h"], [-1, 0, "W255"], [0, -1, above], [0, 1, below]]);
  return out.map((tiles) => tiles.filter(([, , code]) => code !== "."));
}

function world(tiles) {
  const count = SIZE * SIZE;
  const planes = {
    block: new Uint16Array(count).fill(0xffff), frameX: new Int16Array(count).fill(-1), shape: new Uint8Array(count),
    liquid: new Uint8Array(count), liquidAmount: new Uint8Array(count),
  };
  for (const [dx, dy, code] of tiles) {
    const i = (CENTRE + dx) * SIZE + CENTRE + dy;
    const kind = code[0];
    if (kind === "#" || kind === "h" || kind === "s") planes.block[i] = 0;
    if (kind === "p") { planes.block[i] = 1; planes.frameX[i] = 0; }
    if (kind === "h") planes.shape[i] = 1;
    if (kind === "s") planes.shape[i] = Number(code.slice(1)) + 1;
    const liquid = "WLYS".indexOf(kind);
    if (liquid >= 0) { planes.liquid[i] = liquid + 1; planes.liquidAmount[i] = Number(code.slice(1)); }
  }
  return { width: SIZE, height: SIZE, planes, palette: [{ kind: "vanilla", id: 1 }, { kind: "vanilla", id: 19 }] };
}

/** The game's waterfall types of the CWM liquid kinds (water 0, lava 1, honey 14, shimmer 25). */
const TYPES = [0, 1, 14, 25];

test("the viewer's waterfall sources are the game's, case by case", { skip: assembly === undefined ? "TERRARIA_ASSEMBLY is not set" : false }, async () => {
  const { waterfallSources, WATERFALL_MAX_LENGTH } = await import("../../packages/renderer/dist/index.js");
  const directory = mkdtempSync(join(tmpdir(), "waterfalls-"));
  try {
    const all = cases();
    const casesPath = join(directory, "cases.json");
    const outputPath = join(directory, "observation.json");
    writeFileSync(casesPath, JSON.stringify(all));
    const run = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve("scripts/waterfalls/observe.ps1"),
      "-TerrariaAssembly", assembly ?? "", "-CasesPath", casesPath, "-OutputPath", outputPath], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const observed = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(observed.constants.maxLength, WATERFALL_MAX_LENGTH);
    assert.equal(observed.cases.length, all.length);
    // Not vacuous: water, lava, honey and shimmer sources are among them.
    const types = new Set(observed.cases.flat().map((source) => source[2]));
    assert.deepEqual([...types].sort((a, b) => a - b), TYPES);
    assert.ok(observed.cases.filter((found) => found.length > 0).length >= 40);
    all.forEach((tiles, index) => {
      const ours = waterfallSources(world(tiles), { left: 0, top: 0, right: SIZE, bottom: SIZE })
        .map((source) => [source.x - CENTRE, source.y - CENTRE, TYPES[source.kind - 1]]);
      assert.deepEqual(ours, observed.cases[index], JSON.stringify(tiles));
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
