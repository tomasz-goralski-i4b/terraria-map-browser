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
  };
}

/** The wall entries and inflated tables of a module's data. */
function exported(database) {
  const source = moduleText(database);
  const data = JSON.parse(source.slice(source.indexOf("= ") + 2, source.lastIndexOf(";")));
  const tables = data.tables.map((table) => inflateRawSync(Buffer.from(table, "base64")).toString("latin1"));
  const cellsOf = (index) => [...tables[index]].map((char) => data.cells[char.charCodeAt(0) - 48]);
  return { wall: data.walls["1"], cellsOf };
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
