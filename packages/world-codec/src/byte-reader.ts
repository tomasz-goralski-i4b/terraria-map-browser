// RED-phase stubs: the parameters are used once implemented (remove this directive in GREEN).
/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Little-endian reads at absolute offsets inside one Uint8Array view (docs/file-format.md, "Primitive types").
 * Offsets are relative to the start of the view, never to its underlying buffer. Reading past the end of the view
 * throws a `Truncated` WorldFormatError at the view length.
 */
export class ByteReader {
  constructor(_bytes: Uint8Array) {
    throw new Error("not implemented");
  }

  /** Number of bytes in the supplied view. */
  get length(): number {
    throw new Error("not implemented");
  }

  readUint8(_offset: number): number {
    throw new Error("not implemented");
  }

  readInt16(_offset: number): number {
    throw new Error("not implemented");
  }

  readInt32(_offset: number): number {
    throw new Error("not implemented");
  }

  readUint32(_offset: number): number {
    throw new Error("not implemented");
  }

  readUint64(_offset: number): bigint {
    throw new Error("not implemented");
  }

  /** A copy of `length` bytes starting at `offset`. */
  readBytes(_offset: number, _length: number): Uint8Array {
    throw new Error("not implemented");
  }
}
