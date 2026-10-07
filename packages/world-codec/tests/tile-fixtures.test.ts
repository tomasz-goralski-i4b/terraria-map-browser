import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readWorldTiles, type TilePlanes } from "@studio/world-codec";

// The five generated vanilla worlds against the committed M1 snapshots (palette order and per-chunk plane digests).
const worldsDir = new URL("../../test-fixtures/worlds/", import.meta.url);
const snapshotsDir = new URL("../../test-fixtures/snapshots/m1/", import.meta.url);

interface ManifestWorld {
  readonly file: string;
  readonly worldName: string;
  readonly dimensions: { readonly width: number; readonly height: number };
}
interface Snapshot {
  readonly metadata: { readonly guid: string; readonly worldId: number; readonly evil: string };
  readonly dimensions: { readonly width: number; readonly height: number };
  readonly palette: readonly unknown[];
}
interface ChunkSnapshot {
  readonly size: number;
  readonly planes: readonly (keyof TilePlanes)[];
  readonly digests: readonly ({ x: number; y: number; width: number; height: number } & Record<string, number | string>)[];
}

const manifest = JSON.parse(readFileSync(new URL("manifest.json", worldsDir), "utf8")) as {
  readonly worlds: readonly ManifestWorld[];
};
const readJson = (name: string): unknown => JSON.parse(readFileSync(new URL(name, snapshotsDir), "utf8"));
const stem = (file: string): string => file.replace(/\.wld$/, "");

/** SHA-256 of one plane inside a chunk, column-major within the chunk, first 8 bytes as hex (docs/cwm.md). */
function chunkDigest(
  plane: Uint8Array | Uint16Array | Int16Array,
  worldHeight: number,
  chunk: { x: number; y: number; width: number; height: number },
): string {
  const size = plane.BYTES_PER_ELEMENT;
  const out = new Uint8Array(chunk.width * chunk.height * size);
  const view = new DataView(out.buffer);
  let at = 0;
  for (let x = chunk.x * 128; x < chunk.x * 128 + chunk.width; x++) {
    for (let y = chunk.y * 128; y < chunk.y * 128 + chunk.height; y++) {
      const value = plane[x * worldHeight + y] ?? 0;
      if (size === 1) view.setUint8(at, value);
      else if (plane instanceof Int16Array) view.setInt16(at, value, true);
      else view.setUint16(at, value, true);
      at += size;
    }
  }
  return createHash("sha256").update(out).digest("hex").slice(0, 16);
}

describe("readWorldTiles — vanilla corpus", () => {
  it.each(manifest.worlds.map((world) => [world.file, world] as const))(
    "readWorldTiles_VanillaFixture_MatchesSnapshotPlanesAndPalette (%s)",
    (_name, world) => {
      const snapshot = readJson(`${stem(world.file)}.meta.json`) as Snapshot;
      const chunks = readJson(`${stem(world.file)}.chunks.json`) as ChunkSnapshot;
      const result = readWorldTiles(new Uint8Array(readFileSync(new URL(world.file, worldsDir))));
      const { width, height } = world.dimensions;

      expect(result.metadata).toMatchObject({ width, height, worldId: snapshot.metadata.worldId, guid: snapshot.metadata.guid });
      expect(result.palette).toEqual(snapshot.palette);
      for (const name of chunks.planes) expect(result.planes[name]).toHaveLength(width * height);
      for (const chunk of chunks.digests) {
        for (const name of chunks.planes) {
          expect(chunkDigest(result.planes[name], height, chunk), `${name} (${String(chunk.x)},${String(chunk.y)})`)
            .toBe(chunk[name]);
        }
      }
    },
    120_000,
  );

  it("readWorldTiles_SmallFixture_RetainsHeapProportionalToPaletteNotTiles", () => {
    const bytes = new Uint8Array(readFileSync(new URL("SCCO1.wld", worldsDir)));
    const before = process.memoryUsage().heapUsed;
    const result = readWorldTiles(bytes);
    const retained = process.memoryUsage().heapUsed - before;
    // 5.04 million tiles: one retained JS object per coordinate would cost hundreds of MB of heap; planes live in
    // ArrayBuffers outside the heap, so only the palette (and small scratch) may remain.
    expect(result.planes.block).toHaveLength(4200 * 1200);
    expect(retained).toBeLessThan(32 * 1024 * 1024);
  }, 120_000);
});
