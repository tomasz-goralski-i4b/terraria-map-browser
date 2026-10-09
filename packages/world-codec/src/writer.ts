import { isFrameImportant, type SectionBoundary } from "./header.js";
import { readWorldMetadata } from "./metadata.js";
import { readWorldEntities } from "./entities.js";
import { OPAQUE_SECTION_NAMES, type WorldEnvelope } from "./envelope.js";
import { WorldFormatError } from "./world-format-error.js";
import type { TilePlanes, WorldTilesResult } from "./tiles.js";

type TileInput = Pick<WorldTilesResult, "metadata" | "sections" | "planes" | "palette">;
type WorldWriteInput = Omit<WorldTilesResult, "envelope"> & { readonly envelope?: WorldEnvelope };
const NO_CONTENT = 0xffff;
const MAX_FILE_LENGTH = 0x80000000;
const PLANE_TYPES = {
  block: Uint16Array, wall: Uint16Array, frameX: Int16Array, frameY: Int16Array,
  paint: Uint8Array, wallPaint: Uint8Array, liquid: Uint8Array, liquidAmount: Uint8Array,
  shape: Uint8Array, flags: Uint16Array,
} as const;
const PLANE_NAMES = Object.keys(PLANE_TYPES) as (keyof TilePlanes)[];

function unsupported(reason: string, offset = 0): never {
  throw new WorldFormatError("UnsupportedWrite", offset, reason);
}

/** Small decoded records only; never used to compare a tile grid or source buffer. */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.hasOwn(right, key) &&
    sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

function validatePlanes(world: TileInput): void {
  const { width, height } = world.metadata;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
    width > 65536 || height > 65536 || width * height > 2 ** 28) unsupported("unsupported dimensions");
  if (Object.keys(world.planes).length !== PLANE_NAMES.length) unsupported("expected ten CWM planes");
  for (const name of PLANE_NAMES) {
    const plane = world.planes[name];
    if (!(plane instanceof PLANE_TYPES[name]) || plane.length !== width * height) unsupported(`invalid ${name} plane type or length`);
  }
}

/** Two direct-plane passes: measure and validate, then fill an exactly sized byte array. */
class TileEncoder {
  private readonly world: TileInput;
  private readonly ids: Int32Array;
  private output: Uint8Array | undefined;
  private position = 0;
  private tile = 0;

  constructor(world: TileInput) {
    validatePlanes(world);
    this.world = world;
    if (world.palette.length > NO_CONTENT) unsupported("palette exceeds 65535 entries");
    this.ids = new Int32Array(world.palette.length);
    world.palette.forEach((ref, index) => {
      if (ref.kind !== "vanilla" || !Number.isInteger(ref.id) || ref.id < 0 || ref.id > 65535) unsupported("only vanilla content references can be written");
      this.ids[index] = ref.id;
    });
  }

  encode(maxLength: number): Uint8Array {
    this.columns();
    if (this.position > maxLength) unsupported("file too large");
    this.output = new Uint8Array(this.position);
    this.position = 0;
    this.columns();
    return this.output;
  }

  private fail(reason: string): never {
    const height = this.world.metadata.height;
    throw new WorldFormatError("UnencodableTile", 0, reason, { x: Math.floor(this.tile / height), y: this.tile % height });
  }

  private content(value: number): number {
    if (value === NO_CONTENT) return -1;
    const id = this.ids[value];
    if (id === undefined) this.fail("missing palette entry");
    return id;
  }

  private equal(first: number, next: number): boolean {
    const { planes } = this.world;
    if (this.content(planes.block[first] ?? NO_CONTENT) !== this.content(planes.block[next] ?? NO_CONTENT) ||
      this.content(planes.wall[first] ?? NO_CONTENT) !== this.content(planes.wall[next] ?? NO_CONTENT)) return false;
    return planes.frameX[first] === planes.frameX[next] && planes.frameY[first] === planes.frameY[next] &&
      planes.paint[first] === planes.paint[next] && planes.wallPaint[first] === planes.wallPaint[next] &&
      planes.liquid[first] === planes.liquid[next] && planes.liquidAmount[first] === planes.liquidAmount[next] &&
      planes.shape[first] === planes.shape[next] && planes.flags[first] === planes.flags[next];
  }

  private u8(value: number): void {
    if (this.output !== undefined) this.output[this.position] = value;
    this.position++;
  }
  private i16(value: number): void { this.u8(value & 255); this.u8((value >> 8) & 255); }

  private columns(): void {
    const { width, height } = this.world.metadata;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height;) {
        this.tile = x * height + y;
        const block = this.content(this.world.planes.block[this.tile] ?? NO_CONTENT);
        let run = 0;
        if (block !== 520 && block !== 423) {
          const limit = Math.min(height - y - 1, 32767);
          while (run < limit) {
            // Invalid palette indices in a neighbour must report that neighbour's coordinate.
            this.tile = x * height + y + run + 1;
            if (!this.equal(x * height + y, this.tile)) break;
            run++;
          }
        }
        this.tile = x * height + y;
        this.record(block, run);
        y += run + 1;
      }
    }
  }

  private record(block: number, run: number): void {
    const { planes, sections } = this.world;
    const index = this.tile;
    const wall = this.content(planes.wall[index] ?? NO_CONTENT);
    const frameX = planes.frameX[index] ?? -1;
    const frameY = planes.frameY[index] ?? -1;
    const paint = planes.paint[index] ?? 0;
    const wallPaint = planes.wallPaint[index] ?? 0;
    const liquid = planes.liquid[index] ?? 0;
    const amount = planes.liquidAmount[index] ?? 0;
    const shape = planes.shape[index] ?? 0;
    const flags = planes.flags[index] ?? 0;
    const framed = block >= 0 && isFrameImportant(sections, block);
    if (block > 753 || block >= sections.frameImportantCount) this.fail("no supported frame-important entry for block");
    if (wall === 0 || wall > 366) this.fail("unsupported wall id");
    if (!framed && (frameX !== -1 || frameY !== -1)) this.fail("frames without a frame-important block");
    if ((block < 0 && paint !== 0) || (wall < 0 && wallPaint !== 0)) this.fail("paint without owner");
    if (liquid > 4 || (liquid === 0 && amount !== 0)) this.fail("unsupported liquid kind or unowned amount");
    if (shape > 5 || flags > 0x3ff) this.fail("undefined shape or reserved flags");
    let flag1 = (block >= 0 ? 2 : 0) | (wall >= 0 ? 4 : 0) | ((liquid === 4 ? 1 : liquid) << 3) |
      (block >= 256 ? 32 : 0) | (run === 0 ? 0 : run <= 255 ? 64 : 128);
    let flag2 = ((flags & 7) << 1) | (shape << 4);
    let flag3 = ((flags & 8) << 2) | ((flags & 16) >> 3) | ((flags & 32) >> 3) |
      (paint !== 0 ? 8 : 0) | (wallPaint !== 0 ? 16 : 0) | (wall >= 256 ? 64 : 0) | (liquid === 4 ? 128 : 0);
    const flag4 = (flags >> 5) & 0x1e;
    if (flag4 !== 0) flag3 |= 1;
    if (flag3 !== 0) flag2 |= 1;
    if (flag2 !== 0) flag1 |= 1;
    this.u8(flag1);
    if (flag2 !== 0) this.u8(flag2);
    if (flag3 !== 0) this.u8(flag3);
    if (flag4 !== 0) this.u8(flag4);
    if (block >= 0) {
      if (block < 256) this.u8(block); else this.i16(block);
      if (framed) { this.i16(frameX); this.i16(frameY); }
      if (paint !== 0) this.u8(paint);
    }
    if (wall >= 0) { this.u8(wall & 255); if (wallPaint !== 0) this.u8(wallPaint); }
    if (liquid !== 0) this.u8(amount);
    if (wall >= 256) this.u8(wall >> 8);
    if (run > 0) { if (run <= 255) this.u8(run); else this.i16(run); }
  }
}

/** Canonical format-326 tile bytes from CWM planes, without allocating per-tile objects. */
export function writeWorldTiles(world: TileInput): Uint8Array {
  return new TileEncoder(world).encode(MAX_FILE_LENGTH - 1);
}

function validateEnvelope(world: WorldWriteInput): asserts world is WorldTilesResult {
  const envelope = world.envelope;
  if (envelope === undefined || !(envelope.source instanceof Uint8Array) || envelope.source.length === 0) unsupported("a preserved source envelope is required");
  if (world.header.version !== 326 || envelope.original.header.version !== 326) unsupported("only format 326 can be written");
  let source;
  try { source = readWorldMetadata(envelope.source); }
  catch (error) {
    if (!(error instanceof WorldFormatError)) throw error;
    unsupported(`invalid preserved source: ${error.reason}`, error.offset);
  }
  if (source.header.version !== 326 || !sameValue(source.header, world.header) || !sameValue(source.header, envelope.original.header) ||
    !sameValue(source.metadata, world.metadata) || !sameValue(source.metadata, envelope.original.metadata) ||
    !sameValue(source.details, world.details) || !sameValue(source.details, envelope.original.details)) {
    unsupported("metadata, dimensions and header must match the preserved source");
  }
  if (!sameValue(source.sections, world.sections) || !sameValue(source.sections.pointers, envelope.original.sectionPointers) ||
    source.sections.frameImportantCount !== envelope.original.frameImportantCount ||
    !sameValue(Array.from(source.sections.frameImportantBits), envelope.original.frameImportantBits)) {
    unsupported("section table and frame-important data must match the preserved source");
  }
  const checkSpan = (bytes: Uint8Array, boundary: SectionBoundary): void => {
    if (!(bytes instanceof Uint8Array) || bytes.buffer !== envelope.source.buffer ||
      bytes.byteOffset !== envelope.source.byteOffset + boundary.start || bytes.length !== boundary.end - boundary.start) {
      unsupported("envelope view does not match its source boundary", boundary.start);
    }
  };
  for (const name of ["fileHeader", "metadata", "tiles", "footer"] as const) checkSpan(envelope[name], source.sections[name]);
  checkSpan(envelope.frameImportantBits, { start: 72, end: source.sections.fileHeader.end });
  if (envelope.opaqueSections.length !== OPAQUE_SECTION_NAMES.length) unsupported("expected eight opaque sections");
  OPAQUE_SECTION_NAMES.forEach((name, index) => {
    const section = envelope.opaqueSections[index];
    if (section?.name !== name || !sameValue(section.boundary, source.sections[name])) unsupported("opaque sections must keep their original order and boundaries");
    checkSpan(section.bytes, source.sections[name]);
  });
  if (!sameValue(world.entities, readWorldEntities(envelope.source, source))) unsupported("entity editing is unsupported");
  if (world.palette.some((ref) => ref.kind !== "vanilla" || !Number.isInteger(ref.id) || ref.id < 0 || ref.id > 753)) {
    unsupported("unknown, modded or out-of-range content references cannot be written");
  }
}

function validateFooter(world: WorldTilesResult): void {
  const { source } = world.envelope;
  const { start, end } = world.sections.footer;
  const fail = (offset: number, reason: string): never => { throw new WorldFormatError("MalformedFooter", offset, reason); };
  if (end - start < 6) fail(start, "truncated");
  const prefix = start + 1;
  let cursor = prefix;
  let length = 0;
  let invalid = false;
  for (let index = 0; index < 5; index++) {
    if (cursor >= end - 4) fail(prefix, "truncated");
    const byte = source[cursor++] ?? 0;
    if (index === 4 && byte > 7) { invalid = true; break; }
    length += (byte & 127) * 2 ** (7 * index);
    if ((byte & 128) === 0) break;
  }
  if (!invalid && length > end - 4 - cursor) fail(prefix, "truncated");
  if (source[start] !== 1) fail(start, "invalid marker");
  if (invalid) fail(prefix, "invalid name");
  const nameBytes = source.subarray(cursor, cursor + length);
  try { new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(nameBytes); }
  catch { fail(prefix, "invalid name"); }
  const metadataName = new TextEncoder().encode(world.metadata.name);
  if (nameBytes.length !== metadataName.length || nameBytes.some((byte, index) => byte !== metadataName[index])) {
    throw new WorldFormatError("InconsistentFooter", prefix, "name differs from metadata", { field: "name" });
  }
  const idOffset = cursor + length;
  if (new DataView(source.buffer, source.byteOffset + idOffset, 4).getInt32(0, true) !== world.metadata.worldId) {
    throw new WorldFormatError("InconsistentFooter", idOffset, "world id differs from metadata", { field: "worldId" });
  }
  if (idOffset + 4 !== end) fail(idOffset + 4, "trailing bytes");
}

/** Fresh `.wld` output; original metadata, entities and source bytes must remain unchanged. Never overwrites a path. */
export function writeWorld(world: WorldWriteInput): ArrayBuffer {
  validateEnvelope(world);
  validateFooter(world);
  const { envelope, sections } = world;
  const unchangedLength = envelope.source.length - envelope.tiles.length;
  const tiles = new TileEncoder(world).encode(MAX_FILE_LENGTH - 1 - unchangedLength);
  const delta = tiles.length - envelope.tiles.length;
  const output = new Uint8Array(unchangedLength + tiles.length);
  output.set(envelope.source.subarray(0, sections.tiles.start));
  output.set(tiles, sections.tiles.start);
  output.set(envelope.source.subarray(sections.tiles.end), sections.tiles.start + tiles.length);
  const view = new DataView(output.buffer);
  sections.pointers.forEach((pointer, index) => { view.setInt32(26 + index * 4, pointer + (index < 2 ? 0 : delta), true); });
  return output.buffer;
}
