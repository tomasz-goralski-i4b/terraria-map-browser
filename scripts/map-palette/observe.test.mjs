// Opt-in conformance (ADR 0002): the renderer's background and paint rules against what a local Terraria
// installation draws. Run with TERRARIA_ASSEMBLY set to TerrariaServer.exe; skipped otherwise (never in CI).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { backgroundColor, paintedColor } from "../../packages/renderer/src/palette/map-palette.ts";
import { terrariaMapPalette } from "../../packages/renderer/src/palette/terraria-map-palette.generated.ts";

const assembly = process.env.TERRARIA_ASSEMBLY;
const powershell = process.platform === "win32" ? "powershell.exe" : "pwsh";
const SHADOW_PAINT = 29;

function observe() {
  const directory = mkdtempSync(join(tmpdir(), "terraria-map-observe-"));
  try {
    const output = join(directory, "observed.json");
    const result = spawnSync(powershell, [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", resolve("scripts/map-palette/observe.ps1"),
      "-TerrariaAssembly", assembly, "-OutputPath", output,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(output, "utf8"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const rgba = (hex) => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 255];
const observed = assembly === undefined ? undefined : observe();
const skip = assembly === undefined && "set TERRARIA_ASSEMBLY to a local TerrariaServer.exe to run it";

test("the background of every row matches the game for fractional layer levels", { skip }, () => {
  for (const { height, surface, rock, rows } of observed.levels) {
    rows.forEach((hex, y) => {
      assert.deepEqual(backgroundColor(y, { surfaceY: surface, rockY: rock, height }, terrariaMapPalette), rgba(hex),
        `row ${String(y)} of a ${String(height)}-row world`);
    });
  }
});

test("painted tile and wall colours match the game", { skip }, () => {
  let samples = 0;
  const offByOne = [];
  let shadowExact = 0;
  let shadowSamples = 0;
  let shadowWorst = 0;
  for (const { layer, base, painted } of observed.paints) {
    painted.forEach((hex, paint) => {
      const ours = paintedColor(rgba(base), paint, layer, terrariaMapPalette);
      const error = Math.max(...ours.map((channel, index) => Math.abs(channel - rgba(hex)[index])));
      if (paint === SHADOW_PAINT) {
        shadowSamples++;
        if (error === 0) shadowExact++;
        shadowWorst = Math.max(shadowWorst, error);
        return;
      }
      samples++;
      assert.ok(error <= 1, `${layer} ${base} paint ${String(paint)}: ours ${ours.join(",")}, game ${hex}`);
      if (error === 1) offByOne.push(`${layer} ${base} paint ${String(paint)}`);
    });
  }
  // The game computes colour paints in floating point; a handful of exact products land one step lower there.
  assert.ok(offByOne.length <= samples / 1000, `off by one: ${offByOne.join("; ")}`);
  // Shadow paint is an approximation of a near-black grey (game values 0–7).
  assert.ok(shadowWorst <= 5, `shadow paint off by up to ${String(shadowWorst)}`);
  console.log(`paint: ${String(samples)} samples, ${String(offByOne.length)} off by one; `
    + `shadow: ${String(shadowExact)}/${String(shadowSamples)} exact, worst ${String(shadowWorst)}`);
});
