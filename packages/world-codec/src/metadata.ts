import { ByteReader } from "./byte-reader.js";
import { readWorldHeader, type WorldHeader } from "./header.js";
import { WorldFormatError } from "./world-format-error.js";
import { requireWorldFormat } from "./world-format.js";

export type WorldMode = "classic" | "expert" | "master" | "journey" | { mode: "unknown"; raw: number };

/** Signed pixel bounds stored in metadata rows 6–9; not inferred from tile dimensions. */
export interface WorldBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Validated metadata normalized from an admitted vanilla layout, before tile planes are allocated. */
export interface WorldMetadata {
  readonly name: string;
  readonly seed: string;
  readonly guid: string;
  readonly worldId: number;
  readonly bounds: WorldBounds;
  readonly width: number;
  readonly height: number;
  readonly mode: WorldMode;
  readonly evil: "corruption" | "crimson";
  /** Row of the surface (`Main.worldSurface`): the sky is above it. Fractional, as stored. */
  readonly surfaceLevel: number;
  /** Row where the rock (cavern) layer starts (`Main.rockLayer`). Fractional, as stored. */
  readonly rockLevel: number;
}

export interface WorldMetadataResult extends WorldHeader {
  readonly metadata: WorldMetadata;
}

/** A cursor bounded by the metadata section, never by the whole file. */
class MetadataReader {
  private readonly reader: ByteReader;
  private readonly bytes: Uint8Array;
  private readonly end: number;
  offset: number;

  constructor(bytes: Uint8Array, start: number, end: number) {
    this.bytes = bytes;
    this.reader = new ByteReader(bytes);
    this.offset = start;
    this.end = end;
  }

  fail(offset: number, reason: string, field?: string): never {
    throw new WorldFormatError("MalformedMetadata", offset, reason, field === undefined ? undefined : { field });
  }

  skip(size: number): void {
    if (size > this.end - this.offset) this.fail(this.offset, "overruns section");
    this.offset += size;
  }

  int(size = 4): number {
    const start = this.offset;
    this.skip(size);
    if (size === 1) return this.reader.readUint8(start);
    if (size === 2) return this.reader.readInt16(start);
    return this.reader.readInt32(start);
  }

  /** A Double that must be finite: layer levels are used as coordinates. */
  level(field: string): number {
    const start = this.offset;
    this.skip(8);
    const value = this.reader.readFloat64(start);
    if (!Number.isFinite(value)) this.fail(start, `${field}: not a finite number`, field);
    return value;
  }

  bool(): boolean {
    const start = this.offset;
    const value = this.int(1);
    if (value > 1) this.fail(start, "invalid boolean");
    return value === 1;
  }

  bools(count: number): void {
    for (let index = 0; index < count; index++) this.bool();
  }

  string(field: string, cap = 1048576): string {
    const start = this.offset;
    let length = 0;
    for (let index = 0; index < 5; index++) {
      if (this.offset === this.end) this.fail(start, `${field}: truncated length prefix`, field);
      const byte = this.int(1);
      if (index === 4 && byte > 7) this.fail(start, `${field}: invalid length prefix`, field);
      length += (byte & 127) * 2 ** (7 * index);
      if ((byte & 128) === 0) break;
    }
    if (length > cap) this.fail(start, `${field}: string exceeds safety limit`, field);
    if (length > this.end - this.offset) this.fail(start, `${field}: overruns section`, field);
    const payload = this.offset;
    this.skip(length);
    return this.utf8(payload, length, field, start);
  }

  /** Strict UTF-8 without Node/DOM dependencies; preserve BOM and NUL as data. */
  private utf8(start: number, length: number, field: string, prefix: number): string {
    const chunks: string[] = [];
    const points: number[] = [];
    const end = start + length;
    for (let cursor = start; cursor < end;) {
      const first = this.reader.readUint8(cursor++);
      let point = first;
      let continuation = 0;
      let minimum = 0;
      if (first >= 0xc2 && first <= 0xdf) {
        point = first & 31; continuation = 1; minimum = 0x80;
      } else if (first >= 0xe0 && first <= 0xef) {
        point = first & 15; continuation = 2; minimum = 0x800;
      } else if (first >= 0xf0 && first <= 0xf4) {
        point = first & 7; continuation = 3; minimum = 0x10000;
      } else if (first > 0x7f) {
        this.fail(prefix, `${field}: invalid UTF-8`, field);
      }
      if (cursor + continuation > end) this.fail(prefix, `${field}: invalid UTF-8`, field);
      for (let index = 0; index < continuation; index++) {
        const byte = this.reader.readUint8(cursor++);
        if ((byte & 0xc0) !== 0x80) this.fail(prefix, `${field}: invalid UTF-8`, field);
        point = point * 64 + (byte & 63);
      }
      if (point < minimum || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
        this.fail(prefix, `${field}: invalid UTF-8`, field);
      }
      points.push(point);
      if (points.length === 1024) {
        chunks.push(String.fromCodePoint(...points));
        points.length = 0;
      }
    }
    chunks.push(String.fromCodePoint(...points));
    return chunks.join("");
  }

  guid(): string {
    const start = this.offset;
    this.skip(16);
    return Array.from(this.bytes.subarray(start, this.offset), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  list(field: string, countSize: number, elementSize: number, strings = false): void {
    const start = this.offset;
    const count = this.int(countSize);
    // For strings, even an empty value requires one prefix byte.
    if (count < 0 || count > Math.floor((this.end - this.offset) / elementSize)) {
      this.fail(start, `${field}: list does not fit in section`, field);
    }
    if (strings) {
      for (let index = 0; index < count; index++) this.string(field);
    } else {
      this.skip(count * elementSize);
    }
  }

  dimension(field: string): number {
    const start = this.offset;
    const value = this.int();
    if (value <= 0) this.fail(start, `${field}: must be positive`, field);
    // Implementation safety limit, independent of vanilla preset sizes.
    if (value > 65536) this.fail(start, `${field}: exceeds safety limit`, field);
    return value;
  }

  finish(): void {
    if (this.offset !== this.end) this.fail(this.offset, "unread bytes");
  }
}

/** Walks the admitted format's metadata profile, bounded by pointer[1]. */
export function readWorldMetadata(bytes: Uint8Array): WorldMetadataResult {
  const world = readWorldHeader(bytes);
  const { metadata: features } = requireWorldFormat(world.header.version);
  const reader = new MetadataReader(bytes, world.sections.metadata.start, world.sections.metadata.end);
  const name = reader.string("name", 4096);
  const seed = reader.string("seed", 4096);
  // Consume UInt64/Int64 as eight raw bytes, never through a lossy JS number.
  reader.skip(8); // world-gen version (row 3)
  const guid = reader.guid();
  const worldId = reader.int();
  const bounds: WorldBounds = { left: reader.int(), right: reader.int(), top: reader.int(), bottom: reader.int() };
  const height = reader.dimension("height");
  const widthOffset = reader.offset;
  const width = reader.dimension("width");
  // Each column needs a record byte. Side limits above keep this product exact
  // in JS number arithmetic (no 32-bit bitwise multiplication or byte sizing).
  if (width > world.sections.tiles.end - world.sections.tiles.start || width * height > 2 ** 28) {
    reader.fail(widthOffset, "width: tile section too short or dimensions exceed safety limit", "width");
  }
  const rawMode = reader.int();
  const modes = ["classic", "expert", "master", "journey"] as const;
  const mode: WorldMode = modes[rawMode] ?? { mode: "unknown", raw: rawMode };
  reader.bools(features.skyblockSeed ? 9 : 8); // special seeds (row 13)
  reader.skip(8); // creation time (row 14)
  if (features.lastPlayed) reader.skip(8); // row 15
  reader.skip(1 + 17 * 4 + 2 * 4); // moon, backgrounds, spawn (16–18)
  const surfaceLevel = reader.level("surfaceLevel");
  const rockLevel = reader.level("rockLevel");
  reader.skip(8); // time (19)
  reader.bool(); reader.skip(4); reader.bools(2); // day, phase, blood moon, eclipse (20)
  reader.skip(8); // dungeon coordinates (21)
  const evil = reader.bool() ? "crimson" : "corruption";
  reader.bools(18); // bosses, NPCs and invasions (23–25)
  reader.bools(2); reader.skip(1 + 4); reader.bools(2); // orb, meteor, altar, hardmode, doom (26–27)
  reader.skip(3 * 4 + 2 * 8 + 1); // invasion, slime rain and sundial (28–30)
  reader.bool(); reader.skip(4 + 4 + 3 * 4 + 8 + 4 + 2 + 4); // rain, ores, backgrounds, clouds/wind (31)
  reader.list("anglerFinishers", 4, 1, true); // 32
  reader.bool(); reader.skip(4); reader.bools(3); reader.skip(8); // NPCs, quest, invasion/cultist (33)
  reader.list("killCounts", 2, 4); // 34
  if (features.claimableBanners) reader.list("claimableBanners", 2, 2); // 35
  reader.bools(19); // fast-forward, bosses, pillars/apocalypse (36–38)
  reader.bools(2); reader.skip(4); reader.list("partyingNpcs", 4, 4); // party (39)
  reader.bool(); reader.skip(12); // sandstorm (40)
  reader.bools(4); reader.skip(5); reader.bool(); // bartender/army, backgrounds, combat book (41–43)
  reader.skip(4); reader.bools(3); // lantern night (44)
  reader.list("treeTopVariations", 4, 4); // 45
  reader.bools(2); reader.skip(16); reader.bools(3); // holidays, ores, pets (46–48)
  reader.bools(12); reader.bools(9); // bosses, NPC unlocks, book II, satchel, slimes (49–50)
  reader.bool(); reader.skip(1); // dusk and moondial (51)
  if (features.permanentHolidays) reader.bools(2); // 52
  if (features.vampireSeed) reader.bool(); // 53
  if (features.infectedSeed) reader.bool(); // 53
  if (features.eventCounts) reader.skip(8); // 54
  if (features.teamSpawns) { reader.bool(); reader.list("teamSpawns", 1, 4); } // 55
  if (features.dualDungeonsSeed) reader.bool(); // 56
  if (features.lightningSeeds) reader.bools(2); // 57; deprecated row 58 absent in admitted versions
  if (features.worldGenManifest) reader.string("worldGenManifest"); // 59
  reader.finish();
  return { ...world, metadata: { name, seed, guid, worldId, bounds, width, height, mode, evil, surfaceLevel, rockLevel } };
}
