import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compareCwm, runDifferential } from "./cwm.mjs";

function cwm({ width = 130, height = 129, name = "SCCR2", palette = [{ kind: "vanilla", id: 1 }] } = {}) {
  const header = Buffer.from(JSON.stringify({ schemaVersion: 1, formatVersion: 326,
    metadata: { name, seed: "1533482611", guid: null, worldId: 184602311, gameMode: 0, evil: "crimson" },
    dimensions: { width, height }, palette }));
  const bytes = Buffer.alloc(12 + header.length + 15 * width * height);
  bytes.write("CWM\0"); bytes.writeUInt32LE(1, 4); bytes.writeUInt32LE(header.length, 8);
  header.copy(bytes, 12);
  return bytes;
}

test("byte-identical valid exports agree, with no dump of world data", () => {
  assert.equal(compareCwm(cwm(), cwm()), null);
});

test("plane differences locate column-major coordinates, edge chunks and byte offsets", () => {
  const left = cwm(); const right = Buffer.from(left);
  const payload = 12 + left.readUInt32LE(8);
  const offset = payload + 14 * 130 * 129 + (129 * 129 + 128) * 2 + 1;
  right[offset] = 1;
  assert.match(compareCwm(left, right), new RegExp(`plane flags, chunk \\(1,1\\), coordinate \\(129,128\\), byte offset ${offset}`));
});

test("header, palette and prefix mismatches name the region", () => {
  assert.match(compareCwm(cwm(), cwm({ name: "SCCR3" })), /header metadata/);
  assert.match(compareCwm(cwm(), cwm({ palette: [{ kind: "vanilla", id: 2 }] })), /header palette/);
  const right = cwm(); right[0] = 0;
  assert.match(compareCwm(cwm(), right), /prefix magic/);
});

test("identical malformed exports cannot pass", () => {
  const valid = cwm();
  for (const bytes of [valid.subarray(0, 8), valid.subarray(0, valid.length - 1), Buffer.concat([valid, Buffer.of(0)])]) {
    assert.match(compareCwm(bytes, bytes), /invalid/);
  }
  const version = cwm(); version.writeUInt32LE(2, 4);
  assert.match(compareCwm(version, version), /schema version/);
  const dimensions = cwm({ width: 0 });
  assert.match(compareCwm(dimensions, dimensions), /dimensions/);
});

async function corpus(t) {
  const root = await mkdtemp(join(tmpdir(), "terraria-cwm-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixtures = join(root, "worlds"); await mkdir(fixtures);
  await writeFile(join(fixtures, "manifest.json"), JSON.stringify({ schemaVersion: 1,
    worlds: [{ file: "SCCO1.wld" }, { file: "SCCR2.wld" }] }));
  for (const file of ["SCCO1.wld", "SCCR2.wld"]) await writeFile(join(fixtures, file), Buffer.of(70, 1));
  return { fixtures, artifacts: join(root, "artifacts") };
}

function exporters(calls, { missing = false, mismatch = false, failure = false } = {}) {
  return async (command, args) => {
    calls.push({ command, args });
    if (failure) throw new Error("TypeScript export failed: unsupported world format");
    if (command === "dotnet") await writeFile(args.at(-1), cwm());
    else for (const file of ["SCCO1.cwm", "SCCR2.cwm"]) {
      if (missing && file === "SCCR2.cwm") continue;
      const bytes = cwm(); if (mismatch) bytes[bytes.length - 1] = 1;
      await writeFile(join(args.at(-1), file), bytes);
    }
  };
}

test("all manifest entries invoke independent exporters and compare artifacts", async (t) => {
  const paths = await corpus(t); const calls = [];
  await runDifferential({ ...paths, execute: exporters(calls) });
  assert.equal(calls.filter(({ command }) => command === "dotnet").length, 2);
  assert.equal(calls.filter(({ command }) => command === process.execPath).length, 1);
  assert.ok(calls.filter(({ command }) => command === "dotnet").every(({ args }) => args.includes("export-cwm")));
  assert.match(await readFile(join(paths.artifacts, "report.txt"), "utf8"), /PASS SCCO1.wld[\s\S]*PASS SCCR2.wld/);
});

test("missing exports and deliberate plane mismatches fail with fixture diagnostics", async (t) => {
  for (const options of [{ missing: true }, { mismatch: true }]) {
    const paths = await corpus(t);
    await assert.rejects(runDifferential({ ...paths, execute: exporters([], options) }), /CWM differential failed/);
    const report = await readFile(join(paths.artifacts, "report.txt"), "utf8");
    assert.match(report, /FAIL SCCR2.wld/);
    assert.match(report, options.missing ? /missing TypeScript export/ : /plane flags, chunk/);
  }
});

test("missing fixtures, exporter failures and invalid manifests fail instead of skipping", async (t) => {
  const paths = await corpus(t); const calls = [];
  await rm(join(paths.fixtures, "SCCR2.wld"));
  await assert.rejects(runDifferential({ ...paths, execute: exporters(calls) }), /missing fixture SCCR2.wld/);
  assert.equal(calls.length, 0);
  const failing = await corpus(t);
  await assert.rejects(runDifferential({ ...failing, execute: exporters([], { failure: true }) }), /export failed/);
  assert.match(await readFile(join(failing.artifacts, "report.txt"), "utf8"), /unsupported world format/);
  for (const worlds of [[], [{ file: "../SCCR2.wld" }], [{ file: "SCCR2.wld" }, { file: "sccr2.wld" }]]) {
    const invalid = await corpus(t);
    await writeFile(join(invalid.fixtures, "manifest.json"), JSON.stringify({ schemaVersion: 1, worlds }));
    await assert.rejects(runDifferential({ ...invalid, execute: exporters([]) }), /manifest/i);
  }
});
