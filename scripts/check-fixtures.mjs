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
  expect("worldName", w.worldName, file.replace(/\.wld$/, ""));
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
