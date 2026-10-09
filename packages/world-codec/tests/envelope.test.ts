import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectTransferList, readWorldTiles, WorldFormatError } from "../src/index.js";
import { buildMetadata, wrapMetadata } from "../src/metadata-fixture.js";

const worldsDir = new URL("../../test-fixtures/worlds/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", worldsDir), "utf8")) as {
  readonly worlds: readonly { readonly file: string }[];
};

function syntheticWorld(): Uint8Array<ArrayBuffer> {
  const bytes = wrapMetadata(buildMetadata().bytes, 4);
  const view = new DataView(bytes.buffer);
  bytes.set([0x40, 3, 0x40, 3], view.getInt32(30, true));
  return bytes;
}

describe("preserved world envelope", () => {
  it.each(manifest.worlds)("reconstructs every byte of $file from adjacent shared views", ({ file }) => {
    const bytes = Uint8Array.from(readFileSync(new URL(file, worldsDir)));
    const result = readWorldTiles(bytes);
    const envelope = result.envelope;
    const spans = [envelope.fileHeader, envelope.metadata, envelope.tiles,
      ...envelope.opaqueSections.map((section) => section.bytes), envelope.footer];
    expect(Buffer.concat(spans.map((span) => Buffer.from(span))).equals(Buffer.from(bytes))).toBe(true);
    expect(envelope.source).toBe(bytes);
    expect(envelope.source.buffer.byteLength).toBe(bytes.length);
    expect(envelope.opaqueSections.map((section) => section.name)).toEqual([
      "chests", "signs", "npcsAndMobs", "tileEntities", "weightedPressurePlates", "townManager", "bestiary", "creativePowers",
    ]);
    let offset = 0;
    for (const span of spans) {
      expect(span.buffer).toBe(bytes.buffer);
      expect(span.byteOffset).toBe(offset);
      expect(span.length).toBeGreaterThan(0);
      offset += span.length;
    }
    expect(offset).toBe(bytes.length);
    expect(envelope.frameImportantBits.buffer).toBe(bytes.buffer);
    expect(result.sections.frameImportantBits.buffer).toBe(bytes.buffer);
    expect(envelope.frameImportantBits).toEqual(result.sections.frameImportantBits);
    const transfer = collectTransferList(result);
    expect(transfer.filter((buffer) => buffer === bytes.buffer)).toHaveLength(1);
    expect(new Set(transfer).size).toBe(11);
  });

  it("retains decoded metadata, details and header independently of caller edits", () => {
    const result = readWorldTiles(syntheticWorld());
    const baseline = structuredClone(result.envelope.original);
    Object.assign(result.metadata, { name: "Crimson Observatory", worldId: 1743427911 });
    Object.assign(result.metadata.bounds, { left: 16 });
    Object.assign(result.header, { revision: 3 });
    Object.assign(result.details.spawnAndLandmarks.spawn, { x: 1, y: 2 });
    expect(result.envelope.original).toEqual(baseline);
    expect(result.envelope.original.metadata).not.toBe(result.metadata);
    expect(result.envelope.original.details).not.toBe(result.details);
  });

  it("keeps padding bits and offsets when the world is a subview", () => {
    const bytes = syntheticWorld();
    bytes[166] = 0xfc;
    const storage = new Uint8Array(bytes.length + 32);
    storage.set(bytes, 16);
    const source = storage.subarray(16, 16 + bytes.length);
    const { envelope, sections } = readWorldTiles(source);
    expect(envelope.source).toBe(source);
    expect(envelope.fileHeader.byteOffset).toBe(16);
    expect(envelope.footer.byteOffset).toBe(16 + sections.footer.start);
    expect(envelope.frameImportantBits.buffer).toBe(storage.buffer);
    expect(envelope.frameImportantBits.at(-1)).toBe(0xfc);
    expect(envelope.footer.length).toBe(sections.footer.end - sections.footer.start);
  });

  it.each([
    { corruption: "overlap", slot: 38, change: -1, kind: "MalformedSectionTable", offset: 38 },
    { corruption: "empty opaque section", slot: 38, change: 0, kind: "MalformedSectionTable", offset: 38 },
    { corruption: "gap after header", slot: 26, change: 1, kind: "MalformedSectionTable", offset: 26 },
    { corruption: "footer outside file", slot: 66, change: 4096, kind: "MalformedSectionTable", offset: 66 },
  ])("rejects $corruption with a typed error at the pointer slot", ({ slot, change, kind, offset }) => {
    const bytes = syntheticWorld();
    const view = new DataView(bytes.buffer);
    const pointer = slot === 38 ? view.getInt32(34, true) : view.getInt32(slot, true);
    view.setInt32(slot, pointer + change, true);
    expect(() => readWorldTiles(bytes)).toThrow(WorldFormatError);
    expect(() => readWorldTiles(bytes)).toThrow(expect.objectContaining({ kind, offset }));
  });

  it("rejects a gap after the tile payload at its first unconsumed byte", () => {
    const bytes = syntheticWorld();
    const view = new DataView(bytes.buffer);
    const end = view.getInt32(34, true);
    view.setInt32(34, end + 1, true);
    expect(() => readWorldTiles(bytes)).toThrow(expect.objectContaining({ kind: "MalformedTiles", offset: end }));
  });
});
