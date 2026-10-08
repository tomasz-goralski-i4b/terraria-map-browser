import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { readWorldTiles, type WorldTilesResult } from "@studio/world-codec";
import { writeSyntheticWorld, type WorkloadProfile } from "./generator.js";

const planeNames = ["block", "wall", "frameX", "frameY", "paint", "wallPaint", "liquid", "liquidAmount", "shape", "flags"] as const;

export async function fileHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes as Buffer);
  return hash.digest("hex");
}

/** Independent coordinate oracle; checks every field without creating a per-cell object or another CWM. */
function checkLarge(world: WorldTilesResult, seed: number, profile: WorkloadProfile): number[] {
  const { width, height } = world.metadata;
  assert.equal(width, 8400);
  assert.equal(height, 2400);
  const expectedCount = 20_160_000;
  for (const name of planeNames) assert.equal(world.planes[name].length, expectedCount);
  const { block, wall, frameX, frameY, paint, wallPaint, liquid, liquidAmount, shape, flags } = world.planes;
  const ids = world.palette.map((ref) => ref.kind === "vanilla" ? ref.id : ref.runtimeId);
  const horizon = Math.floor(height / 3) + seed % 3;
  const liquidCounts = [0, 0, 0, 0];
  let coordinates = 0;
  for (let x = 0; x < width; x++) {
    const sparse = profile === "sky-stone" || (profile === "mixed" && x % 2 === 0);
    for (let y = 0; y < height; y++) {
      const at = x * height + y;
      if (sparse) {
        const hasStone = y >= horizon;
        if ((hasStone ? ids[block[at] ?? 65535] !== 1 : block[at] !== 65535) || wall[at] !== 65535 ||
            frameX[at] !== -1 || frameY[at] !== -1 || paint[at] !== 0 || wallPaint[at] !== 0 ||
            liquid[at] !== 0 || liquidAmount[at] !== 0 || shape[at] !== 0 || flags[at] !== 0) {
          throw new Error(`sparse plane mismatch at (${String(x)},${String(y)})`);
        }
      } else {
        const phase = (seed + 17 * x + 31 * y) >>> 0;
        const kind = 1 + phase % 4;
        if (ids[block[at] ?? 65535] !== (phase % 2 === 0 ? 4 : 300) || ids[wall[at] ?? 65535] !== 300 ||
            frameX[at] !== (x % 32) * 18 || frameY[at] !== (y % 16) * 18 ||
            paint[at] !== 1 + phase % 30 || wallPaint[at] !== 1 + (phase >>> 5) % 30 ||
            liquid[at] !== kind || liquidAmount[at] !== 1 + phase % 255 || shape[at] !== phase % 6 ||
            flags[at] !== ((phase & 63) | ((1 + phase % 15) << 6))) {
          throw new Error(`dense plane mismatch at (${String(x)},${String(y)})`);
        }
        liquidCounts[kind - 1] = (liquidCounts[kind - 1] ?? 0) + 1;
      }
      coordinates++;
    }
  }
  assert.equal(coordinates, expectedCount);
  const denseColumns = profile === "sky-stone" ? 0 : profile === "dense" ? width : width / 2;
  assert.deepEqual(liquidCounts, Array.from({ length: 4 }, () => denseColumns * height / 4));
  assert.equal(world.sections.tiles.end, world.sections.pointers[2]);
  assert.deepEqual(Object.values(world.entities ?? {}).map(({ error }) => error), Array.from({ length: 8 }, () => null));
  return liquidCounts;
}

export interface LargeSmokeEvidence {
  readonly profile: WorkloadProfile;
  readonly seed: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly coordinates: number;
  readonly liquidCounts: readonly number[];
  readonly planeBytes: number;
  readonly generationMs: number;
  readonly parseMs: number;
}

/** Opt-in smoke outside normal unit loops. All binary files are OS-temporary and removed even on failure. */
export async function runLargeSmoke(profile: WorkloadProfile = "mixed", seed = 20_261_008): Promise<LargeSmokeEvidence> {
  const directory = mkdtempSync(join(tmpdir(), "terraria-synthetic-large-"));
  try {
    const path = join(directory, "Synthetic-Large.wld");
    const repeated = join(directory, "Synthetic-Large-repeat.wld");
    const start = performance.now();
    const bytes = writeSyntheticWorld(path, { seed, profile });
    const generationMs = performance.now() - start;
    const sha256 = await fileHash(path);
    assert.equal(writeSyntheticWorld(repeated, { seed, profile }), bytes);
    assert.equal(await fileHash(repeated), sha256);
    const binary = readFileSync(path);
    const parseStart = performance.now();
    const world = readWorldTiles(binary); // The decoder rejects any RLE column overrun or unconsumed tile bytes.
    const parseMs = performance.now() - parseStart;
    const liquidCounts = checkLarge(world, seed, profile);
    return {
      profile, seed, bytes, sha256, coordinates: 20_160_000, liquidCounts,
      planeBytes: planeNames.reduce((sum, name) => sum + world.planes[name].byteLength, 0),
      generationMs, parseMs,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
