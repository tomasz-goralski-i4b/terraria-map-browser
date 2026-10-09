import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const planes = [["block", 2], ["wall", 2], ["frameX", 2], ["frameY", 2], ["paint", 1],
  ["wallPaint", 1], ["liquid", 1], ["liquidAmount", 1], ["shape", 1], ["flags", 2]];

function framing(bytes) {
  if (bytes.length < 12) throw new Error("prefix truncated");
  if (!bytes.subarray(0, 4).equals(Buffer.from("CWM\0"))) throw new Error("prefix magic");
  if (bytes.readUInt32LE(4) !== 1) throw new Error("prefix schema version");
  const start = 12 + bytes.readUInt32LE(8);
  if (start > bytes.length) throw new Error("header truncated");
  let header;
  try { header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(12, start))); }
  catch { throw new Error("header JSON/UTF-8"); }
  if (header?.schemaVersion !== 1) throw new Error("header schema version");
  const { width, height } = header.dimensions ?? {};
  const cells = width * height;
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0
    || !Number.isSafeInteger(cells * 15)) throw new Error("header dimensions");
  if (!Array.isArray(header.palette)) throw new Error("header palette");
  if (bytes.length !== start + cells * 15) throw new Error(`plane payload length: expected ${start + cells * 15}, got ${bytes.length}`);
  return { header, start, width, height, cells };
}

function firstDifference(left, right) {
  const length = Math.min(left.length, right.length);
  for (let offset = 0; offset < length; offset++) if (left[offset] !== right[offset]) return offset;
  return left.length === right.length ? -1 : length;
}

/** Return one bounded diagnostic; byte equality, rather than digests or parsed JSON, decides agreement. */
export function compareCwm(left, right) {
  const offset = firstDifference(left, right);
  if (offset >= 0 && offset < 12) {
    const region = offset < 4 ? "magic" : offset < 8 ? "schema version" : "header length";
    // A length change may be caused by palette growth; name that region when both headers are readable.
    if (offset >= 8) {
      try {
        const a = framing(left); const b = framing(right);
        if (JSON.stringify(a.header.palette) !== JSON.stringify(b.header.palette)) return `header palette, byte offset ${offset}`;
      } catch { /* Invalid framing is diagnosed below or by its prefix region. */ }
    }
    return `prefix ${region}, byte offset ${offset}`;
  }
  let a; let b;
  try { a = framing(left); } catch (error) { return `invalid .NET export: ${error.message}`; }
  try { b = framing(right); } catch (error) { return `invalid TypeScript export: ${error.message}`; }
  if (offset === -1) return null;
  if (offset < Math.max(a.start, b.start)) {
    const keys = ["schemaVersion", "formatVersion", "metadata", "dimensions", "palette"];
    const key = keys.find((key) => JSON.stringify(a.header[key]) !== JSON.stringify(b.header[key]));
    return `header ${key ?? "encoding/property order"}, byte offset ${offset}`;
  }
  let start = a.start;
  for (const [plane, elementBytes] of planes) {
    const end = start + a.cells * elementBytes;
    if (offset < end) {
      const index = Math.floor((offset - start) / elementBytes);
      const x = Math.floor(index / a.height); const y = index % a.height;
      return `plane ${plane}, chunk (${Math.floor(x / 128)},${Math.floor(y / 128)}), coordinate (${x},${y}), byte offset ${offset}`;
    }
    start = end;
  }
  return `trailing data, byte offset ${offset}`;
}

export function execute(command, args) {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
    let diagnostic = "";
    child.stderr.on("data", (bytes) => { diagnostic = (diagnostic + bytes.toString()).slice(-4096); });
    child.on("error", reject);
    child.on("close", (status) => status === 0 ? resolveProcess() : reject(new Error(
      `${command === "dotnet" ? ".NET" : "TypeScript"} export failed (exit ${status}): ${diagnostic.trim()}`)));
  });
}

function manifestFiles(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.worlds) || manifest.worlds.length === 0) {
    throw new Error("Expected nonempty schema version 1 manifest");
  }
  const seen = new Set();
  return manifest.worlds.map((entry) => {
    const file = entry?.file;
    if (typeof file !== "string" || !/^[A-Za-z0-9_-]+\.wld$/.test(file) || seen.has(file.toLowerCase())) {
      throw new Error(`Invalid or duplicate manifest filename: ${file}`);
    }
    seen.add(file.toLowerCase()); return file;
  });
}

function inside(directory, path) {
  const suffix = relative(directory, path);
  return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith("../") && !suffix.startsWith("..\\"));
}

/** Exporters share only .wld inputs and generated CWM artifacts; neither codec invokes the other. */
export async function runDifferential({ fixtures = join(root, "packages/test-fixtures/worlds"), artifacts, execute: run = execute } = {}) {
  await mkdir(join(root, ".tdd"), { recursive: true });
  if (artifacts === undefined) artifacts = await mkdtemp(join(root, ".tdd/cwm-"));
  else {
    // Caller-selected output must be temporary/ignored, including after resolving directory aliases.
    const parent = await realpath(resolve(artifacts, ".."));
    const target = join(parent, relative(resolve(artifacts, ".."), resolve(artifacts)));
    if (!inside(await realpath(tmpdir()), target) && !inside(await realpath(join(root, ".tdd")), target)) {
      throw new Error("Artifacts must be in the system temporary directory or .tdd");
    }
    await mkdir(artifacts); // Never reuse stale exports from an earlier run.
  }
  const report = [];
  try {
    const files = manifestFiles(JSON.parse(await readFile(join(fixtures, "manifest.json"), "utf8")));
    for (const file of files) {
      try { await access(join(fixtures, file)); } catch { throw new Error(`missing fixture ${file}`); }
    }
    const dotnet = join(artifacts, "dotnet"); const ts = join(artifacts, "typescript");
    await mkdir(dotnet); await mkdir(ts);
    for (const file of files) {
      const name = file.replace(/\.wld$/, ".cwm");
      try {
        await run("dotnet", ["run", "--project", "dotnet/Terraria.WorldInspector", "--no-build", "--",
          "export-cwm", join(fixtures, file), join(dotnet, name)]);
      } catch (error) { throw new Error(`${file}: ${error.message}`); }
    }
    await run(process.execPath, [join(root, "packages/world-codec/dist/node/export-cwm-corpus.js"), fixtures, ts]);
    for (const file of files) {
      const name = file.replace(/\.wld$/, ".cwm");
      let left; let right; let mismatch;
      try { left = await readFile(join(dotnet, name)); } catch { mismatch = "missing .NET export"; }
      try { right = await readFile(join(ts, name)); } catch { mismatch = "missing TypeScript export"; }
      mismatch ??= compareCwm(left, right);
      report.push(mismatch === null ? `PASS ${file}` : `FAIL ${file}: ${mismatch}`);
    }
    if (report.some((line) => line.startsWith("FAIL"))) throw new Error("CWM differential failed");
  } catch (error) {
    report.push(`ERROR: ${error.message}`);
    throw error;
  } finally {
    await writeFile(join(artifacts, "report.txt"), report.join("\n") + "\n");
    console.log(report.join("\n"));
    console.log(`CWM report: ${join(artifacts, "report.txt")}`);
  }
  return artifacts;
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === "--compare" && args.length === 4) {
      const mismatch = compareCwm(await readFile(args[1]), await readFile(args[2]));
      console.log(`${mismatch === null ? "PASS" : "FAIL"} ${args[3]}${mismatch === null ? "" : `: ${mismatch}`}`);
      if (mismatch !== null) process.exitCode = 1;
    } else if (args.length === 0 || args.length === 2) {
      await runDifferential(args.length === 2 ? { fixtures: resolve(args[0]), artifacts: resolve(args[1]) } : {});
    } else throw new Error("Usage: cwm.mjs [<fixture-directory> <new-artifact-directory>] | --compare <dotnet.cwm> <typescript.cwm> <fixture>");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
