import { ByteReader } from "./byte-reader.js";
import { WorldFormatError } from "./world-format-error.js";

/** The fixed part of a `.wld` file header, up to the section table (docs/file-format.md, "File header"). */
export interface WorldFileHeader {
  /** Format version (not the game version). */
  readonly version: number;
  /** ASCII signature; `relogic` for every supported version. */
  readonly signature: string;
  /** File-type byte; always 2 (world) for an accepted header. */
  readonly fileType: number;
  /** Save counter, UInt32. */
  readonly revision: number;
  /** Raw UInt64 header flags, kept as read. */
  readonly flags: bigint;
  /** Bit 0 of `flags`. */
  readonly isFavorite: boolean;
  /** Number of section pointers. */
  readonly sectionCount: number;
}

/** Absolute start and exclusive end offsets of a world section. */
export interface SectionBoundary {
  readonly start: number;
  readonly end: number;
}

/** Validated section table and frame-important bits (docs/file-format.md, "Section table"). */
export interface WorldSectionTable {
  /** The raw section pointers, in file order. */
  readonly pointers: readonly number[];
  readonly fileHeader: SectionBoundary;
  readonly metadata: SectionBoundary;
  readonly tiles: SectionBoundary;
  readonly chests: SectionBoundary;
  readonly signs: SectionBoundary;
  readonly npcsAndMobs: SectionBoundary;
  readonly tileEntities: SectionBoundary;
  readonly weightedPressurePlates: SectionBoundary;
  readonly townManager: SectionBoundary;
  readonly bestiary: SectionBoundary;
  readonly creativePowers: SectionBoundary;
  /** From the last pointer to the end of the supplied view. */
  readonly footer: SectionBoundary;
  /** Number of tile types described by the frame-important bits (`k`). */
  readonly frameImportantCount: number;
  /** The packed bits exactly as read (⌈k/8⌉ bytes, LSB first, padding kept). */
  readonly frameImportantBits: Uint8Array;
}

/** A decoded and validated world header with its section table. */
export interface WorldHeader {
  readonly header: WorldFileHeader;
  readonly sections: WorldSectionTable;
}

const SUPPORTED_VERSION = 326;
const SECTION_COUNT = 11;
const TABLE_START = 26;
const FRAME_COUNT_OFFSET = TABLE_START + 4 * SECTION_COUNT;
const FRAME_BITS_OFFSET = FRAME_COUNT_OFFSET + 2;
const MIN_FOOTER_LENGTH = 6;
const MAX_FILE_LENGTH = 0x80000000;

function truncatedError(reader: ByteReader): WorldFormatError {
  return new WorldFormatError("Truncated", reader.length, `file ends after ${String(reader.length)} bytes of the 26-byte header`);
}

function readFixedFields(reader: ByteReader): WorldFileHeader {
  if (reader.length < 4) {
    throw truncatedError(reader);
  }
  const version = reader.readInt32(0);
  if (version !== SUPPORTED_VERSION) {
    throw new WorldFormatError("UnsupportedVersion", 0, `format version ${String(version)} is not supported`);
  }
  if (reader.length < TABLE_START) {
    throw truncatedError(reader);
  }
  const signature = String.fromCharCode(...reader.readBytes(4, 7));
  if (signature === "xindong") {
    throw new WorldFormatError("NotAWorld", 4, "unsupported variant");
  }
  if (signature !== "relogic") {
    throw new WorldFormatError("NotAWorld", 4, "invalid signature");
  }
  const fileType = reader.readUint8(11);
  if (fileType !== 2) {
    throw new WorldFormatError("NotAWorld", 11, `file type ${String(fileType)} is not a world`);
  }
  const sectionCount = reader.readInt16(24);
  if (sectionCount !== SECTION_COUNT) {
    throw new WorldFormatError(
      "MalformedSectionTable",
      24,
      `expected ${String(SECTION_COUNT)} sections, found ${String(sectionCount)}`,
    );
  }
  const flags = reader.readUint64(16);
  return {
    version,
    signature,
    fileType,
    revision: reader.readUint32(12),
    flags,
    isFavorite: (flags & 1n) === 1n,
    sectionCount,
  };
}

function readPointers(reader: ByteReader, headerEnd: number): number[] {
  const fileLength = reader.length;
  const pointers: number[] = [];
  for (let index = 0; index < SECTION_COUNT; index++) {
    const slot = TABLE_START + 4 * index;
    const pointer = reader.readInt32(slot);
    const previous = pointers[index - 1] ?? 0;
    if (pointer > fileLength) {
      throw new WorldFormatError("MalformedSectionTable", slot, "beyond end of file");
    }
    if (index === 0 && pointer !== headerEnd) {
      throw new WorldFormatError("MalformedSectionTable", slot, "section pointer must match the header end");
    }
    if (index === 1 && pointer < previous) {
      throw new WorldFormatError("MalformedSectionTable", slot, "section pointer is before metadata start");
    }
    if (index > 1 && pointer <= previous) {
      throw new WorldFormatError("MalformedSectionTable", slot, "not greater than previous");
    }
    if (index === SECTION_COUNT - 1 && pointer + MIN_FOOTER_LENGTH > fileLength) {
      throw new WorldFormatError("MalformedSectionTable", slot, "footer requires at least six bytes");
    }
    pointers.push(pointer);
  }
  return pointers;
}

/**
 * Reads and validates the file header, section table and frame-important bits of a format-326 world.
 * Offsets in errors and results are relative to the start of `bytes`; nothing outside the view is read.
 * @throws WorldFormatError when the header violates the contract (docs/file-format.md, "Check order").
 */
export function readWorldHeader(bytes: Uint8Array): WorldHeader {
  const reader = new ByteReader(bytes);
  const header = readFixedFields(reader);
  if (reader.length >= MAX_FILE_LENGTH) {
    throw new WorldFormatError("MalformedSectionTable", TABLE_START, "file must be smaller than 2 GiB");
  }
  if (reader.length < FRAME_BITS_OFFSET) {
    throw truncatedError(reader);
  }
  const frameImportantCount = reader.readInt16(FRAME_COUNT_OFFSET);
  if (frameImportantCount < 0) {
    throw new WorldFormatError("MalformedSectionTable", FRAME_COUNT_OFFSET, "negative frame-important count");
  }
  const frameBytes = Math.ceil(frameImportantCount / 8);
  const headerEnd = FRAME_BITS_OFFSET + frameBytes;
  if (reader.length < headerEnd) {
    throw truncatedError(reader);
  }
  const frameImportantBits = reader.readBytes(FRAME_BITS_OFFSET, frameBytes);
  const pointers = readPointers(reader, headerEnd);
  const sectionStarts = [0, ...pointers, reader.length];
  const makeBoundary = (index: number): SectionBoundary => ({
    start: sectionStarts[index] ?? 0,
    end: sectionStarts[index + 1] ?? 0,
  });
  return {
    header,
    sections: {
      pointers,
      fileHeader: makeBoundary(0),
      metadata: makeBoundary(1),
      tiles: makeBoundary(2),
      chests: makeBoundary(3),
      signs: makeBoundary(4),
      npcsAndMobs: makeBoundary(5),
      tileEntities: makeBoundary(6),
      weightedPressurePlates: makeBoundary(7),
      townManager: makeBoundary(8),
      bestiary: makeBoundary(9),
      creativePowers: makeBoundary(10),
      footer: makeBoundary(11),
      frameImportantCount,
      frameImportantBits,
    },
  };
}

/** Whether tile type `tileId` stores frame coordinates; ids outside `0 … k-1` are not frame-important. */
export function isFrameImportant(sections: WorldSectionTable, tileId: number): boolean {
  if (!Number.isInteger(tileId) || tileId < 0 || tileId >= sections.frameImportantCount) {
    return false;
  }
  const packed = sections.frameImportantBits[tileId >> 3] ?? 0;
  return ((packed >> (tileId & 7)) & 1) === 1;
}
