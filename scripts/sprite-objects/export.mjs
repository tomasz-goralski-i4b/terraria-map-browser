// Turns the sprite object observation (observe.ps1, ADR 0003) into the tables the renderer reads:
//   node scripts/sprite-objects/export.mjs local-renders/sprite-objects.json
// Minecart track pieces (#239), tree trunk blocks, palm rows and foliage styles (#238), draw offsets and the solidity
// of tile types. Only numbers are written,
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

/** A frame-important tile drawn as a 16 × 16 cell at its own tile: [width, height, top, mirrored at even x, at odd x]. */
const PLAIN_DRAW = "16,16,0,0,0";
/** The grid sample of the observation: 8 columns × 40 rows at a stride of 18. */
const GRID_COLUMNS = 8;
const GRID_STRIDE = 18;

/**
 * Draw sizes, top offsets and mirroring of frame-important tiles (docs/assets.md, "Draw offsets"): the variants, and
 * per type that is not plain its base variant (frame (0, 0)) and the runs of frameY (at frameX 0) and of frameX (at
 * frameY 0) that differ from it. A frame takes its frameY run where that differs from the base, else its frameX run.
 * Frames the game could not draw (null) say nothing; a type whose frame (0, 0) it cannot draw is listed as unobserved.
 * Refuses a type whose grid sample this does not reproduce.
 */
export function drawOffsetTables(drawOffsets) {
  const variants = [];
  const ids = new Map();
  const idOf = (variant) => {
    const key = variant.join(",");
    let id = ids.get(key);
    if (id === undefined) { id = variants.length; ids.set(key, id); variants.push(variant); }
    return id;
  };
  const at = (runs, value) => runs.find(([from, to]) => value >= from && value <= to)?.[2] ?? null;
  const types = [];
  const unobserved = [];
  for (const { type, rows, columns, grid } of drawOffsets) {
    for (const [, , variant] of [...rows, ...columns]) if (!Array.isArray(variant)) fail(`type ${String(type)}: draw data depends on more than the frame (${String(variant)})`);
    const base = at(rows, 0);
    // Some types cannot be drawn without the game's textures or tile entities: they are listed, not tabled.
    if (base === null) { unobserved.push(type); continue; }
    const baseKey = base.join(",");
    const baseId = baseKey === PLAIN_DRAW ? -1 : idOf(base);
    const differing = (runs) => runs.filter(([, , variant]) => variant.join(",") !== baseKey).map(([from, to, variant]) => [from, to, idOf(variant)]);
    const rowRuns = differing(rows), columnRuns = differing(columns);
    grid.forEach((observed, index) => {
      if (observed === null) return;
      const fx = (index % GRID_COLUMNS) * GRID_STRIDE, fy = Math.floor(index / GRID_COLUMNS) * GRID_STRIDE;
      const row = at(rows, fy);
      const model = row !== null && row.join(",") !== baseKey ? row : at(columns, fx) ?? base;
      if (model.join(",") !== observed.join(",")) fail(`type ${String(type)}: frame (${String(fx)}, ${String(fy)}) draws ${String(observed)}, the runs give ${String(model)}`);
    });
    if (baseId === -1 && rowRuns.length === 0 && columnRuns.length === 0) continue;
    types.push([type, baseId === -1 ? idOf(base) : baseId, rowRuns, columnRuns]);
  }
  return { drawVariants: variants, drawTypes: types, drawUnobserved: unobserved };
}

/**
 * Which tile types are solid and how they draw (docs/assets.md, "Liquids", "Slopes and half blocks"): the solid types
 * that are not solid on top only (platforms and the like), the types solid on top only, the types that draw no liquid
 * behind themselves, the platforms, the types drawn with the solid tiles, and the types with their own drawing beside
 * half blocks (ignoring them, not really solid, with smooth borders) or without slopes; and the walls that count as
 * another wall where walls meet ("Walls": [wall, the wall it counts as]); and the plants that sway in the wind ("Draw
 * order").
 */
export function solidityTables(solidity) {
  if (solidity === undefined) fail("the observation has no solidity");
  const top = new Set(solidity.solidTop);
  return {
    solidBlocks: solidity.solid.filter((type) => !top.has(type)),
    solidTops: solidity.solidTop,
    hidesLiquidBehind: solidity.hidesLiquidBehind,
    platforms: solidity.platforms ?? fail("the observation has no platforms"),
    solidLayer: solidity.solidLayer ?? fail("the observation has no solid layer"),
    ignoresNearbyHalfBricks: solidity.ignoresNearbyHalfBricks ?? fail("the observation has no half-block tables"),
    notReallySolid: solidity.notReallySolid ?? fail("the observation has no half-block tables"),
    smoothBorders: solidity.smoothBorders ?? fail("the observation has no half-block tables"),
    noSlopes: solidity.noSlopes ?? fail("the observation has no slope table"),
    wallBlends: (solidity.wallBlend ?? fail("the observation has no wall blend table"))
      .flatMap((blend, wall) => (blend === wall ? [] : [[wall, blend]])),
    swaysInWind: solidity.swaysInWind ?? fail("the observation has no sway table"),
  };
}

export function exportObjects(observed) {
  if (observed.complete !== true) fail("the observation is incomplete");
  if (!Array.isArray(observed.drawOffsets)) fail("the observation has no draw offsets");
  return {
    gameVersion: observed.gameVersion,
    ...(() => { const { pieces, extras } = trackTables(observed.tracks); return { trackPieces: pieces, trackExtras: extras }; })(),
    ...treeTables(observed.treeStyles, observed.palms),
    ...drawOffsetTables(observed.drawOffsets),
    ...solidityTables(observed.solidity),
  };
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
  console.log(`wrote ${OUTPUT}: ${String(data.trackPieces.length)} track pieces, ${String(data.foliagePatterns.length)} foliage patterns, ${String(data.drawTypes.length)} drawn types`);
}
