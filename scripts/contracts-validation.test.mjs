import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validate, validateVectorSemantics, validateChunkSemantics } from "./contracts-validation.mjs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const schema = read("contracts/schemas/vector.v1.schema.json");
const documents = ["metadata", "tiles", "runs"].map((group) =>
  read(`contracts/vectors/${group}.vectors.json`));

function vector(id) {
  const source = documents.flatMap((doc) => doc.vectors).find((vec) => vec.id === id);
  assert.ok(source, `Published vector ${id} must exist`);
  return structuredClone(source);
}

function schemaErrors(vec) {
  const group = vec.id.startsWith("M") ? "metadata" : vec.id.startsWith("T") ? "tiles" : "runs";
  return validate(schema, { schemaVersion: 1, group, vectors: [vec] });
}

for (const [id, offset] of [["R9", 0], ["R9", 105], ["R5", 4], ["M4", 2]]) {
  test(`${id} offset ${offset} is structural but outside its own input range`, () => {
    const vec = vector(id);
    vec.cases[0].error.offset = offset;
    assert.deepEqual(schemaErrors(vec), []);
    assert.ok(validateVectorSemantics(vec).some((error) => error.includes("outside [")));
  });
}

for (const [id, baseOffset] of [["R9", 101], ["R5", 1]]) {
  test(`${id} unchanged error precedes the changed input base ${baseOffset}`, () => {
    const vec = vector(id);
    vec.context.baseOffset = baseOffset;
    assert.deepEqual(schemaErrors(vec), []);
    assert.ok(validateVectorSemantics(vec).some((error) => error.includes("outside [")));
  });
}

test("R9 rejects an offset beyond its shortened two-byte input", () => {
  const vec = vector("R9");
  vec.cases[0].hex = "0713";
  vec.cases[0].error.offset = 104;
  assert.deepEqual(schemaErrors(vec), []);
  assert.match(validateVectorSemantics(vec)[0], /outside \[100, 102\]/);
});

test("T1 with an error outcome cannot bypass the semantic input bounds", () => {
  const vec = vector("T1");
  delete vec.cases[0].result;
  vec.cases[0].error = { code: "MalformedTiles", offset: 1000 };
  assert.deepEqual(schemaErrors(vec), []);
  assert.match(validateVectorSemantics(vec)[0], /outside \[0, 1\]/);
});

for (const id of ["R5", "R9", "M4"]) {
  test(`${id} permits consistent absolute offsets after moving the input by 256 bytes`, () => {
    const vec = vector(id);
    vec.context.baseOffset += 256;
    for (const c of vec.cases) c.error.offset += 256;
    if (vec.entry === "META") {
      vec.context.inputEnd += 256;
      vec.context.sectionEnd += 256;
    }
    assert.deepEqual(schemaErrors(vec), []);
    assert.deepEqual(validateVectorSemantics(vec), []);
  });

  test(`${id} accepts both inclusive input boundaries`, () => {
    const vec = vector(id);
    for (const offset of [vec.context.baseOffset, vec.context.baseOffset + vec.cases[0].hex.length / 2]) {
      vec.cases[0].error.offset = offset;
      assert.deepEqual(schemaErrors(vec), []);
      assert.deepEqual(validateVectorSemantics(vec), []);
    }
  });
}

test("each M2 variant uses its own supplied byte count", () => {
  const vec = vector("M2");
  vec.cases[1].hex = "04000000";
  vec.cases[1].error.offset = 5;
  assert.deepEqual(schemaErrors(vec), []);
  const errors = validateVectorSemantics(vec);
  assert.ok(errors.some((error) => error.includes("case 1: error offset 5 outside [0, 4]")));
  assert.ok(errors.some((error) => error.includes("case 1: inputEnd 8")));
  assert.ok(errors.every((error) => error.includes("case 1:")));
});

test("M3 preserves a 72-byte prefix separately from the full metadata section", () => {
  const vec = vector("M3");
  assert.equal(vec.cases[0].hex.length / 2, 72);
  assert.equal(vec.context.baseOffset, 167);
  assert.equal(vec.context.inputEnd, 239);
  assert.equal(vec.context.sectionEnd, 11927);
  assert.deepEqual(schemaErrors(vec), []);
  assert.deepEqual(validateVectorSemantics(vec), []);
  vec.context.sectionEnd = 238;
  assert.deepEqual(schemaErrors(vec), []);
  assert.ok(validateVectorSemantics(vec).some((error) => error.includes("sectionEnd 238 < inputEnd 239")));
});

test("synthetic M1 inputEnd and sectionEnd must agree with the supplied fragment", () => {
  const vec = vector("M1");
  vec.context.inputEnd += 1;
  assert.deepEqual(schemaErrors(vec), []);
  assert.ok(validateVectorSemantics(vec).some((error) => error.includes("inputEnd")));
  const complete = vector("M1");
  complete.context.sectionEnd += 1;
  assert.deepEqual(schemaErrors(complete), []);
  assert.ok(validateVectorSemantics(complete).some((error) => error.includes("complete sections")));
});

test("R3 grid dimensions and tile count must match its section context", () => {
  const vec = vector("R3");
  vec.context.height = 5;
  assert.deepEqual(schemaErrors(vec), []);
  assert.ok(validateVectorSemantics(vec).some((error) => error.includes("grid does not match")));
});

test("R10 retains the legitimate first leftover-byte offset 107", () => {
  const vec = vector("R10");
  assert.equal(vec.cases[0].error.offset, 107);
  assert.deepEqual(schemaErrors(vec), []);
  assert.deepEqual(validateVectorSemantics(vec), []);
});

test("negative, fractional and missing error offsets remain schema errors", () => {
  for (const offset of [-1, 0.5, undefined]) {
    const vec = vector("T14");
    if (offset === undefined) delete vec.cases[0].error.offset;
    else vec.cases[0].error.offset = offset;
    assert.notEqual(schemaErrors(vec).length, 0);
  }
});

const chunkSchema = read("contracts/schemas/chunks.v1.schema.json");
const chunks = read("packages/test-fixtures/snapshots/m1/SCCO1.chunks.json");
const dimensions = read("packages/test-fixtures/snapshots/m1/SCCO1.meta.json").dimensions;

test("SCCO1 chunks preserve their 104 by 48 edge chunk in column-major order", () => {
  assert.equal(chunks.digests.at(-1).width, 104);
  assert.equal(chunks.digests.at(-1).height, 48);
  assert.deepEqual(validate(chunkSchema, chunks), []);
  assert.deepEqual(validateChunkSemantics(chunks, dimensions), []);
});

for (const [name, mutate] of [
  ["incorrect edge width", (doc) => { doc.digests.at(-1).width = 128; }],
  ["missing edge chunk", (doc) => { doc.digests.pop(); }],
  ["incorrect ordering", (doc) => { [doc.digests[0], doc.digests[1]] = [doc.digests[1], doc.digests[0]]; }],
]) {
  test(`SCCO1 ${name} passes structure but fails the semantic grid check`, () => {
    const doc = structuredClone(chunks);
    mutate(doc);
    assert.deepEqual(validate(chunkSchema, doc), []);
    assert.notEqual(validateChunkSemantics(doc, dimensions).length, 0);
  });
}
