// Contract files: contracts/vectors/*.vectors.json against vector.v1, every golden *.chunks.json against
// chunks.v1, the malformed-example mutations (contracts/vectors/malformed/mutations.json) must be rejected,
// plus the cross-checks a schema cannot express. Dependency-free; the validator supports exactly the keywords
// the contracts use (the same subset as dotnet/Terraria.WorldCodec.Tests/JsonSchemaSubset.cs).
// Exit: 0 OK, 1 violation.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validate, validateVectorSemantics } from "./contracts-validation.mjs";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const schemaDir = "contracts/schemas";
const vectorDir = "contracts/vectors";
const snapshotDir = "packages/test-fixtures/snapshots/m1";
const worldDir = "packages/test-fixtures/worlds";

const problems = [];
const fail = (msg) => problems.push(msg);
const vectorSchema = read(join(schemaDir, "vector.v1.schema.json"));
const chunksSchema = read(join(schemaDir, "chunks.v1.schema.json"));
const summarySchema = read(join(schemaDir, "world-summary.v1.schema.json"));

// chunks.v1 must be the summary's `chunks` object, not a second format.
for (const key of ["type", "additionalProperties", "required", "properties"]) {
  if (JSON.stringify(chunksSchema[key]) !== JSON.stringify(summarySchema.properties.chunks[key])) fail(`chunks.v1: '${key}' differs from world-summary.v1 chunks`);
}
if (JSON.stringify(chunksSchema.$defs.digest) !== JSON.stringify(summarySchema.$defs.digest)) fail("chunks.v1: digest differs from world-summary.v1");
// The vector tile mirrors the summary tile minus x and y.
const withoutXY = (t) => ({
  ...t,
  description: 0,
  required: t.required.filter((k) => k !== "x" && k !== "y"),
  properties: Object.fromEntries(Object.entries(t.properties).filter(([k]) => k !== "x" && k !== "y")),
});
if (JSON.stringify(withoutXY(summarySchema.$defs.tile)) !== JSON.stringify(withoutXY(vectorSchema.$defs.tile))) fail("vector.v1: $defs.tile differs from world-summary.v1 $defs.tile (minus x, y)");
if (JSON.stringify(vectorSchema.$defs.contentRef) !== JSON.stringify(summarySchema.$defs.contentRef)) fail("vector.v1: contentRef differs from world-summary.v1");

// Vectors.
const files = readdirSync(vectorDir).filter((f) => f.endsWith(".vectors.json")).sort();
const byId = new Map();
const expectedIds = [
  ...Array.from({ length: 17 }, (_, i) => `T${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `R${i + 1}`),
  ...Array.from({ length: 5 }, (_, i) => `M${i + 1}`),
];
const manifest = existsSync(join(worldDir, "manifest.json")) ? read(join(worldDir, "manifest.json")) : { worlds: [] };
for (const f of files) {
  const doc = read(join(vectorDir, f));
  const errors = validate(vectorSchema, doc);
  for (const e of errors) fail(`${f}: ${e}`);
  if (errors.length) continue;
  for (const vec of doc.vectors) {
    if (byId.has(vec.id)) fail(`${f}: duplicate vector ${vec.id}`);
    byId.set(vec.id, vec);
    const ctx = vec.context;
    for (const error of validateVectorSemantics(vec, `${f} ${vec.id}`)) fail(error);
    if (vec.id === "M3") {
      const p = vec.provenance;
      if (!p) { fail("M3: provenance is required"); continue; }
      const world = manifest.worlds.find((w) => w.file === `${p.world}.wld`);
      if (world?.sha256 !== p.sha256) fail(`M3: provenance sha256 does not match the manifest entry of ${p.world}`);
      if (!existsSync(p.file)) fail(`M3: ${p.file} is missing`);
      else {
        const bytes = readFileSync(p.file);
        if (bytes.subarray(p.offset, p.offset + p.length).toString("hex") !== vec.cases[0].hex || ctx.baseOffset !== p.offset) fail("M3: hex/baseOffset differ from the fixture bytes");
        // Section pointers: little-endian Int32 at 26 (pointer[0], metadata start) and 30 (pointer[1], metadata end).
        if (bytes.readInt32LE(26) !== ctx.baseOffset) fail(`M3: baseOffset ${ctx.baseOffset} != fixture pointer[0] ${bytes.readInt32LE(26)}`);
        if (bytes.readInt32LE(30) !== ctx.sectionEnd) fail(`M3: sectionEnd ${ctx.sectionEnd} != fixture pointer[1] ${bytes.readInt32LE(30)}`);
      }
    } else if (vec.provenance) fail(`${vec.id}: only M3 has provenance`);
  }
}
for (const id of expectedIds) if (!byId.has(id)) fail(`vector ${id} is missing`);
for (const id of byId.keys()) if (!expectedIds.includes(id)) fail(`unexpected vector ${id}`);
// R3 and R10 are complete sections; R10 is R3 plus one leftover byte; R9 is the deliberately cut-short section.
if (byId.get("R10")?.cases[0].hex !== `${byId.get("R3")?.cases[0].hex}00`) fail("R10 must be R3 followed by one extra 00 byte");
for (const id of ["R3", "R9", "R10"]) if (byId.get(id)?.entry !== "SEC") fail(`${id} must use entry SEC`);

// Golden chunk files: schema + 128-aligned grid whose edge sizes match the meta.json dimensions (#10, #12).
let chunkFiles = 0;
if (existsSync(snapshotDir)) {
  for (const f of readdirSync(snapshotDir).filter((n) => n.endsWith(".chunks.json")).sort()) {
    chunkFiles++;
    const doc = read(join(snapshotDir, f));
    const errors = validate(chunksSchema, doc);
    for (const e of errors) fail(`${f}: ${e}`);
    const metaPath = join(snapshotDir, f.replace(".chunks.json", ".meta.json"));
    if (errors.length) continue;
    if (!existsSync(metaPath)) { fail(`${f}: ${metaPath} is missing`); continue; }
    const { dimensions } = read(metaPath);
    const expected = Math.ceil(dimensions.width / 128) * Math.ceil(dimensions.height / 128);
    if (doc.digests.length !== expected) fail(`${f}: ${doc.digests.length} digests, expected ${expected}`);
    // x and y are chunk indices (column-major order: x, then y), not tile coordinates.
    doc.digests.forEach((d, i) => {
      const w = Math.min(128, dimensions.width - d.x * 128);
      const h = Math.min(128, dimensions.height - d.y * 128);
      const rows = Math.ceil(dimensions.height / 128);
      if (d.x !== Math.floor(i / rows) || d.y !== i % rows || d.width !== w || d.height !== h) fail(`${f}: chunk #${i} (${d.x},${d.y}) is ${d.width}x${d.height}, expected ${w}x${h} at its place in the 128 grid`);
    });
  }
}

// Malformed examples: path mutations of a valid file; each mutated document must be rejected.
const mutations = read(join(vectorDir, "malformed", "mutations.json"));
for (const m of mutations.cases) {
  const schema = m.schema === "vector.v1" ? vectorSchema : m.schema === "chunks.v1" ? chunksSchema : null;
  if (!schema) { fail(`malformed ${m.name}: unknown schema ${m.schema}`); continue; }
  const source = join(m.schema === "vector.v1" ? vectorDir : snapshotDir, m.file);
  if (!existsSync(source)) { fail(`malformed ${m.name}: ${source} is missing`); continue; }
  const doc = read(source);
  let target = doc;
  for (const key of m.path.slice(0, -1)) target = target[key];
  const last = m.path.at(-1);
  if (m.op === "delete") delete target[last]; else target[last] = m.value;
  if (validate(schema, doc).length === 0) fail(`malformed ${m.name}: mutated document is still valid`);
}

if (problems.length) {
  console.log("CONTRACTS: violations:");
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log(`CONTRACTS: OK — ${byId.size} vectors, ${chunkFiles} chunk file(s), ${mutations.cases.length} malformed example(s)`);
