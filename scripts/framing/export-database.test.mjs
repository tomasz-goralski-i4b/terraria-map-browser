// The framing database exporter (ADR 0003) on small synthetic observations: no game needed.
import { inflateRawSync } from "node:zlib";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeShards, moduleText } from "./export-database.mjs";

const text = (...indices) => String.fromCharCode(...indices.map((index) => index + 48));

/** One shard with no block types and one wall whose tables use its local cells. */
function wallShard(wall) {
  return {
    shard: 0, shards: 1, complete: true, gameVersion: "test", blockTypes: [], types: [], verified: 0, failures: 0,
    failureList: "", cells: [[5, 5], [9, 3], [6, 2]],
    tables: [text(1, 1), text(2, 2), text(0, 2), text(1, 0)],
    walls: [{ id: 1, table: 0, interiorByPosition: 1, variantChangesInterior: true, variants: [[2, 0, 0]], ...wall }],
    wallNeighbourBlocks: [54], shapedCorners: { dirt: "", stoneWithDirt: "" },
    nonBlocks: {
      types: [52, 80],
      hanging: [{ id: 52, groups: [{ above: [2], below: [52], west: [], east: [], cells: [[1, 2], [2], [1], [2], [1], [2], [1], [2]] }] }],
      // A 1 × 1 window: configurations 0 … 3 (bit 0 the tile, bit 1 the root below it).
      standing: [{ id: 80, roots: [53], width: 1, height: 1, windows: [[0, ""], [1, text(0)], [2, ""], [3, text(1)]] }],
    },
  };
}

/** The wall entries and inflated tables of a module's data. */
function exported(database) {
  const source = moduleText(database);
  const data = JSON.parse(source.slice(source.indexOf("= ") + 2, source.lastIndexOf(";")));
  const tables = data.tables.map((table) => inflateRawSync(Buffer.from(table, "base64")).toString("latin1"));
  const cellsOf = (index) => [...tables[index]].map((char) => data.cells[char.charCodeAt(0) - 48]);
  return { wall: data.walls["1"], cellsOf, data };
}

test("the walls' position tables (interior variants, edges) are merged and exported with their cells", () => {
  const { wall, cellsOf } = exported(mergeShards([wallShard({ interiorVariantsByPosition: 2, edgesByPosition: 3 })]));
  assert.deepEqual(cellsOf(wall.table), [[9, 3], [9, 3]]);
  assert.deepEqual(cellsOf(wall.interiorByPosition), [[6, 2], [6, 2]]);
  assert.deepEqual(cellsOf(wall.interiorVariantsByPosition), [[5, 5], [6, 2]]);
  assert.deepEqual(cellsOf(wall.edgesByPosition), [[9, 3], [5, 5]]);
});

test("an observation without the position tables exports a wall without them", () => {
  const { wall } = exported(mergeShards([wallShard({})]));
  assert.equal("interiorVariantsByPosition" in wall, false);
  assert.equal("edgesByPosition" in wall, false);
});

test("vines and cactus are merged with their cells remapped and the windows stored one line per configuration", () => {
  const { data } = exported(mergeShards([wallShard({})]));
  const cell = (index) => data.cells[index];
  const [vine] = data.nonBlocks.hanging;
  assert.deepEqual(vine.groups[0].cells[0].map(cell), [[9, 3], [6, 2]]);
  const [cactus] = data.nonBlocks.standing;
  const lines = inflateRawSync(Buffer.from(cactus.windows, "base64")).toString("latin1").split("\n");
  assert.deepEqual(lines.map((line) => [...line].map((char) => cell(char.charCodeAt(0) - 48))), [[], [[5, 5]], [], [[9, 3]]]);
});

test("a database without vines and cactus, or with a window missing, is refused", () => {
  const shard = wallShard({});
  assert.throws(() => moduleText(mergeShards([{ ...shard, nonBlocks: undefined }])), /no non-block observation/);
  const missing = { ...shard.nonBlocks, standing: [{ ...shard.nonBlocks.standing[0], windows: shard.nonBlocks.standing[0].windows.slice(1) }] };
  assert.throws(() => moduleText(mergeShards([{ ...shard, nonBlocks: missing }])), /missing/);
});
