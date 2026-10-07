/** Why a world file was rejected (docs/file-format.md, "Check order"). */
export type WorldFormatErrorKind =
  | "Truncated"
  | "UnsupportedVersion"
  | "NotAWorld"
  | "MalformedSectionTable"
  | "MalformedMetadata"
  | "MalformedTiles";

/** A world file violates the format contract. */
export class WorldFormatError extends Error {
  /** Error category. */
  readonly kind: WorldFormatErrorKind;
  /** Absolute byte offset, relative to the start of the supplied view, of the offending field or the end of data. */
  readonly offset: number;
  /** Human-readable diagnostic. */
  readonly reason: string;
  /** Tile column of the offending record, for `MalformedTiles`. */
  readonly x?: number;
  /** Tile row of the offending record, for `MalformedTiles`. */
  readonly y?: number;

  constructor(kind: WorldFormatErrorKind, offset: number, reason: string, tile?: { readonly x: number; readonly y: number }) {
    super(`${kind} at offset ${String(offset)}: ${reason}`);
    this.name = "WorldFormatError";
    this.kind = kind;
    this.offset = offset;
    this.reason = reason;
    if (tile !== undefined) {
      this.x = tile.x;
      this.y = tile.y;
    }
  }
}
