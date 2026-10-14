import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compareSingleTileEdit, compareWorldBytes, runCorruptionProbe, runWriterDifferential } from "./writer.mjs";
import { execute } from "./cwm.mjs";

function cwm() {
  const header = Buffer.from(JSON.stringify({ schemaVersion: 1, formatVersion: 326,
    metadata: { name: "SCCR2", seed: "1533482611", guid: null, worldId: 184602311, gameMode: 0, evil: "crimson" },
    dimensions: { width: 2, height: 3 }, palette: [{ kind: "vanilla", id: 1 }] }));
  const bytes = Buffer.alloc(12 + header.length + 90);
  bytes.write("CWM\0"); bytes.writeUInt32LE(1, 4); bytes.writeUInt32LE(header.length, 8); header.copy(bytes, 12);
  return bytes;
}
const edit = { x: 1, y: 2, plane: "flags", mask: 1 };
function edited() {
  const bytes = cwm(); bytes[12 + bytes.readUInt32LE(8) + 13 * 6 + 5 * 2] ^= 1;
  return bytes;
}
function worldBytes() {
  const bytes = Buffer.alloc(180);
  bytes.writeInt32LE(326); bytes.write("relogic", 4); bytes[11] = 2;
  bytes.writeInt16LE(11, 24); bytes.writeInt32LE(74, 26); bytes.writeInt32LE(160, 30);
  bytes[160] = 0x40; bytes[161] = 2; // Empty tile column, run length two.
  return bytes;
}

test("world byte comparison reports the first mismatch and truncation offset", () => {
  const source = worldBytes(); const corrupt = Buffer.from(source); corrupt[161] ^= 1;
  assert.equal(compareWorldBytes(source, source), null);
  assert.match(compareWorldBytes(source, corrupt), /byte offset 161/);
  assert.match(compareWorldBytes(source, source.subarray(0, 179)), /byte offset 179/);
});
test("edited CWM must change precisely the selected wire bit at one coordinate", () => {
  assert.equal(compareSingleTileEdit(cwm(), edited(), edit), null);
  assert.match(compareSingleTileEdit(cwm(), cwm(), edit), /coordinate \(1,2\)/);
  const extra = edited(); extra[extra.length - 1] ^= 2;
  assert.match(compareSingleTileEdit(cwm(), extra, edit), /byte offset/);
  const neighbor = edited(); neighbor[neighbor.length - 4] ^= 1;
  assert.match(compareSingleTileEdit(cwm(), neighbor, edit), /coordinate \(1,1\)/);
  assert.match(compareSingleTileEdit(cwm(), edited().subarray(0, -1), edit), /invalid/);
  assert.match(compareSingleTileEdit(cwm(), edited(), { ...edit, x: 2 }), /coordinate/);
});

async function corpus(t) {
  const directory = await mkdtemp(join(tmpdir(), "terraria-writer-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixtures = join(directory, "worlds"); await mkdir(fixtures);
  await writeFile(join(fixtures, "manifest.json"), JSON.stringify({ schemaVersion: 1,
    worlds: [{ file: "SCCO1.wld" }, { file: "SCCR2.wld" }] }));
  for (const file of ["SCCO1.wld", "SCCR2.wld"]) await writeFile(join(fixtures, file), worldBytes());
  return { fixtures, artifacts: join(directory, "artifacts") };
}
function runners(calls, { missing, corrupt, spill, failure } = {}) {
  return async (command, args) => {
    calls.push({ command, args });
    if (failure) throw new Error("unsupported world format 327");
    if (command === "dotnet") {
      if (basename(args.at(-1)) === missing) return;
      await writeFile(args.at(-1), args.includes("roundtrip") ? worldBytes() :
        args.at(-2).includes("edited") ? edited() : cwm());
    } else {
      const directory = args.at(-1);
      for (const name of ["unchanged.wld", "edited.wld", "original.cwm", "edited.cwm", "edit.json"]) {
        if (name === missing) continue;
        let bytes = name.endsWith(".wld") ? worldBytes() : name === "original.cwm" ? cwm() : edited();
        if (name === "edit.json") bytes = JSON.stringify(edit);
        if (corrupt && name === "unchanged.wld") bytes[161] ^= 1;
        if (spill && name === "edited.cwm") bytes[bytes.length - 4] ^= 1;
        await writeFile(join(directory, name), bytes);
      }
    }
  };
}
test("every manifest world is saved twice and independently read by .NET", async (t) => {
  const paths = await corpus(t); const calls = [];
  await runWriterDifferential({ ...paths, execute: runners(calls) });
  assert.equal(calls.filter(({ command }) => command === process.execPath).length, 2);
  assert.equal(calls.filter(({ args }) => args.includes("roundtrip")).length, 2);
  assert.equal(calls.filter(({ args }) => args.includes("export-cwm")).length, 4);
  assert.match(await readFile(join(paths.artifacts, "report.txt"), "utf8"), /PASS SCCO1.wld[\s\S]*PASS SCCR2.wld/);
});
test("missing writer and reader artifacts fail instead of skipping", async (t) => {
  for (const missing of ["unchanged.wld", "edited.wld", "original.cwm", "edited.cwm", "edit.json", "reference.wld", "unchanged-dotnet.cwm", "edited-dotnet.cwm"]) {
    const paths = await corpus(t);
    await assert.rejects(runWriterDifferential({ ...paths, execute: runners([], { missing }) }));
    assert.match(await readFile(join(paths.artifacts, "report.txt"), "utf8"), /SCCO1.wld.*missing/);
  }
});
test("corrupt tile bytes, unintended edits and exporter errors fail with fixture diagnostics", async (t) => {
  for (const options of [{ corrupt: true }, { spill: true }, { failure: true }]) {
    const paths = await corpus(t);
    await assert.rejects(runWriterDifferential({ ...paths, execute: runners([], options) }));
    const report = await readFile(join(paths.artifacts, "report.txt"), "utf8");
    assert.match(report, /SCCO1.wld/);
    assert.match(report, options.corrupt ? /byte offset 161/ : options.spill ? /coordinate \(1,1\)/ : /unsupported world format/);
  }
});
test("the corruption probe flips a real tile byte and must trigger the normal comparator", async (t) => {
  const paths = await corpus(t);
  await assert.rejects(runWriterDifferential({ ...paths, execute: runners([]), corrupt: true }), /SCCO1.wld.*byte offset 161/);
});
test("negative control must not mistake an existing writer defect or process failure for success", async (t) => {
  const paths = await corpus(t);
  await runCorruptionProbe({ ...paths, execute: runners([]) });
  for (const options of [{ corrupt: true }, { failure: true }, { missing: "unchanged.wld" }]) {
    const invalid = await corpus(t);
    await assert.rejects(runCorruptionProbe({ ...invalid, execute: runners([], options) }));
  }
});
test("invalid manifests and absent fixture files fail before invoking any codec", async (t) => {
  for (const worlds of [[], [{ file: "../SCCR2.wld" }], [{ file: "SCCR2.wld" }, { file: "sccr2.wld" }]]) {
    const paths = await corpus(t); const calls = [];
    await writeFile(join(paths.fixtures, "manifest.json"), JSON.stringify({ schemaVersion: 1, worlds }));
    await assert.rejects(runWriterDifferential({ ...paths, execute: runners(calls) }), /manifest/i);
    assert.equal(calls.length, 0);
  }
  const paths = await corpus(t); const calls = [];
  await rm(join(paths.fixtures, "SCCR2.wld"));
  await assert.rejects(runWriterDifferential({ ...paths, execute: runners(calls) }), /missing fixture SCCR2.wld/);
  assert.equal(calls.length, 0);
});
test("writer artifacts must use fresh temporary directories", async (t) => {
  const paths = await corpus(t);
  await assert.rejects(runWriterDifferential({ ...paths, artifacts: join(import.meta.dirname, "writer-artifacts"), execute: runners([]) }), /Artifacts must be/);
  await mkdir(paths.artifacts);
  await assert.rejects(runWriterDifferential({ ...paths, execute: runners([]) }), /EEXIST/);
});
test("CI requires the writer crosscheck and its negative control after building the TS API", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const job = workflow.split("  cwm-compatibility:")[1].split("  verify:")[0];
  assert.match(job, /run: node scripts\/compatibility\/writer.mjs\n/);
  assert.match(job, /run: node scripts\/compatibility\/writer.mjs --corruption-probe/);
  assert.ok(job.indexOf("pnpm -s typecheck") < job.indexOf("node --test"));
  assert.doesNotMatch(job, /continue-on-error|paths-ignore/);
});
test("real TS save CLI publishes both saves and pre-save CWM, and refuses existing artifacts", async (t) => {
  const paths = await corpus(t); await mkdir(paths.artifacts);
  const cli = new URL("./save-world.mjs", import.meta.url);
  const source = new URL("../../packages/test-fixtures/worlds/SCCR2.wld", import.meta.url);
  await execute(process.execPath, [fileURLToPath(cli), fileURLToPath(source), paths.artifacts]);
  const original = await readFile(join(paths.artifacts, "original.cwm"));
  const expected = await readFile(join(paths.artifacts, "edited.cwm"));
  const operation = JSON.parse(await readFile(join(paths.artifacts, "edit.json"), "utf8"));
  assert.deepEqual(operation, { x: 129, y: 128, plane: "flags", mask: 1 });
  assert.equal(compareSingleTileEdit(original, expected, operation), null);
  for (const variant of ["unchanged", "edited"]) {
    const saved = await readFile(join(paths.artifacts, `${variant}.wld`));
    assert.equal(saved.readInt32LE(0), 326);
    assert.ok(saved.length > 2_000_000);
  }
  await assert.rejects(execute(process.execPath, [fileURLToPath(cli), fileURLToPath(source), paths.artifacts]), /EEXIST/);
  assert.deepEqual(await readFile(join(paths.artifacts, "original.cwm")), original);
});
