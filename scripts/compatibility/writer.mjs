import { access, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareCwm, execute, framing, inside, manifestFiles } from "./cwm.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
class CorruptionDetected extends Error {}

export function compareWorldBytes(left, right) {
  const length = Math.min(left.length, right.length);
  for (let offset = 0; offset < length; offset++) {
    if (left[offset] !== right[offset]) return `world bytes differ, byte offset ${offset}`;
  }
  return left.length === right.length ? null : `world length differs, byte offset ${length}`;
}

/** No palette changes are needed for a wire edit, so exact CWM bytes can prove its complete scope. */
export function compareSingleTileEdit(original, actual, edit) {
  let layout;
  try { layout = framing(original); } catch (error) { return `invalid original CWM: ${error.message}`; }
  if (edit?.plane !== "flags" || edit.mask !== 1 || !Number.isInteger(edit.x) || !Number.isInteger(edit.y)
    || edit.x < 0 || edit.x >= layout.width || edit.y < 0 || edit.y >= layout.height) return "invalid edit coordinate or red-wire operation";
  const expected = Buffer.from(original);
  const offset = layout.start + layout.cells * 13 + (edit.x * layout.height + edit.y) * 2;
  expected[offset] ^= 1;
  return compareCwm(expected, actual);
}

async function required(path) {
  try { return await readFile(path); }
  catch (error) {
    if (error.code === "ENOENT") throw new Error(`missing output ${path.split(/[\\/]/).at(-1)}`);
    throw error;
  }
}

/** .NET receives only .wld files; the TS pre-save expectations stay exclusively in the harness. */
export async function runWriterDifferential({ fixtures = join(root, "packages/test-fixtures/worlds"), artifacts,
  execute: run = execute, corrupt = false } = {}) {
  await mkdir(join(root, ".tdd"), { recursive: true });
  if (artifacts === undefined) artifacts = await mkdtemp(join(root, ".tdd/cwm-writer-"));
  else {
    const target = join(await realpath(resolve(artifacts, "..")), resolve(artifacts).split(/[\\/]/).at(-1));
    if (!inside(await realpath(tmpdir()), target) && !inside(await realpath(join(root, ".tdd")), target)) {
      throw new Error("Artifacts must be in the system temporary directory or .tdd");
    }
    await mkdir(artifacts); // Existing artifacts must never mask a writer that failed to produce an output.
  }
  const report = [];
  try {
    const files = manifestFiles(JSON.parse(await readFile(join(fixtures, "manifest.json"), "utf8")));
    for (const file of files) {
      try { await access(join(fixtures, file)); } catch { throw new Error(`missing fixture ${file}`); }
    }
    for (const file of files) {
      try {
        const directory = join(artifacts, file.replace(/\.wld$/, "")); await mkdir(directory);
        await run(process.execPath, [join(root, "scripts/compatibility/save-world.mjs"), join(fixtures, file), directory]);
        // Require every TS artifact before starting .NET, so missing saves fail with an explicit diagnostic.
        const unchanged = await required(join(directory, "unchanged.wld"));
        await required(join(directory, "edited.wld"));
        const original = await required(join(directory, "original.cwm"));
        const expectedEdit = await required(join(directory, "edited.cwm"));
        const edit = JSON.parse(await required(join(directory, "edit.json")));
        let mismatch = compareSingleTileEdit(original, expectedEdit, edit);
        if (mismatch !== null) throw new Error(`TS pre-save edit: ${mismatch}`);
        const inspector = ["run", "--project", "dotnet/Terraria.WorldInspector", "--no-build", "--"];
        await run("dotnet", [...inspector, "roundtrip", join(fixtures, file), join(directory, "reference.wld")]);
        const reference = await required(join(directory, "reference.wld"));
        mismatch = compareWorldBytes(reference, unchanged);
        if (mismatch !== null) throw new Error(`unchanged save: ${mismatch}`);
        if (corrupt) {
          // Establish byte equality BEFORE injecting damage: an existing writer defect cannot pass the probe.
          // Section pointer 1 locates the tile payload (docs/file-format/header.md).
          const offset = unchanged.readInt32LE(30) + 1;
          if (offset < 0 || offset >= unchanged.length) throw new Error("invalid tile pointer for corruption probe");
          unchanged[offset] ^= 1;
          await writeFile(join(directory, "unchanged.wld"), unchanged);
          mismatch = compareWorldBytes(reference, unchanged);
          if (mismatch !== `world bytes differ, byte offset ${offset}`) throw new Error("Corruption probe unexpectedly passed or reported the wrong offset");
          throw new CorruptionDetected(`${file}: unchanged save: ${mismatch}`);
        }
        for (const variant of ["unchanged", "edited"]) {
          await run("dotnet", [...inspector, "export-cwm", join(directory, `${variant}.wld`), join(directory, `${variant}-dotnet.cwm`)]);
          const actual = await required(join(directory, `${variant}-dotnet.cwm`));
          mismatch = compareCwm(variant === "unchanged" ? original : expectedEdit, actual);
          if (mismatch !== null) throw new Error(`${variant} save: ${mismatch}`);
          if (variant === "edited") {
            mismatch = compareSingleTileEdit(original, actual, edit);
            if (mismatch !== null) throw new Error(`edited save scope: ${mismatch}`);
          }
        }
        report.push(`PASS ${file}: unchanged bytes, unchanged CWM, edited CWM, single tile (${edit.x},${edit.y}) red wire`);
      } catch (error) {
        if (error instanceof CorruptionDetected) throw error;
        throw new Error(`${file}: ${error.message}`);
      }
    }
  } catch (error) {
    report.push(`FAIL ${error.message}`);
    throw error;
  } finally {
    await writeFile(join(artifacts, "report.txt"), report.join("\n") + "\n");
    console.log(report.join("\n"));
    console.log(`Writer report: ${join(artifacts, "report.txt")}`);
  }
  return artifacts;
}

export async function runCorruptionProbe(options = {}) {
  try {
    await runWriterDifferential({ ...options, corrupt: true });
    throw new Error("Corruption probe unexpectedly passed");
  } catch (error) {
    if (!(error instanceof CorruptionDetected)) throw error;
    console.log(`PASS corruption probe rejected ${error.message}`);
  }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--corruption-probe") {
      await runCorruptionProbe();
    } else if (args.length === 0 || args.length === 2) {
      await runWriterDifferential(args.length === 2 ? { fixtures: resolve(args[0]), artifacts: resolve(args[1]) } : {});
    } else throw new Error("Usage: writer.mjs [<fixture-directory> <new-artifact-directory>] | --corruption-probe");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
