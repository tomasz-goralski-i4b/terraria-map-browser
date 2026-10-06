import { WorldFormatError } from "./world-format-error.js";

/**
 * Little-endian reads at absolute offsets inside one Uint8Array view (docs/file-format.md, "Primitive types").
 * Offsets are relative to the start of the view, never to its underlying buffer. Reading past the end of the view
 * throws a `Truncated` WorldFormatError at the view length.
 */
export class ByteReader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** Number of bytes in the supplied view. */
  get length(): number {
    return this.bytes.length;
  }

  readUint8(offset: number): number {
    this.require(offset, 1);
    return this.view.getUint8(offset);
  }

  readInt16(offset: number): number {
    this.require(offset, 2);
    return this.view.getInt16(offset, true);
  }

  readInt32(offset: number): number {
    this.require(offset, 4);
    return this.view.getInt32(offset, true);
  }

  readUint32(offset: number): number {
    this.require(offset, 4);
    return this.view.getUint32(offset, true);
  }

  readUint64(offset: number): bigint {
    this.require(offset, 8);
    return this.view.getBigUint64(offset, true);
  }

  /** A copy of `length` bytes starting at `offset`. */
  readBytes(offset: number, length: number): Uint8Array {
    this.require(offset, length);
    return this.bytes.slice(offset, offset + length);
  }

  private require(offset: number, size: number): void {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(size) || size < 0) {
      throw new RangeError(`invalid read of ${String(size)} bytes at offset ${String(offset)}`);
    }
    if (offset + size > this.bytes.length) {
      throw new WorldFormatError("Truncated", this.bytes.length, "unexpected end of data");
    }
  }
}
