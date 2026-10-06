// RED-phase stubs: the parameters are used once implemented (remove this directive in GREEN).
/* eslint-disable @typescript-eslint/no-unused-vars */
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

/**
 * Reads and validates the file header, section table and frame-important bits of a format-326 world.
 * Offsets in errors and results are relative to the start of `bytes`; nothing outside the view is read.
 * @throws WorldFormatError when the header violates the contract (docs/file-format.md, "Check order").
 */
export function readWorldHeader(_bytes: Uint8Array): WorldHeader {
  throw new Error("not implemented");
}

/** Whether tile type `tileId` stores frame coordinates; ids outside `0 … k-1` are not frame-important. */
export function isFrameImportant(_sections: WorldSectionTable, _tileId: number): boolean {
  throw new Error("not implemented");
}
