import { XnbFormatError } from "./xnb-error.js";
import type { HuffmanTable } from "./lzx-huffman.js";

/**
 * Bit reader over the compressed bytes of one LZX chunk: 16-bit little-endian words, bits taken most significant
 * first (docs/assets.md, "Bitstream"). Past the end of the chunk it supplies zero bits; {@link overran} tells whether
 * any of them were actually consumed.
 */
export class LzxBitReader {
  /** Offset (in the supplied view) of the next unread byte; the bit buffer holds whole words already taken. */
  pos: number;
  private bitBuffer = 0;
  private bitCount = 0;
  private readonly data: Uint8Array;
  private readonly end: number;
  private readonly chunkStart: number;

  constructor(data: Uint8Array, start: number, end: number, chunkStart: number) {
    this.data = data;
    this.pos = start;
    this.end = end;
    this.chunkStart = chunkStart;
  }

  private ensure(count: number): void {
    while (this.bitCount < count) {
      const word = this.pos < this.end ? (this.data[this.pos] ?? 0) | ((this.pos + 1 < this.end ? (this.data[this.pos + 1] ?? 0) : 0) << 8) : 0;
      this.bitBuffer = (this.bitBuffer << 16) | word;
      this.bitCount += 16;
      this.pos += 2;
    }
  }

  private consume(count: number): void {
    this.bitCount -= count;
    this.bitBuffer &= (1 << this.bitCount) - 1;
  }

  /** Reads `count` (0–16) bits, first bit most significant. */
  readBits(count: number): number {
    if (count === 0) return 0;
    this.ensure(count);
    const value = this.bitBuffer >>> (this.bitCount - count);
    this.consume(count);
    return value;
  }

  /** Decodes one symbol; -1 when the table has no code for the upcoming bits. */
  readSymbol(table: HuffmanTable): number {
    this.ensure(16);
    const window = (this.bitBuffer >>> (this.bitCount - 16)) & 0xffff;
    const length = table.lengthAt(window);
    if (length === 0) return -1;
    this.consume(length);
    return table.symbolAt(window);
  }

  /** Drops the bits up to the next 16-bit word boundary; a header ending exactly on one still drops a whole word. */
  alignToWord(): void {
    if (this.bitCount === 0) this.pos += 2;
    this.bitBuffer = 0;
    this.bitCount = 0;
  }

  /** Reads a little-endian UInt32 straight from the bytes; the reader must be word aligned. */
  readRawUint32(): number {
    const bytes = this.takeRaw(4);
    return ((bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8) | ((bytes[2] ?? 0) << 16) | ((bytes[3] ?? 0) << 24)) >>> 0;
  }

  /** Takes `count` raw bytes; the reader must be word aligned. */
  takeRaw(count: number): Uint8Array {
    if (this.pos + count > this.end) {
      throw new XnbFormatError("Truncated", this.chunkStart, "the LZX chunk ends inside an uncompressed block");
    }
    const bytes = this.data.subarray(this.pos, this.pos + count);
    this.pos += count;
    return bytes;
  }

  /** Skips the padding byte after an odd-length uncompressed block (absent at the end of the chunk). */
  skipPadding(): void {
    if (this.pos < this.end) this.pos++;
  }

  /** True when bits beyond the end of the chunk have been consumed. */
  overran(): boolean {
    return this.pos * 8 - this.bitCount > this.end * 8;
  }
}
