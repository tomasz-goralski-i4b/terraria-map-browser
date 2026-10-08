import { readWorldHeader, type SectionBoundary, type WorldHeader } from "./header.js";
import { WorldFormatError } from "./world-format-error.js";
import { requireWorldFormat, type WorldFormatProfile } from "./world-format.js";

export interface EntityItem { readonly slot: number; readonly itemId: number; readonly stack: number; readonly prefix: number }
export interface WorldChest { readonly x: number; readonly y: number; readonly name: string; readonly slotCount: number; readonly items: readonly EntityItem[] }
export interface WorldSign { readonly x: number; readonly y: number; readonly text: string }
export interface WorldTownNpc { readonly npcId: number; readonly displayName: string; readonly x: number; readonly y: number; readonly homeless: boolean; readonly homeX: number; readonly homeY: number }
export interface WorldMob { readonly npcId: number; readonly x: number; readonly y: number }
export interface WorldTileEntity { readonly kind: number; readonly entityId: number; readonly x: number; readonly y: number; readonly items: readonly EntityItem[]; readonly dyes: readonly EntityItem[]; readonly misc: readonly EntityItem[]; readonly anchorItemId: number | null }
export interface WorldPressurePlate { readonly x: number; readonly y: number }
export interface WorldRoom { readonly npcId: number; readonly x: number; readonly y: number }
export interface WorldCreativePower { readonly powerId: number; readonly booleanValue: boolean | null; readonly sliderValue: number | null }
export interface EntityDataBySection {
  readonly Chests: { readonly entries: readonly WorldChest[] };
  readonly Signs: { readonly entries: readonly WorldSign[] };
  readonly NpcsAndMobs: { readonly townNpcs: readonly WorldTownNpc[]; readonly mobs: readonly WorldMob[] };
  readonly TileEntities: { readonly entries: readonly WorldTileEntity[] };
  readonly WeightedPressurePlates: { readonly entries: readonly WorldPressurePlate[] };
  readonly TownManager: { readonly entries: readonly WorldRoom[] };
  readonly Bestiary: { readonly killCount: number; readonly seenCount: number; readonly chattedCount: number };
  readonly CreativePowers: { readonly entries: readonly WorldCreativePower[] };
}
export type EntitySectionName = keyof EntityDataBySection;
export interface EntitySectionFailure { readonly code: "MalformedSection"; readonly section: EntitySectionName; readonly field: string; readonly offset: number; readonly reason: string }
export type EntitySectionResult<K extends EntitySectionName> =
  | { readonly section: K; readonly boundary: SectionBoundary; readonly data: EntityDataBySection[K]; readonly error: null }
  | { readonly section: K; readonly boundary: SectionBoundary; readonly data: null; readonly error: EntitySectionFailure };
export type WorldEntities = { readonly [K in EntitySectionName]: EntitySectionResult<K> };
type EntityLayout = WorldFormatProfile["entities"];

class EntityReader {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  readonly section: EntitySectionName;
  readonly boundary: SectionBoundary;
  private readonly layout: EntityLayout;
  pos: number;

  constructor(bytes: Uint8Array, section: EntitySectionName, boundary: SectionBoundary, layout: EntityLayout) {
    this.bytes = bytes;
    this.section = section;
    this.boundary = boundary;
    this.layout = layout;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = boundary.start;
  }

  fail(offset: number, field: string, reason: string): never {
    throw new WorldFormatError("MalformedSection", offset, reason, { section: this.section, field });
  }

  private take(size: number, field: string): number {
    const start = this.pos;
    if (size > this.boundary.end - start || size > this.bytes.length - start) this.fail(start, field, "overruns section");
    this.pos += size;
    return start;
  }

  u8(field: string): number { return this.view.getUint8(this.take(1, field)); }
  i16(field: string): number { return this.view.getInt16(this.take(2, field), true); }
  i32(field: string): number { return this.view.getInt32(this.take(4, field), true); }
  single(field: string): number { return this.view.getFloat32(this.take(4, field), true); }

  bool(field: string): boolean {
    const start = this.pos;
    const value = this.u8(field);
    if (value > 1) this.fail(start, field, "invalid boolean");
    return value === 1;
  }

  count(size: 2 | 4, minimum: number, field: string): number {
    const start = this.pos;
    const count = size === 2 ? this.i16(field) : this.i32(field);
    if (count < 0 || count * minimum > this.boundary.end - this.pos) this.fail(start, field, "list count is negative or does not fit in the section");
    return count;
  }

  string(field: string): string {
    const start = this.pos;
    let length = 0;
    for (let index = 0; ; index++) {
      if (index === 5) this.fail(start, field, "string length prefix longer than 5 bytes");
      if (this.pos === this.boundary.end) this.fail(start, field, "overruns section");
      const current = this.u8(field);
      if (index === 4 && (current & 128) === 0 && current > 15) this.fail(start, field, "string length prefix exceeds 32 bits");
      length += (current & 127) * 2 ** (7 * index);
      if ((current & 128) === 0) break;
    }
    if (length > 0x7fffffff || length > this.boundary.end - this.pos) this.fail(start, field, "string length overruns section");
    if (length > 1048576) this.fail(start, field, "string length exceeds safety limit");
    const offset = this.take(length, field);
    try {
      return strictUtf8.decode(this.bytes.subarray(offset, offset + length));
    } catch {
      return this.fail(start, field, "invalid UTF-8");
    }
  }

  records<T>(size: 2 | 4, minimum: number, read: () => T): T[] {
    const count = this.count(size, minimum, "count");
    const entries: T[] = [];
    for (let index = 0; index < count; index++) entries.push(read());
    return entries;
  }

  chests(): WorldChest[] {
    if (this.layout.chestSlotCounts === "per-chest-int32") return this.records(2, 13, () => this.chest(null));
    // Before format 294 one Int16 slot count follows the chest count and applies to every chest.
    const start = this.pos, count = this.i16("count");
    if (count < 0) this.fail(start, "count", "list count is negative or does not fit in the section");
    const slotCount = this.count(2, 2, "slotCount");
    if (count * (9 + 2 * slotCount) > this.boundary.end - this.pos) this.fail(start, "count", "list count is negative or does not fit in the section");
    const entries: WorldChest[] = [];
    for (let index = 0; index < count; index++) entries.push(this.chest(slotCount));
    return entries;
  }

  private chest(sharedSlotCount: number | null): WorldChest {
    const x = this.i32("x"), y = this.i32("y"), name = this.string("name");
    const slotCount = sharedSlotCount ?? this.count(4, 2, "slotCount");
    const items: EntityItem[] = [];
    for (let slot = 0; slot < slotCount; slot++) {
      const offset = this.pos, stack = this.i16("stack");
      if (stack < 0) this.fail(offset, "stack", "negative stack");
      if (stack > 0) items.push({ slot, itemId: this.i32("itemId"), stack, prefix: this.u8("prefix") });
    }
    return { x, y, name, slotCount, items };
  }

  sign(): WorldSign {
    const text = this.string("text");
    return { x: this.i32("x"), y: this.i32("y"), text };
  }

  npcs(): EntityDataBySection["NpcsAndMobs"] {
    const shimmered = this.count(4, 4, "shimmeredCount");
    for (let index = 0; index < shimmered; index++) this.i32("shimmeredNpcId");
    const townNpcs: WorldTownNpc[] = [];
    while (this.bool("more")) {
      const npcId = this.i32("npcId"), displayName = this.string("displayName");
      const x = this.single("x"), y = this.single("y"), homeless = this.bool("homeless");
      const homeX = this.i32("homeX"), homeY = this.i32("homeY");
      const offset = this.pos, bits = this.u8("extraBits");
      if ((bits & ~1) !== 0) this.fail(offset, "extraBits", "unknown NPC extra bits");
      if ((bits & 1) !== 0) this.i32("variationIndex");
      if (this.layout.npcHomelessDespawn) this.bool("homelessDespawn");
      townNpcs.push({ npcId, displayName, x, y, homeless, homeX, homeY });
    }
    const mobs: WorldMob[] = [];
    while (this.bool("more")) mobs.push({ npcId: this.i32("npcId"), x: this.single("x"), y: this.single("y") });
    return { townNpcs, mobs };
  }

  private item(slot: number): EntityItem {
    const itemId = this.i16("itemId"), prefix = this.u8("prefix"), stack = this.i16("stack");
    return { slot, itemId, stack, prefix };
  }

  private presentItems(bits: number, slots: number): EntityItem[] {
    const items: EntityItem[] = [];
    for (let slot = 0; slot < slots; slot++) if ((bits & (1 << slot)) !== 0) items.push(this.item(slot));
    return items;
  }

  tileEntity(): WorldTileEntity {
    const offset = this.pos, kind = this.u8("kind");
    if (kind > 10) this.fail(offset, "kind", "unknown tile entity kind");
    const entityId = this.i32("entityId"), x = this.i16("x"), y = this.i16("y");
    let items: EntityItem[] = [], dyes: EntityItem[] = [], misc: EntityItem[] = [];
    let anchorItemId: number | null = null;
    switch (kind) {
      case 0: this.i16("npcSlot"); break;
      case 1: case 4: case 6: case 8: items = [this.item(0)]; break;
      case 2: this.u8("checkKind"); this.bool("on"); break;
      case 3: {
        const itemBits = this.u8("itemPresence"), dyeBits = this.u8("dyePresence");
        if (this.layout.displayDollPose) this.u8("pose");
        const extra = this.layout.displayDollExtraSlots ? this.u8("extraPresence") : 0;
        items = this.presentItems(itemBits | ((extra & 2) << 7), 9);
        dyes = this.presentItems(dyeBits | ((extra & 4) << 6), 9);
        misc = this.presentItems(extra & 1, 1);
        break;
      }
      case 5: {
        const bits = this.u8("presence");
        items = this.presentItems(bits & 3, 2);
        dyes = this.presentItems((bits >> 2) & 3, 2);
        break;
      }
      case 9: case 10: anchorItemId = this.i16("anchorItemId"); break;
    }
    return { kind, entityId, x, y, items, dyes, misc, anchorItemId };
  }

  bestiary(): EntityDataBySection["Bestiary"] {
    const killCount = this.count(4, 5, "killCount");
    for (let index = 0; index < killCount; index++) { this.string("npcKey"); this.i32("kills"); }
    const keys = (field: string): number => {
      const count = this.count(4, 1, field);
      for (let index = 0; index < count; index++) this.string("npcKey");
      return count;
    };
    return { killCount, seenCount: keys("seenCount"), chattedCount: keys("chattedCount") };
  }

  powers(): EntityDataBySection["CreativePowers"] {
    const entries: WorldCreativePower[] = [];
    while (this.bool("more")) {
      const offset = this.pos, powerId = this.i16("powerId");
      switch (powerId) {
        case 0: case 5: case 9: case 10: case 11: case 13:
          entries.push({ powerId, booleanValue: this.bool("value"), sliderValue: null }); break;
        case 8: case 12: case 14:
          entries.push({ powerId, booleanValue: null, sliderValue: this.single("value") }); break;
        default: this.fail(offset, "powerId", "unknown creative power");
      }
    }
    return { entries };
  }
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Strict entity section entry point for one readable format's layout; diagnostics use absolute offsets. */
export function readEntitySection<K extends EntitySectionName>(bytes: Uint8Array, section: K, boundary: SectionBoundary, version = 326): EntityDataBySection[K] {
  const layout = requireWorldFormat(version).entities;
  if (!Number.isInteger(boundary.start) || !Number.isInteger(boundary.end) || boundary.start < 0 || boundary.end < boundary.start || boundary.end > bytes.length) {
    throw new RangeError("Invalid entity section boundary");
  }
  const reader = new EntityReader(bytes, section, boundary, layout);
  const decoders: { [S in EntitySectionName]: () => EntityDataBySection[S] } = {
    Chests: () => ({ entries: reader.chests() }),
    Signs: () => ({ entries: reader.records(2, 9, () => reader.sign()) }),
    NpcsAndMobs: () => reader.npcs(),
    TileEntities: () => ({ entries: reader.records(4, 9, () => reader.tileEntity()) }),
    WeightedPressurePlates: () => ({ entries: reader.records(4, 8, () => ({ x: reader.i32("x"), y: reader.i32("y") })) }),
    TownManager: () => ({ entries: reader.records(4, 12, () => ({ npcId: reader.i32("npcId"), x: reader.i32("x"), y: reader.i32("y") })) }),
    Bestiary: () => reader.bestiary(),
    CreativePowers: () => reader.powers(),
  };
  const data = decoders[section]();
  if (reader.pos !== boundary.end) reader.fail(reader.pos, "end", "section does not end at its pointer");
  return data;
}

/** Entity failures do not invalidate the independently decoded world tiles or other sections. */
export function readWorldEntities(bytes: Uint8Array, header: WorldHeader = readWorldHeader(bytes)): WorldEntities {
  const version = requireWorldFormat(header.header.version).version;
  const decode = <K extends EntitySectionName>(section: K, boundary: SectionBoundary): EntitySectionResult<K> => {
    try {
      return { section, boundary, data: readEntitySection(bytes, section, boundary, version), error: null };
    } catch (error) {
      if (!(error instanceof WorldFormatError) || error.kind !== "MalformedSection") throw error;
      return { section, boundary, data: null, error: { code: "MalformedSection", section, field: error.field ?? "end", offset: error.offset, reason: error.reason } };
    }
  };
  const s = header.sections;
  return {
    Chests: decode("Chests", s.chests), Signs: decode("Signs", s.signs),
    NpcsAndMobs: decode("NpcsAndMobs", s.npcsAndMobs), TileEntities: decode("TileEntities", s.tileEntities),
    WeightedPressurePlates: decode("WeightedPressurePlates", s.weightedPressurePlates), TownManager: decode("TownManager", s.townManager),
    Bestiary: decode("Bestiary", s.bestiary), CreativePowers: decode("CreativePowers", s.creativePowers),
  };
}
