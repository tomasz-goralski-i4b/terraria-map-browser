// Consistency of packages/test-fixtures/worlds: naming key ↔ manifest ↔ files (size, SHA-256).
// Does not parse the world format — the manifest is the independent oracle for codec tests.
// Exit: 0 OK, 1 mismatch.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "packages/test-fixtures/worlds";
const SIZES = { S: "small", M: "medium", L: "large", C: "custom" };
const MODES = { J: "journey", C: "classic", E: "expert", M: "master" };
const EVILS = { CO: "corruption", CR: "crimson", BO: "both", NO: "none" };
const STANDARD_DIMENSIONS = { small: [4200, 1200], medium: [6400, 1800], large: [8400, 2400] };
const NAME = /^([SMLC])([JCEM])(CO|CR|BO|NO)(\d+)\.wld$/;

if (!existsSync(dir)) process.exit(0);
const errors = [];
const files = readdirSync(dir).filter((f) => f.endsWith(".wld")).sort();
const manifestPath = join(dir, "manifest.json");
if (files.length && !existsSync(manifestPath)) {
  console.log(`FIXTURES: ${manifestPath} is missing`);
  process.exit(1);
}
// Worlds live in Git LFS. A clone/worktree without `git lfs pull` has 132-byte pointer files instead —
// report that plainly (exit 2 = infrastructure) instead of a wall of hash/size mismatches.
const pointers = files.filter((f) => readFileSync(join(dir, f)).subarray(0, 40).toString("latin1").startsWith("version https://git-lfs"));
if (pointers.length) {
  console.log(`INFRA: ${pointers.length} world fixture(s) are Git LFS pointers, not the worlds: ${pointers.join(", ")}`);
  console.log("       Install Git LFS and run: git lfs install && git lfs pull");
  process.exit(2);
}
const manifest = files.length ? JSON.parse(readFileSync(manifestPath, "utf8")) : { worlds: [] };
const entries = new Map(manifest.worlds.map((w) => [w.file, w]));

for (const file of files) {
  const m = NAME.exec(file);
  const w = entries.get(file);
  if (!m) { errors.push(`${file}: name does not follow <size><difficulty><evil><n>.wld (see README)`); continue; }
  if (!w) { errors.push(`${file}: no manifest entry`); continue; }
  const [, size, mode, evil] = m;
  const expect = (field, actual, wanted) => {
    if (actual !== wanted) errors.push(`${file}: ${field} is ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`);
  };
  // The in-game name equals the file name, unless the file was explicitly renamed (bytes untouched).
  const renamed = w.renamedFrom && w.renamedFrom === `${w.worldName}.wld`;
  if (!renamed) expect("worldName", w.worldName, file.replace(/\.wld$/, ""));
  if (w.renamedFrom && !renamed) errors.push(`${file}: renamedFrom must be "<worldName>.wld"`);
  if (renamed && !w.note) errors.push(`${file}: a renamed fixture needs a note explaining why`);
  expect("size", w.size, SIZES[size]);
  expect("mode", w.mode, MODES[mode]);
  expect("evil", w.evil, EVILS[evil]);
  const dims = STANDARD_DIMENSIONS[w.size];
  if (dims) expect("dimensions", `${w.dimensions?.width}x${w.dimensions?.height}`, `${dims[0]}x${dims[1]}`);
  const modded = size === "C" || evil === "BO" || evil === "NO";
  if (modded && !(Array.isArray(w.mods) && w.mods.length)) errors.push(`${file}: ${size === "C" ? "custom size" : `evil ${evil}`} requires a non-empty mods list`);
  if (!Array.isArray(w.mods)) errors.push(`${file}: mods must be an array ([] for vanilla)`);
  for (const key of ["seed", "gameVersion", "formatVersion", "generatedBy", "generatedAt", "inGameModifications"]) {
    if (w[key] === undefined || w[key] === null || w[key] === "") errors.push(`${file}: ${key} is missing`);
  }
  const bytes = readFileSync(join(dir, file));
  expect("bytes", w.bytes, bytes.length);
  expect("sha256", w.sha256, createHash("sha256").update(bytes).digest("hex"));
  expect("formatVersion", w.formatVersion, bytes.readInt32LE(0));

  // Cross-check the manifest against the world metadata (docs/file-format.md, "World metadata").
  // Format 326 only: before the crimson flag, name and seed are the only variable-length fields.
  if (bytes.readInt32LE(0) === 326) {
    try {
      const facts = readMetadata326(bytes);
      expect("worldName (in file)", w.worldName, facts.name);
      expect("seed (in file)", w.seed, facts.seed);
      expect("dimensions (in file)", `${w.dimensions?.width}x${w.dimensions?.height}`, `${facts.width}x${facts.height}`);
      expect("mode (in file)", w.mode, facts.mode);
      expect("evil (in file)", w.evil, facts.evil);
    } catch (e) {
      errors.push(`${file}: cannot read metadata: ${e.message}`);
    }
  }
}

/** Minimal, independent metadata probe for format 326 — not the codec. */
function readMetadata326(b) {
  const sectionCount = b.readInt16LE(24);
  let o = b.readInt32LE(26); // pointer[0] = start of the world metadata section
  if (sectionCount !== 11 || o <= 0 || o >= b.length) throw new Error("unexpected section table");
  const str = () => {
    let len = 0, shift = 0, x;
    do { x = b[o++]; len |= (x & 0x7f) << shift; shift += 7; } while (x & 0x80);
    const s = b.toString("utf8", o, o + len);
    o += len;
    return s;
  };
  const name = str();
  const seed = str();
  const afterStrings = o;
  // world-gen version 8 + GUID 16 + world id 4 + bounds 16 = 44 bytes, then height, width, game mode.
  const height = b.readInt32LE(afterStrings + 44);
  const width = b.readInt32LE(afterStrings + 48);
  const modeRaw = b.readInt32LE(afterStrings + 52);
  // Rows 13–21 are fixed-size for 326: 197 bytes from the end of the seed to the crimson flag.
  const crimson = b[afterStrings + 197];
  if (crimson !== 0 && crimson !== 1) throw new Error(`crimson flag byte is ${crimson}`);
  const MODE = ["classic", "expert", "master", "journey"];
  return { name, seed, width, height, mode: MODE[modeRaw] ?? `unknown(${modeRaw})`, evil: crimson ? "crimson" : "corruption" };
}
for (const file of entries.keys()) {
  if (!files.includes(file)) errors.push(`${file}: manifest entry without a file`);
}

if (errors.length) {
  console.log("FIXTURES: inconsistent corpus:");
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log(`FIXTURES: OK — ${files.length} world(s)`);
