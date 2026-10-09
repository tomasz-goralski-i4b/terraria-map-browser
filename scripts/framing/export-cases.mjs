// Exports the framing cases of a generated observation world (#158) as input for observe.ps1:
//   node scripts/framing/export-cases.mjs <world.wld> <world.wld.manifest.json> <cases.json>
// Each case is its rectangle from the manifest plus a margin of air-or-terrain, read from the world with our own
// codec, so the game frames exactly the tiles the in-game observation world holds. Map-option cases are skipped: their
// tiles carry stored frames, which framing does not compute. The output is local input, never committed.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
// The built codec (scripts/build.sh builds it before the tests run).
import { readWorldTiles } from "../../packages/world-codec/dist/index.js";

/** Tiles around each case rectangle that are framed with it: the game reads two tiles out for partner edges. */
export const CASE_MARGIN = 2;
const ABSENT = 0xffff;

/** One case as observe.ps1 reads it: row-major tiles of `[type or -1, shape, wall]`. */
export function exportCases(worldBytes, manifest) {
  const { planes, palette, metadata } = readWorldTiles(worldBytes);
  const height = metadata.height;
  const vanillaId = (index) => {
    if (index === ABSENT) return -1;
    const ref = palette[index];
    if (ref?.kind !== "vanilla") throw new Error(`case content must be vanilla, got ${JSON.stringify(ref)}`);
    return ref.id;
  };
  return manifest.cases.filter((entry) => entry.mapTile === null && entry.mapOption === null).map((entry) => {
    const left = entry.x - CASE_MARGIN;
    const top = entry.y - CASE_MARGIN;
    const width = entry.width + 2 * CASE_MARGIN;
    const rows = entry.height + 2 * CASE_MARGIN;
    const tiles = [];
    for (let y = top; y < top + rows; y++) {
      for (let x = left; x < left + width; x++) {
        const index = x * height + y;
        tiles.push([vanillaId(planes.block[index] ?? ABSENT), planes.shape[index] ?? 0, vanillaId(planes.wall[index] ?? ABSENT)]);
      }
    }
    return { id: entry.id, section: entry.section, title: entry.title, expected: entry.expected, margin: CASE_MARGIN, width, height: rows, tiles };
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [world, manifestPath, output] = process.argv.slice(2);
  if (world === undefined || manifestPath === undefined || output === undefined) {
    throw new Error("usage: node scripts/framing/export-cases.mjs <world.wld> <manifest.json> <cases.json>");
  }
  const cases = exportCases(new Uint8Array(readFileSync(world)), JSON.parse(readFileSync(manifestPath, "utf8")));
  writeFileSync(output, JSON.stringify({ cases }));
  console.log(`${String(cases.length)} cases written to ${output}`);
}
