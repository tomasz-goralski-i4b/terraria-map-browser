// Writes the committed framing database (ADR 0003) from the observer's database output:
//   ./scripts/framing/observe.ps1 -TerrariaAssembly '<Terraria>/TerrariaServer.exe' -Mode Database -OutputPath local-renders/framing-database.json
//   node scripts/framing/export-database.mjs local-renders/framing-database.json
// Refuses an incomplete observation, any failed verification, and any shaped-corner result the documented rule does not
// predict. The output, packages/renderer/src/framing/terraria-framing.generated.ts, is regenerated, never edited by hand.
import { deflateRawSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { predictInterior } from "./analyse.mjs";

export const OUTPUT = "packages/renderer/src/framing/terraria-framing.generated.ts";

/** Cell indices are stored one char each, as char code − 48 (observe.ps1). */
const cellIndexAt = (table, code) => table.charCodeAt(code) - 48;

/**
 * The shaped-corner rule of docs/assets.md ("Slopes and half blocks"): with all four sides connected, a corner
 * neighbour counts by presence alone, whatever its shape. Returns the number of combinations it does not predict.
 */
export function shapedCornerMismatches(database) {
  let mismatches = 0;
  const cell = (index) => {
    const [column, row] = database.cells[index] ?? [];
    return `(${String(column)},${String(row)})`;
  };
  for (const [name, options] of [["dirt", 7], ["stoneWithDirt", 13]]) {
    const data = database.shapedCorners[name];
    const combos = options ** 4;
    for (let index = 0; index < data.length; index++) {
      let rest = index % combos;
      const corners = {};
      for (const corner of ["NW", "NE", "SE", "SW"]) {
        const option = rest % options;
        rest = Math.floor(rest / options);
        corners[corner] = option === 0 ? "x" : option > 6 ? "d" : "o";
      }
      if (predictInterior(corners) !== cell(cellIndexAt(data, index))) mismatches++;
    }
  }
  return mismatches;
}

/**
 * Merges the shards of one observation (observe.ps1 -Shard i -Shards n) into one database: every shard numbers its
 * cells and tables itself, so cells are matched by (column, row) and tables re-encoded and pooled again. Shard 0
 * carries the walls and the shaped corners.
 */
export function mergeShards(shards) {
  const sorted = [...shards].sort((a, b) => (a.shard ?? 0) - (b.shard ?? 0));
  const count = sorted[0]?.shards ?? 1;
  if (sorted.length !== count || sorted.some((shard, index) => (shard.shard ?? 0) !== index)) {
    throw new Error(`expected shards 0–${String(count - 1)}, got ${sorted.map((shard) => String(shard.shard)).join(", ")}`);
  }
  if (sorted.some((shard) => shard.complete !== true)) throw new Error("a shard is incomplete");
  // Every shard must have found the same block types, and together they must cover each exactly once.
  const typeList = JSON.stringify(sorted[0].blockTypes);
  if (sorted.some((shard) => JSON.stringify(shard.blockTypes) !== typeList)) throw new Error("the shards found different block types");
  const covered = sorted.flatMap((shard) => shard.types.map((type) => type.id)).sort((a, b) => a - b);
  if (JSON.stringify(covered) !== JSON.stringify([...sorted[0].blockTypes].sort((a, b) => a - b))) {
    throw new Error("the shards do not cover every block type exactly once");
  }
  const cells = [];
  const cellIndex = new Map();
  const tables = [];
  const pool = new Map();
  const merged = { gameVersion: sorted[0].gameVersion, types: [], walls: [], verified: 0, failures: 0, failureList: "", complete: true };
  for (const shard of sorted) {
    if (shard.gameVersion !== merged.gameVersion) throw new Error("the shards come from different game versions");
    const remapCell = (local) => {
      const [column, row] = shard.cells[local];
      const key = `${String(column)},${String(row)}`;
      if (!cellIndex.has(key)) { cellIndex.set(key, cells.length); cells.push([column, row]); }
      return cellIndex.get(key);
    };
    const remapText = (text) => [...text].map((char) => String.fromCharCode(remapCell(char.charCodeAt(0) - 48) + 48)).join("");
    const remapTable = (local) => {
      const text = remapText(shard.tables[local]);
      if (!pool.has(text)) { pool.set(text, tables.length); tables.push(text); }
      return pool.get(text);
    };
    for (const type of shard.types) {
      merged.types.push({
        ...type,
        alone: remapTable(type.alone),
        tables: type.tables.map((group) => ({ ...group, table: remapTable(group.table) })),
        variants: (type.variants ?? []).map((entry) => entry.map(remapCell)),
        ...(type.byPosition === undefined ? {} : { byPosition: type.byPosition.map(remapTable) }),
      });
    }
    if (shard.walls !== undefined) {
      merged.walls = shard.walls.map((wall) => ({
        ...wall, table: remapTable(wall.table), interiorByPosition: remapTable(wall.interiorByPosition),
        variants: (wall.variants ?? []).map((entry) => entry.map(remapCell)),
      }));
      merged.wallNeighbourBlocks = shard.wallNeighbourBlocks;
      merged.shapedCorners = Object.fromEntries(Object.entries(shard.shapedCorners).map(([name, text]) => [name, remapText(text)]));
    }
    merged.verified += shard.verified;
    merged.failures += shard.failures;
    merged.failureList = `${merged.failureList} ${String(shard.failureList)}`.trim();
  }
  const order = new Map((sorted[0].blockTypes ?? []).map((type, index) => [type, index]));
  merged.types.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { ...merged, cells, tables };
}

/** The module text: metadata as JSON, every used table deflated (raw) and base64-encoded. */
export function moduleText(database) {
  if (database.complete !== true) throw new Error("the framing database is incomplete");
  if (database.failures !== 0) throw new Error(`the framing database has ${String(database.failures)} failed verifications: ${String(database.failureList)}`);
  const cornerMismatches = shapedCornerMismatches(database);
  if (cornerMismatches !== 0) throw new Error(`the shaped-corner rule misses ${String(cornerMismatches)} combinations`);
  // Renumber the tables that are used, so the module carries no unused ones.
  const used = new Map();
  const use = (index) => {
    if (!used.has(index)) used.set(index, used.size);
    return used.get(index);
  };
  // Variant maps: each distinct map stored once, as triplets of cell-index chars (v0, v1, v2), deflated like tables.
  const variantPool = new Map();
  const variantMap = (entries) => {
    const text = [...entries].sort((a, b) => a[0] - b[0]).map((entry) => entry.map((index) => String.fromCharCode(index + 48)).join("")).join("");
    if (!variantPool.has(text)) variantPool.set(text, variantPool.size);
    return variantPool.get(text);
  };
  // Relations: one row per block type, one char per other type in `blockTypes` order: `-` itself, `x` like air,
  // `o` like itself, `A`… its table `tables[k]` (k = char − 65) in the type's `tables`.
  const blockTypes = database.types.map((type) => type.id);
  const blocks = {};
  const rows = [];
  for (const type of database.types) {
    const relation = new Map(type.self.map((other) => [other, "o"]));
    type.tables.forEach((group, k) => { for (const other of group.others) relation.set(other, String.fromCharCode(65 + k)); });
    rows.push(blockTypes.map((other) => (other === type.id ? "-" : relation.get(other) ?? "x")).join(""));
    blocks[type.id] = {
      alone: use(type.alone),
      tables: type.tables.map((group) => use(group.table)),
      variants: variantMap(type.variants ?? []),
      ...(type.byPosition === undefined ? {} : { byPosition: type.byPosition.map(use), variantIgnoredByPosition: type.variantIgnoredByPosition }),
    };
  }
  const relations = deflateRawSync(Buffer.from(rows.join("\n"), "utf8"), { level: 9 }).toString("base64");
  const walls = {};
  for (const wall of database.walls) {
    walls[wall.id] = {
      table: use(wall.table), interiorByPosition: use(wall.interiorByPosition),
      variantChangesInterior: wall.variantChangesInterior, variants: variantMap(wall.variants ?? []),
    };
  }
  const tables = [...used.keys()].map((index) => deflateRawSync(Buffer.from(database.tables[index], "utf8"), { level: 9 }).toString("base64"));
  const variantMaps = [...variantPool.keys()].map((text) => deflateRawSync(Buffer.from(text, "utf8"), { level: 9 }).toString("base64"));
  const data = {
    gameVersion: database.gameVersion, cells: database.cells, tables, variantMaps, blockTypes, relations, blocks, walls,
    wallNeighbourBlocks: database.wallNeighbourBlocks,
  };
  return [
    "// Generated by scripts/framing/export-database.mjs from the framing observer (ADR 0003). Do not edit by hand:",
    "// regenerate it after a game update (scripts/framing/README.md).",
    "import type { FramingDatabaseData } from \"./framing-database.js\";",
    "",
    `export const terrariaFramingData: FramingDatabaseData = ${JSON.stringify(data)};`,
    "",
  ].join("\n");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputs = process.argv.slice(2);
  if (inputs.length === 0) throw new Error("usage: node scripts/framing/export-database.mjs <database.json or every shard's json>");
  const parsed = inputs.map((input) => JSON.parse(readFileSync(input, "utf8")));
  const database = parsed.length === 1 && parsed[0].shards === undefined ? parsed[0] : mergeShards(parsed);
  const text = moduleText(database);
  writeFileSync(OUTPUT, text);
  console.log(`${OUTPUT}: ${String(Math.round(text.length / 1024))} KiB`);
}
