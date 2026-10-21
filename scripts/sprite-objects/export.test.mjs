// The sprite object exporter on a small synthetic observation, and (opt-in, TERRARIA_ASSEMBLY set to a local
// TerrariaServer.exe; never in CI) the committed tables against a fresh observation of the installed game (ADR 0003).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { OUTPUT, drawOffsetTables, exportObjects, solidityTables, trackTables, treeTables } from "./export.mjs";

const pieces = (count) => Array.from({ length: 40 }, (_, piece) => ({
  piece, rect: [(piece % 8) * 18, Math.floor(piece / 8) * 18, 16, 16], rect1: [0, 0, 0, 0],
  ...(piece < count ? { left: piece === 4, right: piece === 5, bumper: piece === 2, bouncy: piece === 24 } : {}),
}));

const tracks = {
  totalFrames: 36, LeftDownDecoration: 36, RightDownDecoration: 37, BouncyBumperDecoration: 38, RegularBumperDecoration: 39,
  pieces: pieces(36), accessors: [[0, -1, 0, -1], [12, 30, 12, 30]],
};

test("track pieces become [column, row, flags] and the extras their cells", () => {
  const { pieces: table, extras } = trackTables(tracks);
  assert.equal(table.length, 36);
  assert.deepEqual(table[2], [2, 0, 4]);
  assert.deepEqual(table[4], [4, 0, 1]);
  assert.deepEqual(table[5], [5, 0, 2]);
  assert.deepEqual(table[24], [0, 3, 8]);
  assert.deepEqual(extras, [[4, 4], [5, 4], [7, 4], [6, 4]]);
});

test("a track frame that is not its piece is refused", () => {
  assert.throws(() => trackTables({ ...tracks, accessors: [[0, -1, 1, -1]] }), /not the pieces/);
});

const ground = (overrides) => ({
  ground: 2, biome: -1, palmBiome: -1, trunkDraw: [0, 0, 20, 20, 0, 0, 0, 0, 0], zones: [-1, -1, -1, -1], readArea: -1,
  variants: [[1, 0, 0, 80, 80], [1, 0, 0, 80, 80], [1, 0, 0, 80, 80]],
  values: [Array.from({ length: 30 }, () => [1, 0, 0, 80, 80])], ...overrides,
});

test("foliage columns fold into their shortest period and identical patterns are shared", () => {
  const hallow = ground({
    ground: 109, biome: 2, trunkDraw: [528, 0, 20, 20, 0, 0, 0, 0, 0],
    values: [Array.from({ length: 30 }, (_, k) => [1, 3 * (k % 3), 3, 80, 140])],
  });
  const forest = ground({ zones: [0, 1, 2, 3], readArea: 1, values: [0, 1].map((value) => Array.from({ length: 30 }, () => [1, 0, value === 0 ? 0 : value + 5, 80, 80])) });
  const tables = treeTables({ families: [{ type: 5, grounds: [forest, hallow, ground({ ground: 477, zones: [0, 1, 2, 3], readArea: 1, values: forest.values })] }] }, [
    { ground: 53, biome: 0, trunk: [22, 0], top: [110, 0] }, { ground: 1, biome: -1, trunk: [22, -22], top: [110, -22] },
  ]);
  assert.deepEqual(tables.foliagePatterns, [[1, 0, 0, 80, 80], [1, 6, 0, 80, 80], [3, 3, 0, 80, 140, 3, 3, 80, 140, 3, 6, 80, 140]]);
  assert.deepEqual(tables.foliage, [{ type: 5, grounds: [[2, -2, 0, 1], [109, -1, 2], [477, -2, 0, 1]] }]);
  assert.deepEqual(tables.trunkBlocks, [[109, 3]]);
  assert.deepEqual(tables.palmRows, [[53, 0]]);
});

test("a foliage style that depends on the stored variant is refused", () => {
  const varying = ground({ variants: [[1, 0, 0, 80, 80], [1, 0, 6, 80, 80], [1, 0, 0, 80, 80]] });
  assert.throws(() => treeTables({ families: [{ type: 5, grounds: [varying] }] }, []), /depends on its variant/);
});

/** A draw observation: the grid's 8 × 40 frames at a stride of 18 from a function of (fx, fy). */
const drawType = (type, rows, columns, variantAt) => ({
  type, rows, columns, grid: Array.from({ length: 320 }, (_, i) => variantAt((i % 8) * 18, Math.floor(i / 8) * 18)),
});

test("draw offsets: plain types are left out; others keep their base and the runs that differ from it", () => {
  const plain = [16, 16, 0, 0, 0], plant = [16, 20, 0, 1, 0], pile = [16, 16, 2, 0, 0], hanging = [16, 18, -2, 0, 0];
  const tables = drawOffsetTables([
    drawType(14, [[0, 2400, plain]], [[0, 2400, plain]], () => plain),
    drawType(3, [[0, 2400, plant]], [[0, 2400, plant]], () => plant),
    // Rows from 36 on hang; columns from 54 on are piles; the frameY run wins where it differs.
    drawType(185, [[0, 34, pile], [36, 2400, hanging]], [[0, 52, pile], [54, 2400, plain]], (fx, fy) => (fy >= 36 ? hanging : fx >= 54 ? plain : pile)),
    // A frame the game cannot draw (null) says nothing about its row.
    drawType(33, [[0, 570, plant], [594, 2400, plant]], [[0, 2400, plant]], (fx, fy) => (fx === 0 && fy === 576 ? null : plant)),
  ]);
  assert.deepEqual(tables.drawVariants, [plant, pile, hanging, plain]);
  assert.deepEqual(tables.drawTypes, [[3, 0, [], []], [185, 1, [[36, 2400, 2]], [[54, 2400, 3]]], [33, 0, [], []]]);
  assert.deepEqual(drawOffsetTables([drawType(412, [], [], () => null)]).drawUnobserved, [412]);
});

test("draw offsets the runs do not reproduce are refused", () => {
  const a = [16, 16, 2, 0, 0], b = [16, 16, 0, 0, 0];
  assert.throws(() => drawOffsetTables([drawType(7, [[0, 2400, a]], [[0, 2400, a]], (fx, fy) => (fx === 18 && fy === 18 ? b : a))]), /the runs give/);
  assert.throws(() => drawOffsetTables([drawType(7, [[0, 2400, "parity"]], [[0, 2400, a]], () => a)]), /more than the frame/);
});

test("solidity: the solid blocks are the solid types that are not solid on top only", () => {
  const tables = solidityTables({ solid: [0, 1, 19, 379], solidTop: [14, 19], hidesLiquidBehind: [54] });
  assert.deepEqual(tables, { solidBlocks: [0, 1, 379], solidTops: [14, 19], hidesLiquidBehind: [54] });
  assert.throws(() => solidityTables(undefined), /no solidity/);
});

const assembly = process.env.TERRARIA_ASSEMBLY;
const skip = assembly === undefined && "set TERRARIA_ASSEMBLY to a local TerrariaServer.exe to run it";

test("the committed tables equal a fresh observation of the installed game", { skip }, () => {
  const directory = mkdtempSync(join(tmpdir(), "terraria-sprite-objects-"));
  try {
    const output = join(directory, "observed.json");
    spawnSync(process.platform === "win32" ? "powershell.exe" : "pwsh", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", resolve("scripts/sprite-objects/observe.ps1"),
      "-TerrariaAssembly", assembly, "-OutputPath", output,
    ], { encoding: "utf8" });
    const fresh = exportObjects(JSON.parse(readFileSync(output, "utf8")));
    const committed = readFileSync(OUTPUT, "utf8");
    assert.equal(committed.slice(committed.indexOf("= {") + 2, committed.lastIndexOf(";")), JSON.stringify(fresh));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
