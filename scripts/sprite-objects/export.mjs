// Turns the sprite object observation (observe.ps1, ADR 0003) into the tables the renderer reads:
//   node scripts/sprite-objects/export.mjs local-renders/sprite-objects.json
// Minecart track pieces (#239) and tree trunk blocks, palm rows and foliage styles (#238). Only numbers are written,
// no texture and no code. The output, packages/renderer/src/objects/terraria-sprite-objects.generated.ts, is
// regenerated, never edited by hand.
import { readFileSync, writeFileSync } from "node:fs";

export const OUTPUT = "packages/renderer/src/objects/terraria-sprite-objects.generated.ts";
/** Track cells are 16 pixels at a stride of 18 (Tiles_314 is 8 × 8 cells). */
const TRACK_STRIDE = 18;
/** The foliage functions were observed at 30 consecutive columns from x = 60 (a multiple of every period tried). */
const PERIODS = [1, 2, 3, 5, 6, 10, 15, 30];

function fail(message) {
  throw new Error(`sprite object export: ${message}`);
}

/** Track pieces by stored index and the cells of the extras they draw (docs/assets.md, "Minecart tracks"). */
export function trackTables(tracks) {
  const total = tracks.totalFrames;
  const cellOf = (piece) => {
    const entry = tracks.pieces[piece];
    if (entry === undefined) fail(`no source rectangle for track piece ${String(piece)}`);
    const [x, y, w, h] = entry.rect;
    if (w !== 16 || h !== 16 || x % TRACK_STRIDE !== 0 || y % TRACK_STRIDE !== 0) fail(`track piece ${String(piece)} is not a cell: ${String(entry.rect)}`);
    return [x / TRACK_STRIDE, y / TRACK_STRIDE];
  };
  const pieces = [];
  for (let piece = 0; piece < total; piece++) {
    const entry = tracks.pieces[piece];
    const flags = (entry.left ? 1 : 0) | (entry.right ? 2 : 0) | (entry.bumper ? 4 : 0) | (entry.bouncy ? 8 : 0);
    pieces.push([...cellOf(piece), flags]);
  }
  const extras = [tracks.LeftDownDecoration, tracks.RightDownDecoration, tracks.RegularBumperDecoration, tracks.BouncyBumperDecoration].map(cellOf);
  // The accessors confirm that frameX is the front piece and frameY the back piece (-1: none).
  for (const [frameX, frameY, front, back] of tracks.accessors) {
    if (front !== frameX || back !== frameY) fail(`track frames are not the pieces: (${String(frameX)}, ${String(frameY)}) → (${String(front)}, ${String(back)})`);
  }
  return { pieces, extras };
}

/** The shortest period (in columns) of a foliage sequence, and its entries. */
function periodic(entries) {
  for (const period of PERIODS) {
    if (entries.every((entry, k) => entry === entries[k % period])) return entries.slice(0, period);
  }
  fail("a foliage sequence has no period within 30 columns");
}

/** Foliage styles, frame offsets and sizes by tree type, ground and variation (docs/assets.md, "Trees"). */
export function treeTables(treeStyles, palms) {
  const patterns = [];
  const patternIds = new Map();
  const patternOf = (columns) => {
    const entries = periodic(columns.map(([ok, frame, style, width, height]) => {
      if (ok !== 1) return "-1,0,0,0";
      return `${String(style)},${String(frame)},${String(width)},${String(height)}`;
    }));
    const key = entries.join(";");
    let id = patternIds.get(key);
    if (id === undefined) {
      id = patterns.length;
      patternIds.set(key, id);
      patterns.push([entries.length, ...entries.flatMap((entry) => entry.split(",").map(Number))]);
    }
    return id;
  };
  const foliage = treeStyles.families.map((family) => ({
    type: family.type,
    grounds: family.grounds.map((ground) => {
      const zones = ground.zones;
      const forest = zones.every((area, zone) => area === zone);
      const area = forest ? -2 : zones.every((zone) => zone === zones[0]) ? zones[0] : fail(`ground ${String(ground.ground)} reads different areas by zone`);
      if (area !== -1 && area !== ground.readArea && !(forest && ground.readArea === 1)) fail(`ground ${String(ground.ground)}: area ${String(area)} ≠ ${String(ground.readArea)}`);
      // The stored variant is added to the frame: the top reports the same frame for every variant.
      if (ground.variants.some((variant) => variant[1] !== ground.variants[0][1] || variant[2] !== ground.variants[0][2])) fail(`ground ${String(ground.ground)}: the top's style depends on its variant`);
      return [ground.ground, area, ...ground.values.map(patternOf)];
    }),
  }));
  const common = treeStyles.families.find((family) => family.type === 5) ?? fail("no common trees observed");
  const trunkBlocks = common.grounds
    .filter((ground) => Array.isArray(ground.trunkDraw) && ground.trunkDraw[0] !== 0)
    .map((ground) => {
      if (ground.trunkDraw[0] % 176 !== 0 || ground.trunkDraw[1] !== 0) fail(`trunk draw shift ${String(ground.trunkDraw)}`);
      if (ground.trunkDraw[0] / 176 !== ground.biome + 1) fail(`trunk block ≠ biome + 1 on ground ${String(ground.ground)}`);
      return [ground.ground, ground.trunkDraw[0] / 176];
    });
  const palmRows = palms.filter((palm) => palm.biome >= 0).map((palm) => {
    if (palm.trunk[1] !== palm.biome * 22 || palm.top[1] !== palm.biome * 22) fail(`palm row ≠ biome on ground ${String(palm.ground)}`);
    return [palm.ground, palm.biome];
  });
  return {
    trunkBlocks, palmRows, foliagePatterns: patterns, foliage,
  };
}

export function exportObjects(observed) {
  if (observed.complete !== true) fail("the observation is incomplete");
  return { gameVersion: observed.gameVersion, ...(() => { const { pieces, extras } = trackTables(observed.tracks); return { trackPieces: pieces, trackExtras: extras }; })(), ...treeTables(observed.treeStyles, observed.palms) };
}

if (process.argv[1]?.endsWith("export.mjs")) {
  const input = process.argv[2] ?? fail("usage: node scripts/sprite-objects/export.mjs <observation.json>");
  const data = exportObjects(JSON.parse(readFileSync(input, "utf8")));
  const text = `// Generated by scripts/sprite-objects/export.mjs from the sprite object observer (ADR 0003). Do not edit by hand:
// regenerate it after a game update (scripts/sprite-objects/README.md).
import type { SpriteObjectData } from "./sprite-object-data.js";

export const terrariaSpriteObjects: SpriteObjectData = ${JSON.stringify(data)};
`;
  writeFileSync(OUTPUT, text);
  console.log(`wrote ${OUTPUT}: ${String(data.trackPieces.length)} track pieces, ${String(data.foliagePatterns.length)} foliage patterns`);
}
