import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  assertGoldenPair, assertVectorCase, decodeVectorCase, loadContractJson, loadWorldSummary,
  summarizeWorld, validateGoldenPair, validateVectorDocument,
  type GoldenPair, type VectorDocument,
} from "./shared-contract-support.js";

// A contract test must never generate an oracle or delegate decoding to .NET.
vi.mock("node:child_process", () => {
  const forbidden = (): never => { throw new Error("Contract tests must not invoke external processes (.NET)"); };
  return { spawn: forbidden, spawnSync: forbidden, exec: forbidden, execSync: forbidden,
    execFile: forbidden, execFileSync: forbidden, fork: forbidden };
});

const vectorsDir = new URL("../../../contracts/vectors/", import.meta.url);
const worldsDir = new URL("../../test-fixtures/worlds/", import.meta.url);
const snapshotsDir = new URL("../../test-fixtures/snapshots/m1/", import.meta.url);
const documents = ["tiles", "runs", "metadata"].map((group) => ({
  name: `${group}.vectors.json`,
  document: JSON.parse(readFileSync(new URL(`${group}.vectors.json`, vectorsDir), "utf8")) as VectorDocument,
}));
const variants = documents.flatMap(({ document }) => document.vectors.flatMap((vector) =>
  vector.cases.map((variant, index) => ({ name: `${vector.id} variant ${String(index + 1)}`, vector, variant })),
));
const manifest = JSON.parse(readFileSync(new URL("manifest.json", worldsDir), "utf8")) as {
  worlds: { file: string; dimensions: { width: number; height: number } }[];
};
const readGolden = (file: string): GoldenPair => {
  const name = file.replace(/\.wld$/, "");
  return {
    meta: JSON.parse(readFileSync(new URL(`${name}.meta.json`, snapshotsDir), "utf8")) as GoldenPair["meta"],
    chunks: JSON.parse(readFileSync(new URL(`${name}.chunks.json`, snapshotsDir), "utf8")) as GoldenPair["chunks"],
  };
};

describe("shared vector contracts", () => {
  it.each(documents)("validates the exact $name schema and semantics", ({ name, document }) => {
    expect(loadContractJson(new URL(name, vectorsDir))).toEqual(document);
    expect(() => { validateVectorDocument(document, name); }).not.toThrow();
  });

  it.each(variants)("decodes $name at its declared entry", ({ vector, variant }) => {
    const actual = decodeVectorCase(vector, variant);
    if (variant.error) expect(actual).toMatchObject({ error: variant.error });
    else expect(actual).toEqual({ result: variant.result });
    expect(() => { assertVectorCase(vector, variant); }).not.toThrow();
  });

  it("rejects a schema-invalid vector document by file name", () => {
    const document = structuredClone(documents[0]?.document);
    expect(document).toBeDefined();
    expect(() => { validateVectorDocument({ ...document, schemaVersion: 2 }, "tiles.vectors.json"); })
      .toThrow(/tiles\.vectors\.json/);
  });

  it("rejects an unsupported entry by vector name", () => {
    const row = variants.find(({ vector }) => vector.id === "T2");
    if (!row) throw new Error("Missing shared vector T2");
    expect(() => decodeVectorCase({ ...row.vector, entry: "WORLD" }, row.variant)).toThrow(/T2.*WORLD|WORLD.*T2/);
  });

  it("detects a changed expected semantic value without changing the contract", () => {
    const row = variants.find(({ vector }) => vector.id === "T2");
    if (!row?.variant.result) throw new Error("Missing shared vector T2 result");
    expect(() => { assertVectorCase(row.vector, row.variant); }).not.toThrow();
    const changed = { ...row.variant, result: { ...row.variant.result, run: 1 } };
    expect(() => { assertVectorCase(row.vector, changed); }).toThrow(/T2/);
    expect(readFileSync(new URL("tiles.vectors.json", vectorsDir), "utf8"))
      .toContain('"run": 0');
  });

  it("detects a changed exact error offset", () => {
    const row = variants.find(({ vector }) => vector.id === "R10");
    if (!row?.variant.error) throw new Error("Missing shared vector R10 error");
    expect(() => { assertVectorCase(row.vector, row.variant); }).not.toThrow();
    expect(() => { assertVectorCase(row.vector, { ...row.variant, error: { ...row.variant.error, offset: 108 } }); })
      .toThrow(/R10/);
  });

  it("rejects a schema-valid vector with an offset beyond its supplied bytes", () => {
    const document = structuredClone(documents.find(({ name }) => name === "runs.vectors.json")?.document);
    if (!document) throw new Error("Missing runs.vectors.json");
    const vector = document.vectors.find(({ id }) => id === "R10");
    const variant = vector?.cases[0];
    if (!variant?.error) throw new Error("Missing shared vector R10 error");
    variant.error["offset"] = 109;
    expect(() => { validateVectorDocument(document, "runs.vectors.json"); }).toThrow(/R10/);
  });
});

describe("shared golden contracts", () => {
  it.each(manifest.worlds)("matches every summary field and chunk plane for $file", ({ file, dimensions }) => {
    const expected = readGolden(file);
    const actual = summarizeWorld(new Uint8Array(readFileSync(new URL(file, worldsDir))), file);
    expect(() => { validateGoldenPair(actual, file); }).not.toThrow();
    expect(actual.meta).toEqual(expected.meta);
    expect(actual.chunks).toEqual(expected.chunks);
    const positions = [];
    for (let x = 0; x < Math.ceil(dimensions.width / 128); x++) {
      for (let y = 0; y < Math.ceil(dimensions.height / 128); y++) {
        positions.push({ x, y, width: Math.min(128, dimensions.width - x * 128),
          height: Math.min(128, dimensions.height - y * 128) });
      }
    }
    expect(actual.chunks.size).toBe(128);
    expect(actual.chunks.planes).toEqual([
      "block", "wall", "frameX", "frameY", "paint", "wallPaint", "liquid", "liquidAmount", "shape", "flags",
    ]);
    expect(actual.chunks.digests.map(({ x, y, width, height }) => ({ x, y, width, height }))).toEqual(positions);
    expect(() => { assertGoldenPair(actual, expected, file); }).not.toThrow();
  }, 120_000);

  it("detects altered summary values and valid-format digests without refreshing goldens", () => {
    const metaPath = new URL("SCCO1.meta.json", snapshotsDir);
    const chunksPath = new URL("SCCO1.chunks.json", snapshotsDir);
    const before = [readFileSync(metaPath, "utf8"), readFileSync(chunksPath, "utf8")];
    const expected = readGolden("SCCO1.wld");
    const actual = summarizeWorld(new Uint8Array(readFileSync(new URL("SCCO1.wld", worldsDir))), "SCCO1.wld");
    expect(() => { assertGoldenPair(actual, expected, "SCCO1.wld"); }).not.toThrow();
    const changedMeta = structuredClone(expected);
    changedMeta.meta["formatVersion"] = 325;
    expect(() => { assertGoldenPair(actual, changedMeta, "SCCO1.wld"); }).toThrow(/SCCO1/);
    const changedDigest = structuredClone(expected);
    const edge = changedDigest.chunks.digests.at(-1);
    if (!edge) throw new Error("Missing SCCO1 edge chunk");
    edge["frameX"] = edge["frameX"] === "0000000000000000" ? "1111111111111111" : "0000000000000000";
    expect(() => { validateGoldenPair(changedDigest, "SCCO1.wld"); }).not.toThrow();
    expect(() => { assertGoldenPair(actual, changedDigest, "SCCO1.wld"); }).toThrow(/SCCO1/);
    expect([readFileSync(metaPath, "utf8"), readFileSync(chunksPath, "utf8")]).toEqual(before);
  }, 120_000);

  it("rejects malformed summary and chunk output", () => {
    const expected = readGolden("SCCO1.wld");
    expect(() => { validateGoldenPair(expected, "SCCO1.wld"); }).not.toThrow();
    expect(() => { validateGoldenPair({ ...expected, meta: { ...expected.meta, schemaVersion: 2 } }, "SCCO1.wld"); })
      .toThrow(/SCCO1/);
    const changed = structuredClone(expected);
    const edge = changed.chunks.digests.at(-1);
    if (!edge) throw new Error("Missing SCCO1 edge chunk");
    edge["width"] = 128;
    expect(() => { validateGoldenPair(changed, "SCCO1.wld"); }).toThrow(/SCCO1/);
  });
});

describe("named missing contract inputs", () => {
  it.each([new URL("missing.tiles.vectors.json", vectorsDir), new URL("SCCO1.missing.meta.json", snapshotsDir),
    new URL("SCCO1.missing.chunks.json", snapshotsDir)])("reports the missing JSON file %s", (path) => {
    expect(() => loadContractJson(path)).toThrow(new RegExp(path.pathname.split("/").at(-1) ?? "missing"));
  });
  it("reports a missing manifest world by fixture name", () => {
    expect(() => loadWorldSummary(new URL("SCCO2.wld", worldsDir))).toThrow(/SCCO2\.wld/);
  });
});
