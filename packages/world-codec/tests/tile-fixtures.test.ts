import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Session } from "node:inspector";
import { promisify } from "node:util";
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

  it("readWorldTiles_SmallFixture_AllocatesHeapObjectsProportionalToPaletteNotTiles", async () => {
    const bytes = new Uint8Array(readFileSync(new URL("SCCO1.wld", worldsDir)));
    const session = new Session();
    session.connect();
    const post = promisify(session.post.bind(session)) as (method: string, params?: object) => Promise<unknown>;
    await post("HeapProfiler.enable");
    // Sample every heap allocation made during the decode (including objects the GC already reclaimed), so a
    // per-record or per-coordinate object cannot hide behind garbage collection the way a heapUsed delta can.
    await post("HeapProfiler.startSampling", {
      samplingInterval: 64,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    const result = readWorldTiles(bytes);
    const { profile } = (await post("HeapProfiler.stopSampling")) as { profile: { head: SamplingNode } };
    await post("HeapProfiler.disable");
    session.disconnect();

    expect(result.planes.block).toHaveLength(4200 * 1200);
    // The whole call tree, not a per-file filter: the codec may be loaded as .ts or compiled .js, and nothing else
    // allocates between start and stop.
    const allocated = sumSelfSize(profile.head);
    // 5.04 million tiles: even one 16-byte object per coordinate is ~80 MB. Planes are typed arrays (backing stores
    // outside the sampled heap), so only the palette and small scratch objects may be allocated by the decoder.
    expect(allocated).toBeLessThan(4 * 1024 * 1024);
  }, 120_000);
});

interface SamplingNode {
  readonly head: SamplingNode;
  readonly selfSize: number;
  readonly children: readonly SamplingNode[];
}

/** Total sampled bytes allocated over the whole call tree. */
function sumSelfSize(node: SamplingNode): number {
  let total = node.selfSize;
  for (const child of node.children) total += sumSelfSize(child);
  return total;
}
