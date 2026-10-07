import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const powershell = process.platform === "win32" ? "powershell.exe" : "pwsh";
const available = spawnSync(powershell, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"]).status === 0;

function removeFixtureDirectory(directory) {
  const absolute = resolve(directory);
  assert.equal(dirname(absolute), resolve(tmpdir()));
  assert.match(basename(absolute), /^terraria-map-palette-/);
  rmSync(absolute, { recursive: true, force: true });
}

for (const scenario of ["normal", "invalid-range", "missing-member"]) {
  test(`reflection export: ${scenario}`, { skip: !available && "PowerShell is not installed" }, () => {
    const directory = mkdtempSync(join(tmpdir(), "terraria-map-palette-"));
    try {
      const result = spawnSync(powershell, [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
        resolve("scripts/map-palette/fixture-export.ps1"),
        "-Directory", directory, "-Scenario", scenario,
      ], { encoding: "utf8" });
      if (scenario === "normal") {
        assert.equal(result.status, 0, result.stderr);
        const palette = JSON.parse(readFileSync(join(directory, "synthetic.terraria-map-palette.json"), "utf8"));
        assert.equal(palette.schemaVersion, 1);
        assert.equal(palette.gameVersion, "1.4.5.8");
        assert.deepEqual(palette.tiles, [[[118, 88, 62]], [[108, 112, 120], [96, 102, 110]], []]);
        assert.deepEqual(palette.walls, [[], [[82, 86, 92]]]);
        assert.deepEqual(palette.liquids, [[32, 104, 210], [228, 68, 24], [222, 164, 36], [152, 84, 216]]);
      } else {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /map palette|lookup|contract/i);
        assert.throws(() => readFileSync(join(directory, "synthetic.terraria-map-palette.json")));
      }
    } finally {
      removeFixtureDirectory(directory);
    }
  });
}

test("opt-in reflection export against the user's installed Terraria", {
  skip: !process.env.TERRARIA_ASSEMBLY && "Set TERRARIA_ASSEMBLY to a local TerrariaServer.exe",
}, () => {
  const directory = mkdtempSync(join(tmpdir(), "terraria-map-palette-install-"));
  try {
    const output = join(directory, "installed.terraria-map-palette.json");
    const result = spawnSync(powershell, [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      resolve("scripts/export-map-palette.ps1"),
      "-TerrariaAssembly", process.env.TERRARIA_ASSEMBLY, "-OutputPath", output,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const palette = JSON.parse(readFileSync(output, "utf8"));
    assert.ok(palette.tiles.length >= 754);
    assert.ok(palette.walls.length >= 367);
    assert.equal(palette.liquids.length, 4);
    assert.equal(palette.schemaVersion, 1);
  } finally {
    removeFixtureDirectory(directory);
  }
});
