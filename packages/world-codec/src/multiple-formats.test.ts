import { describe, expect, it } from "vitest";
import { buildMetadata, METADATA_START, wrapMetadata } from "./metadata-fixture.js";
import { readWorldTiles } from "./tiles.js";
import { readWorldMetadata } from "./metadata.js";
import { WorldFormatError } from "./world-format-error.js";

// Released-version examples, independent of the production registry (sources-and-versions.md, T1).
const releasedFormats = [269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 315, 316, 317, 318, 319, 325, 326];

function worldBytes(version: number, tiles = Uint8Array.from([0x42, 2, 3, 0x48, 255, 3])): Uint8Array {
  const layout = version < 315 ? "1.4.4" : version < 325 ? "1.4.5" : "1.4.5-lightning";
  const metadata = buildMetadata({ layout, width: 2, height: 4, name: "SCCR1", seed: "948580918" });
  const bytes = wrapMetadata(metadata.bytes, tiles.length, version, version < 315 ? 693 : version < 325 ? 753 : 754);
  const metadataStart = new DataView(bytes.buffer).getInt32(26, true);
  bytes.set(tiles, metadataStart + metadata.bytes.length);
  return bytes;
}

describe("one vanilla reader across released format families", () => {
  it.each(releasedFormats)("reads metadata and the same grass/water CWM for format %i", (version) => {
    const world = readWorldTiles(worldBytes(version));
    expect(world.header.version).toBe(version);
    expect(world.metadata).toMatchObject({ name: "SCCR1", seed: "948580918", width: 2, height: 4, evil: "corruption" });
    expect(world.palette).toEqual([{ kind: "vanilla", id: 2 }]);
    expect(Array.from(world.planes.block)).toEqual([0, 0, 0, 0, 65535, 65535, 65535, 65535]);
    expect(Array.from(world.planes.liquid)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(Array.from(world.planes.liquidAmount)).toEqual([0, 0, 0, 0, 255, 255, 255, 255]);
  });

  it.each([268, 280, 284, 294, 302, 314, 320, 321, 322, 323, 324, 327])("rejects unadmitted format %i before parsing metadata", (version) => {
    expect(() => readWorldMetadata(worldBytes(version))).toThrow(`format version ${String(version)} is not supported`);
  });

  it.each([269, 279, 315, 319, 325, 326])("requires exact metadata boundaries in format %i", (version) => {
    const bytes = worldBytes(version);
    const view = new DataView(bytes.buffer);
    view.setInt32(30, view.getInt32(30, true) + 1, true);
    expect(() => readWorldMetadata(bytes)).toThrow("unread bytes");
  });

  // A mislabelled file must fail at the metadata boundary instead of loading with shifted fields: the
  // profile selected from the header is the one the walk actually follows.
  it.each([
    [279, "1.4.5-lightning"], [279, "1.4.5"], [315, "1.4.4"], [315, "1.4.5-lightning"],
    [319, "1.4.4"], [325, "1.4.5"], [326, "1.4.4"], [326, "1.4.5"],
  ] as const)("rejects format %i whose metadata has the %s layout", (version, layout) => {
    const metadata = buildMetadata({ layout, width: 2, height: 4 });
    const tiles = Uint8Array.from([0x42, 2, 3, 0x48, 255, 3]);
    const bytes = wrapMetadata(metadata.bytes, tiles.length, version);
    bytes.set(tiles, METADATA_START + metadata.bytes.length);
    expect(() => readWorldMetadata(bytes)).toThrow(WorldFormatError);
  });

  it.each([269, 279, 315, 319, 325, 326])("keeps strict vanilla owner checks in format %i", (version) => {
    expect(() => readWorldTiles(worldBytes(version, Uint8Array.from([0x01, 0x01, 0x08])))).toThrow("flag without owner");
  });

  it.each(releasedFormats)("preserves vanilla residual slopes and lava in format %i", (version) => {
    const world = readWorldTiles(worldBytes(version, Uint8Array.from([0x51, 0x30, 255, 3, 0x40, 3])));
    expect(world.palette).toEqual([]);
    expect(Array.from(world.planes.block)).toEqual(Array<number>(8).fill(65535));
    expect(Array.from(world.planes.shape)).toEqual([3, 3, 3, 3, 0, 0, 0, 0]);
    expect(Array.from(world.planes.liquid)).toEqual([2, 2, 2, 2, 0, 0, 0, 0]);
    expect(Array.from(world.planes.liquidAmount)).toEqual([255, 255, 255, 255, 0, 0, 0, 0]);
  });
});
