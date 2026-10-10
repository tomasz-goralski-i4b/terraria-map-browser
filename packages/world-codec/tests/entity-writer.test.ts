import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { readWorldHeader, readWorldTiles, writeWorld, SUPPORTED_VANILLA_FORMATS, type WorldTilesResult } from "../src/index.js";
import { writerSource } from "./writer-support.js";

interface Vector { readonly id: string; readonly section: string; readonly hex: string; readonly version?: number; readonly result?: unknown }
const vectors = (JSON.parse(readFileSync(new URL("../../../contracts/vectors/entities.vectors.json", import.meta.url), "utf8")) as { vectors: Vector[] }).vectors;
const hex = (id: string): Uint8Array => {
  const vector = vectors.find((candidate) => candidate.id === id);
  if (vector === undefined) throw new Error(`Missing entity vector ${id}`);
  return Uint8Array.from(Buffer.from(vector.hex, "hex"));
};
export function entityWorld(version = 326, chestBytes?: Uint8Array, signBytes: Uint8Array = new Uint8Array(2), tileBytes: Uint8Array = new Uint8Array(4)): WorldTilesResult {
  const source = writerSource(640, 360, undefined, version), header = readWorldHeader(source);
  const sections = [chestBytes ?? new Uint8Array(version < 294 ? [0, 0, 40, 0] : [0, 0]), signBytes, new Uint8Array(6), tileBytes, new Uint8Array(4), new Uint8Array(4), new Uint8Array(12), new Uint8Array(1)];
  const footer = source.subarray(header.sections.footer.start);
  const result = new Uint8Array(header.sections.chests.start + sections.reduce((sum, bytes) => sum + bytes.length, 0) + footer.length);
  result.set(source.subarray(0, header.sections.chests.start));
  let offset = header.sections.chests.start;
  const data = new DataView(result.buffer);
  sections.forEach((bytes, index) => { data.setInt32(26 + (index + 2) * 4, offset, true); result.set(bytes, offset); offset += bytes.length; });
  data.setInt32(66, offset, true); result.set(footer, offset);
  return readWorldTiles(result);
}

test.each(SUPPORTED_VANILLA_FORMATS)("format %i writes cloned chests and Unicode signs with correct section pointers and preserves other sections", (version) => {
  const world = entityWorld(version, hex(version < 294 ? "E34" : "E01"), hex("E02"));
  const chest = world.entities.Chests.data?.entries[0], sign = world.entities.Signs.data?.entries[0];
  if (chest === undefined || sign === undefined) throw new Error("Readable chest/sign vectors required");
  const original = world.envelope.source.slice();
  Object.assign(world.entities.Chests, { data: { entries: [chest, { ...structuredClone(chest), x: 400, y: 200, name: "Cavern supplies — spare" }] } });
  Object.assign(world.entities.Signs, { data: { entries: [sign, { ...sign, x: 402, y: 200, text: "Forest village\n→ Caverns 🌲" }] } });
  const written = readWorldTiles(new Uint8Array(writeWorld(world)));
  expect(written.entities.Chests.data).toEqual(world.entities.Chests.data);
  expect(written.entities.Signs.data).toEqual(world.entities.Signs.data);
  expect(world.envelope.source).toEqual(original);
  for (const section of world.envelope.opaqueSections.filter((section) => section.name !== "chests" && section.name !== "signs")) expect(written.envelope.opaqueSections.find((item) => item.name === section.name)?.bytes).toEqual(section.bytes);
  expect(written.sections.footer.end).toBe(written.envelope.source.length);
});

test.each(vectors.filter((vector) => vector.section === "TileEntities" && vector.result !== undefined))("$id clones every tile-entity kind without losing uninterpreted payload state", (vector) => {
  const version = vector.version ?? 326, bytes = hex(vector.id), world = entityWorld(version, undefined, undefined, bytes);
  const entity = world.entities.TileEntities.data?.entries[0];
  if (entity === undefined) throw new Error("Readable tile entity vector required");
  const copy = { ...structuredClone(entity), entityId: entity.entityId + 1, x: 400, y: 200 };
  Object.assign(world.entities.TileEntities, { data: { entries: [entity, copy] } });
  Object.assign(world.envelope, { tileEntityPayloads: [{ entityId: entity.entityId, kind: entity.kind, payload: bytes.slice(13) }, { entityId: copy.entityId, kind: copy.kind, payload: bytes.slice(13) }] });
  const written = readWorldTiles(new Uint8Array(writeWorld(world)));
  expect(written.entities.TileEntities.data).toEqual(world.entities.TileEntities.data);
  const raw = written.envelope.opaqueSections.find((section) => section.name === "tileEntities")?.bytes;
  expect(raw?.subarray(4, bytes.length)).toEqual(bytes.subarray(4));
  expect(raw?.subarray(bytes.length + 9)).toEqual(bytes.subarray(13));
});

test("deleting all chest records writes a valid empty section; invalid records fail without changing source", () => {
  const world = entityWorld(279, hex("E34"));
  Object.assign(world.entities.Chests, { data: { entries: [] } });
  expect(readWorldTiles(new Uint8Array(writeWorld(world))).entities.Chests.data?.entries).toEqual([]);
  const modern = entityWorld(326, hex("E01")), chest = modern.entities.Chests.data?.entries[0];
  if (chest === undefined) throw new Error("Readable chest required");
  const original = modern.envelope.source.slice();
  for (const invalid of [{ ...chest, x: -1 }, { ...chest, slotCount: -1 }, { ...chest, items: [{ slot: 0, itemId: 28, stack: 40000, prefix: 0 }] }, { ...chest, items: [chest.items[0], chest.items[0]] }]) {
    Object.assign(modern.entities.Chests, { data: { entries: [invalid] } }); expect(() => writeWorld(modern)).toThrow(/UnsupportedWrite/); expect(modern.envelope.source).toEqual(original);
  }
});
