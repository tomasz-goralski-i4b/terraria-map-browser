import { describe, expect, it } from "vitest";
import { buildMetadata, wrapMetadata } from "./metadata-fixture.js";
import { readWorldMetadata } from "./metadata.js";
import { readWorldTiles } from "./tiles.js";
import { WorldFormatError } from "./world-format-error.js";

describe("Terraria 1.4.4.9 / tModLoader format 279 viewer support", () => {
  it.each([false, true])("reads custom dimensions with all special seeds set to %s", (allSpecialSeeds) => {
    const metadata = buildMetadata({
      version: 279, name: "CMCO1", seed: "598261056", worldId: 19093224,
      width: 13400, height: 3800, surfaceLevel: 866, rockLevel: 2366, allSpecialSeeds,
    });
    const bytes = wrapMetadata(metadata.bytes, 13400, 279);
    const result = readWorldMetadata(bytes);
    expect(result.header.version).toBe(279);
    expect(result.sections.frameImportantCount).toBe(693);
    expect(result.sections.metadata.start).toBe(159);
    expect(result.metadata).toMatchObject({
      name: "CMCO1", seed: "598261056", worldId: 19093224, width: 13400, height: 3800,
      surfaceLevel: 866, rockLevel: 2366, mode: "classic", evil: "corruption",
    });
  });

  it("decodes framed sunflowers and shimmer from a format-279 tile section", () => {
    const metadata = buildMetadata({ version: 279, width: 2, height: 4, allSpecialSeeds: true });
    // Sunflower (id 27), frame (18, 0), repeated for the first column; shimmer fills the second.
    const tiles = Uint8Array.from([0x42, 27, 18, 0, 0, 0, 3, 0x49, 1, 0x80, 255, 3]);
    const bytes = wrapMetadata(metadata.bytes, tiles.length, 279);
    bytes[72 + Math.floor(27 / 8)] = 1 << (27 % 8);
    bytes.set(tiles, 159 + metadata.bytes.length);
    const world = readWorldTiles(bytes);
    expect(world.palette).toEqual([{ kind: "vanilla", id: 27 }]);
    expect(Array.from(world.planes.frameX)).toEqual([18, 18, 18, 18, -1, -1, -1, -1]);
    expect(Array.from(world.planes.liquid)).toEqual([0, 0, 0, 0, 4, 4, 4, 4]);
    expect(Array.from(world.planes.liquidAmount)).toEqual([0, 0, 0, 0, 255, 255, 255, 255]);
  });

  it.each([1, 2, 3, 4, 5])("preserves an inactive block's residual shape %i beside lava in format 279", (shape) => {
    // CMCO1 (21,3713), offset 56328: flags 0x11,0x30 and a lava amount, with no active block.
    const metadata = buildMetadata({ version: 279, width: 1, height: 1 });
    const tiles = Uint8Array.from([0x11, shape << 4, 255]);
    const bytes = wrapMetadata(metadata.bytes, tiles.length, 279);
    bytes.set(tiles, 159 + metadata.bytes.length);
    const world = readWorldTiles(bytes);
    expect(world.planes.block[0]).toBe(0xffff);
    expect(world.planes.shape[0]).toBe(shape);
    expect(world.planes.liquid[0]).toBe(2);
    expect(world.planes.liquidAmount[0]).toBe(255);
  });

  it("still rejects ownerless paint in format 279", () => {
    const metadata = buildMetadata({ version: 279, width: 1, height: 1 });
    const tiles = Uint8Array.from([0x01, 0x01, 0x08]);
    const bytes = wrapMetadata(metadata.bytes, tiles.length, 279);
    bytes.set(tiles, 159 + metadata.bytes.length);
    expect(() => readWorldTiles(bytes)).toThrow(WorldFormatError);
    expect(() => readWorldTiles(bytes)).toThrow("flag without owner");
  });
});
