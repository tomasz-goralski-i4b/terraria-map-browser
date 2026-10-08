import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readEntitySection, readWorldEntities, type EntitySectionName } from "../src/entities.js";
import { readWorldHeader } from "../src/header.js";
import { buildMetadata, METADATA_START, wrapMetadata } from "../src/metadata-fixture.js";
import { readWorldTiles } from "../src/tiles.js";

interface EntityVector {
  readonly id: string; readonly section: EntitySectionName; readonly version?: number; readonly start: number; readonly end: number; readonly hex: string;
  readonly result?: unknown; readonly error?: { readonly field: string; readonly offset: number; readonly reason: string };
}
const root = new URL("../../../", import.meta.url);
const document = JSON.parse(readFileSync(new URL("contracts/vectors/entities.vectors.json", root), "utf8")) as { vectors: EntityVector[] };

describe("independent shared entity vectors", () => {
  it.each(document.vectors)("decodes $id ($section)", (vector) => {
    const bytes = new Uint8Array(vector.start + vector.hex.length / 2);
    bytes.set(Buffer.from(vector.hex, "hex"), vector.start);
    const decode = (): unknown => readEntitySection(bytes, vector.section, { start: vector.start, end: vector.end }, vector.version);
    if (vector.error) {
      expect(decode).toThrow(expect.objectContaining({ kind: "MalformedSection", section: vector.section, ...vector.error }));
    } else {
      expect(decode()).toEqual(vector.result);
    }
  });
});

describe("entity corpus", () => {
  it.each([
    ["SCCO1", 190, 23732, 71], ["SCCR2", 168, 20771, 68], ["SECR1", 176, 21880, 69],
    ["SJCO1", 169, 21024, 69], ["SMCO1", 172, 21438, 69],
  ] as const)("reproduces %s counts and byte sizes", (name, chestCount, chestBytes, npcBytes) => {
    const bytes = readFileSync(new URL(`packages/test-fixtures/worlds/${name}.wld`, root));
    const sections = readWorldEntities(bytes);
    expect(Object.values(sections).map(({ error }) => error)).toEqual(Array.from({ length: 8 }, () => null));
    expect(sections.Chests.data?.entries).toHaveLength(chestCount);
    expect(sections.Signs.data?.entries).toHaveLength(0);
    expect(sections.NpcsAndMobs.data?.townNpcs.map(({ npcId }) => npcId)).toEqual([37, 22]);
    expect(sections.NpcsAndMobs.data?.mobs).toHaveLength(0);
    expect(sections.TileEntities.data?.entries).toHaveLength(0);
    expect(sections.WeightedPressurePlates.data?.entries).toHaveLength(0);
    expect(sections.TownManager.data?.entries).toHaveLength(0);
    expect(sections.Bestiary.data).toEqual({ killCount: 0, seenCount: 0, chattedCount: 0 });
    expect(sections.CreativePowers.data?.entries.map(({ powerId }) => powerId)).toEqual([0, 8, 9, 10, 12, 13]);
    expect(Object.values(sections).map(({ boundary }) => boundary.end - boundary.start)).toEqual([chestBytes, 2, npcBytes, 4, 4, 4, 12, 31]);
    if (name === "SCCO1") expect(sections.Chests.data?.entries.reduce((sum, chest) => sum + chest.items.length, 0)).toBe(1212);
  });

  it("isolates a malformed power section from chests and NPCs", () => {
    const bytes = readFileSync(new URL("packages/test-fixtures/worlds/SCCO1.wld", root));
    const header = readWorldHeader(bytes);
    bytes[header.sections.creativePowers.start] = 2;
    const sections = readWorldEntities(bytes, header);
    expect(sections.CreativePowers.error).toMatchObject({ code: "MalformedSection", section: "CreativePowers", field: "more", offset: header.sections.creativePowers.start });
    expect(sections.Chests.data?.entries).toHaveLength(190);
    expect(sections.NpcsAndMobs.data?.townNpcs).toHaveLength(2);
    expect(Object.values(sections).filter(({ error }) => error !== null)).toHaveLength(1);
  });
});

describe("entity layouts of older formats", () => {
  /** A synthetic world whose chest and sign sections are both `00 00`; the other six sections stay malformed. */
  function worldWithEmptyLists(version: number): Uint8Array {
    const layout = version === 279 ? "1.4.4" : version === 315 ? "1.4.5" : "1.4.5-lightning";
    const metadata = buildMetadata({ layout, width: 2, height: 4 });
    const tiles = Uint8Array.from([0x42, 2, 3, 0x48, 255, 3]);
    const bytes = wrapMetadata(metadata.bytes, tiles.length, version);
    bytes.set(tiles, METADATA_START + metadata.bytes.length);
    const { sections } = readWorldHeader(bytes);
    bytes.fill(0, sections.chests.start, sections.signs.end);
    return bytes;
  }

  it.each([315, 325, 326])("format %i reads `00 00` as an empty chest list", (version) => {
    const entities = readWorldEntities(worldWithEmptyLists(version));
    expect(entities.Chests.data?.entries).toEqual([]);
    expect(entities.Signs.data?.entries).toEqual([]);
  });

  it("format 279 expects the shared Int16 slot count after the chest count", () => {
    const bytes = worldWithEmptyLists(279);
    const entities = readWorldEntities(bytes);
    expect(entities.Chests.error).toMatchObject({ field: "slotCount", offset: readWorldHeader(bytes).sections.chests.start + 2 });
    expect(entities.Signs.data?.entries).toEqual([]);
  });

  it.each([279, 315, 326])("readWorldTiles exposes entities for format %i", (version) => {
    expect(readWorldTiles(worldWithEmptyLists(version)).entities.Signs.data?.entries).toEqual([]);
  });

  it.each([268, 300, 311, 327])("rejects format %i, which has no known entity layout", (version) => {
    const bytes = Uint8Array.from([0, 0]);
    expect(() => readEntitySection(bytes, "Signs", { start: 0, end: 2 }, version)).toThrow(expect.objectContaining({ kind: "UnsupportedVersion" }));
    const world = worldWithEmptyLists(326);
    const header = readWorldHeader(world);
    expect(() => readWorldEntities(world, { ...header, header: { ...header.header, version } })).toThrow(expect.objectContaining({ kind: "UnsupportedVersion" }));
  });
});
