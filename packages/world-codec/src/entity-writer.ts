import { readEntitySection, readTileEntityPayloads, type EntityItem, type EntitySectionName, type TileEntityPayload } from "./entities.js";
import { WorldFormatError } from "./world-format-error.js";
import { resolveWorldFormat } from "./world-format.js";
import type { WorldTilesResult } from "./tiles.js";

export const EDITABLE_ENTITY_SECTIONS = { chests: "Chests", signs: "Signs", tileEntities: "TileEntities", weightedPressurePlates: "WeightedPressurePlates" } as const;
const fail = (reason: string): never => { throw new WorldFormatError("UnsupportedWrite", 0, reason); };

class EntityOutput {
  private readonly bytes: number[] = [];
  integer(value: number, bytes: 1 | 2 | 4, signed = true): void {
    const maximum = signed ? 2 ** (bytes * 8 - 1) - 1 : 2 ** (bytes * 8) - 1;
    const minimum = signed ? -(2 ** (bytes * 8 - 1)) : 0;
    if (!Number.isInteger(value) || value < minimum || value > maximum) fail("entity integer is outside its binary range");
    for (let index = 0; index < bytes; index++) this.bytes.push((value >>> (index * 8)) & 255);
  }
  raw(bytes: Uint8Array): void { for (const byte of bytes) this.bytes.push(byte); }
  string(value: string): void {
    const bytes = new TextEncoder().encode(value);
    if (bytes.length > 1048576 || new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) !== value) fail("entity string is not losslessly encodable within the 1 MiB limit");
    let length = bytes.length;
    while (length >= 128) { this.bytes.push((length & 127) | 128); length >>>= 7; }
    this.bytes.push(length); this.raw(bytes);
  }
  finish(): Uint8Array { return Uint8Array.from(this.bytes); }
}

export function tileEntityPayloadsOf(world: WorldTilesResult): readonly TileEntityPayload[] {
  return world.envelope.tileEntityPayloads ?? readTileEntityPayloads(world.envelope.source, world.sections.tileEntities, world.header.version);
}

/** Only changed supported sections are encoded. All other sections keep their exact original bytes. */
export function writeEntitySection(world: WorldTilesResult, name: EntitySectionName): Uint8Array {
  const output = new EntityOutput();
  const position = (x: number, y: number, size: 2 | 4): void => {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= world.metadata.width || y >= world.metadata.height) fail("entity position is outside the world");
    output.integer(x, size); output.integer(y, size);
  };
  if (name === "Chests") {
    const entries = world.entities.Chests.data?.entries ?? fail("editing unreadable chests is unsupported");
    output.integer(entries.length, 2);
    const shared = resolveWorldFormat(world.header.version)?.entities.chestSlotCounts === "shared-int16";
    const slots = entries[0]?.slotCount ?? 40;
    if (shared) output.integer(slots, 2);
    const occupied = new Set<string>();
    for (const entry of entries) {
      const key = `${String(entry.x)},${String(entry.y)}`;
      if (occupied.has(key)) fail("duplicate chest position"); occupied.add(key);
      position(entry.x, entry.y, 4); output.string(entry.name);
      if (!Number.isInteger(entry.slotCount) || entry.slotCount < 0 || entry.slotCount > 1048576 || (shared && entry.slotCount !== slots)) fail("invalid or inconsistent chest slot count");
      if (!shared) output.integer(entry.slotCount, 4);
      const items = new Map<number, EntityItem>();
      for (const item of entry.items) {
        if (!Number.isInteger(item.slot) || item.slot < 0 || item.slot >= entry.slotCount || items.has(item.slot) || item.stack <= 0) fail("invalid or duplicate chest slot");
        items.set(item.slot, item);
      }
      for (let slot = 0; slot < entry.slotCount; slot++) {
        const item = items.get(slot); output.integer(item?.stack ?? 0, 2);
        if (item !== undefined) { output.integer(item.itemId, 4); output.integer(item.prefix, 1, false); }
      }
    }
  } else if (name === "Signs") {
    const entries = world.entities.Signs.data?.entries ?? fail("editing unreadable signs is unsupported");
    output.integer(entries.length, 2);
    const positions = new Set<string>();
    for (const entry of entries) {
      const key = `${String(entry.x)},${String(entry.y)}`;
      if (positions.has(key)) fail("duplicate sign position"); positions.add(key);
      output.string(entry.text); position(entry.x, entry.y, 4);
    }
  } else if (name === "WeightedPressurePlates") {
    const entries = world.entities.WeightedPressurePlates.data?.entries ?? fail("editing unreadable pressure plates is unsupported");
    output.integer(entries.length, 4);
    const positions = new Set<string>();
    for (const entry of entries) {
      const key = `${String(entry.x)},${String(entry.y)}`;
      if (positions.has(key)) fail("duplicate pressure plate position"); positions.add(key);
      position(entry.x, entry.y, 4);
    }
  } else if (name === "TileEntities") {
    const entries = world.entities.TileEntities.data?.entries ?? fail("editing unreadable tile entities is unsupported");
    const payloads = new Map(tileEntityPayloadsOf(world).map((item) => [item.entityId, item]));
    const ids = new Set<number>(), positions = new Set<string>();
    output.integer(entries.length, 4);
    for (const entry of entries) {
      const key = `${String(entry.x)},${String(entry.y)}`;
      if (entry.entityId < 0 || ids.has(entry.entityId) || positions.has(key)) fail("duplicate or invalid tile entity identity/position");
      ids.add(entry.entityId); positions.add(key);
      const retained = payloads.get(entry.entityId) ?? fail("a copied tile entity requires its original lossless payload");
      if (retained.kind !== entry.kind) fail("a copied tile entity requires its original lossless payload");
      output.integer(entry.kind, 1, false); output.integer(entry.entityId, 4); position(entry.x, entry.y, 2); output.raw(retained.payload);
    }
  } else return fail("editing this entity section is unsupported");
  const bytes = output.finish();
  let decoded: unknown;
  try { decoded = readEntitySection(bytes, name, { start: 0, end: bytes.length }, world.header.version); }
  catch { return fail("edited entity section cannot be read back"); }
  // The payload may contain hidden fields, but every modelled field must still match the requested record.
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]));
    return value;
  };
  if (JSON.stringify(canonical(decoded)) !== JSON.stringify(canonical(world.entities[name].data))) fail("tile entity payload differs from its modelled fields");
  return bytes;
}
