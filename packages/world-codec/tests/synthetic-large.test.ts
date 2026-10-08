import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readWorldTiles, type TilePlanes } from "@studio/world-codec";
import {
  generateSyntheticWorld, writeSyntheticWorld,
  type SyntheticWorldOptions, type WorkloadProfile,
} from "../../test-fixtures/synthetic/generator.js";

const seed = 20_261_008;
const width = 130;
const height = 129;
const profiles: readonly WorkloadProfile[] = ["sky-stone", "dense", "mixed"];
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

// Analytic oracle from coordinate equations; no generator or production writer helpers.
function expectedPlanes(profile: WorkloadProfile): TilePlanes {
  const count = width * height;
  const planes: TilePlanes = {
    block: new Uint16Array(count).fill(65535), wall: new Uint16Array(count).fill(65535),
    frameX: new Int16Array(count).fill(-1), frameY: new Int16Array(count).fill(-1),
    paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
    liquid: new Uint8Array(count), liquidAmount: new Uint8Array(count),
    shape: new Uint8Array(count), flags: new Uint16Array(count),
  };
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const at = x * height + y;
      if (profile === "sky-stone" || (profile === "mixed" && x % 2 === 0)) {
        if (y >= Math.min(height, Math.floor(height / 3) + seed % 3)) planes.block[at] = 0;
        continue;
      }
      const phase = (seed + 17 * x + 31 * y) >>> 0;
      // Dense palette [4, 300]; mixed first encounters stone 1, then 300, then 4.
      planes.block[at] = profile === "dense" ? phase % 2 : (phase % 2 === 0 ? 2 : 1);
      planes.wall[at] = 1;
      planes.frameX[at] = 18 * (x % 32);
      planes.frameY[at] = 18 * (y % 16);
      planes.paint[at] = 1 + phase % 30;
      planes.wallPaint[at] = 1 + (phase >>> 5) % 30;
      planes.liquid[at] = 1 + phase % 4;
      planes.liquidAmount[at] = 1 + phase % 255;
      planes.shape[at] = phase % 6;
      planes.flags[at] = (phase & 63) | ((1 + phase % 15) << 6);
    }
  }
  return planes;
}

describe("synthetic benchmark worlds", () => {
  it.each(profiles)("repeats bytes and changes tile workload with the seed (%s)", (profile) => {
    const options = { seed, profile, width, height };
    const first = generateSyntheticWorld(options);
    expect(hash(generateSyntheticWorld(options))).toBe(hash(first));
    const changed = generateSyntheticWorld({ ...options, seed: seed + 1 });
    const view = new DataView(first.buffer, first.byteOffset, first.byteLength);
    const other = new DataView(changed.buffer, changed.byteOffset, changed.byteLength);
    expect(hash(changed.subarray(other.getInt32(30, true), other.getInt32(34, true))))
      .not.toBe(hash(first.subarray(view.getInt32(30, true), view.getInt32(34, true))));
  });

  it.each(profiles)("parses every plane and palette across both chunk edges (%s)", (profile) => {
    const bytes = generateSyntheticWorld({ seed, profile, width, height });
    const result = readWorldTiles(bytes);
    expect(result.metadata).toMatchObject({
      name: `Synthetic-${profile}-${String(seed)}`, seed: String(seed), width, height,
      worldId: seed, mode: "classic", evil: "corruption",
      bounds: { left: 0, right: width * 16, top: 0, bottom: height * 16 },
    });
    expect(result.header.version).toBe(326);
    expect(result.sections.frameImportantCount).toBe(754);
    const ids = profile === "sky-stone" ? [1] : profile === "dense" ? [4, 300] : [1, 300, 4];
    expect(result.palette).toEqual(ids.map((id) => ({ kind: "vanilla", id })));
    const expected = expectedPlanes(profile);
    for (const name of Object.keys(expected) as (keyof TilePlanes)[]) {
      expect(result.planes[name], name).toEqual(expected[name]);
      for (const x of [0, 127, 128, 129]) {
        for (const y of [0, 127, 128]) {
          expect(result.planes[name][x * height + y], `${name} at (${String(x)},${String(y)})`)
            .toBe(expected[name][x * height + y]);
        }
      }
    }
    const pointers = result.sections.pointers;
    expect(pointers).toHaveLength(11);
    expect(pointers[0]).toBe(167);
    for (let i = 1; i < pointers.length; i++) expect(pointers[i]).toBeGreaterThan(pointers[i - 1] ?? 0);
    expect(Object.values(result.entities ?? {}).map(({ error }) => error)).toEqual(Array.from({ length: 8 }, () => null));
    const footerAt = pointers[10] ?? 0;
    expect(bytes[footerAt]).toBe(1);
    const nameLength = bytes[footerAt + 1] ?? 0;
    expect(Buffer.from(bytes.subarray(footerAt + 2, footerAt + 2 + nameLength)).toString("utf8"))
      .toBe(result.metadata.name);
    expect(new DataView(bytes.buffer, bytes.byteOffset).getInt32(footerAt + 2 + nameLength, true)).toBe(seed);
    expect(bytes.byteLength).toBe(footerAt + 2 + nameLength + 4);
  });

  it.each([1, 2, 255, 256, 257, 32769, 65536])("bounds RLE to columns of height %i", (worldHeight) => {
    const world = readWorldTiles(generateSyntheticWorld({ seed, profile: "sky-stone", width: 2, height: worldHeight }));
    const horizon = Math.min(worldHeight, Math.floor(worldHeight / 3) + seed % 3);
    expect(world.planes.block).toEqual(new Uint16Array([
      ...new Uint16Array(horizon).fill(65535), ...new Uint16Array(worldHeight - horizon),
      ...new Uint16Array(horizon).fill(65535), ...new Uint16Array(worldHeight - horizon),
    ]));
  });

  it("streams exactly the same bytes to a temporary world file", () => {
    const directory = mkdtempSync(join(tmpdir(), "terraria-synthetic-small-"));
    try {
      const path = join(directory, "Synthetic-mixed.wld");
      const options = { seed, width, height, profile: "mixed" as const };
      const length = writeSyntheticWorld(path, options);
      const bytes = readFileSync(path);
      expect(length).toBe(bytes.byteLength);
      expect(hash(bytes)).toBe(hash(generateSyntheticWorld(options)));
      expect(readWorldTiles(bytes).planes).toEqual(expectedPlanes("mixed"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    { seed: -1 }, { seed: 2 ** 32 }, { seed: 1.5 }, { seed: Number.NaN },
    { seed, width: 0 }, { seed, height: -1 }, { seed, width: 130.5 },
    { seed, height: 65537 }, { seed, width: 65536, height: 65536 },
    { seed, profile: "underground" as WorkloadProfile },
  ] satisfies SyntheticWorldOptions[])("rejects invalid options before opening output (%j)", (options) => {
    expect(() => generateSyntheticWorld(options)).toThrow(RangeError);
    expect(() => writeSyntheticWorld(join(tmpdir(), "terraria-synthetic-invalid", "Large.wld"), options))
      .toThrow(RangeError);
  });
});
