/** Why an XNB texture was rejected (docs/assets.md, "XNB container" and "LZX as used in XNB"). */
export type XnbErrorKind =
  | "Truncated"
  | "NotAnXnb"
  | "UnsupportedPlatform"
  | "UnsupportedVersion"
  | "UnsupportedFlags"
  | "SizeMismatch"
  | "TooLarge"
  | "MalformedLzx"
  | "UnsupportedReader"
  | "UnsupportedSurfaceFormat"
  | "MalformedContent";

/** An XNB file violates the format contract or exceeds a size cap. */
export class XnbFormatError extends Error {
  /** Error category. */
  readonly kind: XnbErrorKind;
  /**
   * Offset of the offending field. File-level and LZX errors use offsets from the start of the supplied view
   * (an LZX error names the start of the chunk being decoded); errors in the texture payload use offsets from
   * the start of the decompressed payload.
   */
  readonly offset: number;
  /** Human-readable diagnostic. */
  readonly reason: string;

  constructor(kind: XnbErrorKind, offset: number, reason: string) {
    super(`${kind} at offset ${String(offset)}: ${reason}`);
    this.name = "XnbFormatError";
    this.kind = kind;
    this.offset = offset;
    this.reason = reason;
  }
}
