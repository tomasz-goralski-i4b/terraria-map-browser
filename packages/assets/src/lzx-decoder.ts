import { LzxBitReader } from "./lzx-bit-reader.js";
import { HuffmanTable } from "./lzx-huffman.js";
import { XnbFormatError } from "./xnb-error.js";

// LZX as used in XNB files (docs/assets.md, "LZX as used in XNB"): 64 KiB window, 32 KiB frames, no Intel E8.
const FRAME_SIZE = 32768;
const WINDOW_SIZE = 65536;
const MAIN_SYMBOLS = 512;
const LENGTH_SYMBOLS = 249;
const ALIGNED_SYMBOLS = 8;
const PRETREE_SYMBOLS = 20;
const LITERALS = 256;
const SLOTS = 32;

const BLOCK_VERBATIM = 1;
const BLOCK_ALIGNED = 2;
const BLOCK_UNCOMPRESSED = 3;

/** Extra offset bits and base offset of every position slot (docs/assets.md, "Symbols"). */
const EXTRA_BITS: readonly number[] = Array.from({ length: SLOTS }, (_, slot) => (slot < 4 ? 0 : Math.min(17, (slot - 2) >> 1)));
const POSITION_BASE: readonly number[] = (() => {
  const bases: number[] = [];
  let base = 0;
  for (let slot = 0; slot < SLOTS; slot++) {
    bases.push(base);
    base += 1 << (EXTRA_BITS[slot] ?? 0);
  }
  return bases;
})();

/** Decoder state that carries over from chunk to chunk. */
class LzxDecoder {
  private started = false;
  private blockType = 0;
  private blockLength = 0;
  private blockRemaining = 0;
  private r0 = 1;
  private r1 = 1;
  private r2 = 1;
  private chunkStart = 0;
  private readonly mainLengths = new Uint8Array(MAIN_SYMBOLS);
  private readonly lengthLengths = new Uint8Array(LENGTH_SYMBOLS);
  private readonly mainTable = new HuffmanTable();
  private readonly lengthTable = new HuffmanTable();
  private readonly alignedTable = new HuffmanTable();
  private readonly pretreeTable = new HuffmanTable();

  private malformed(reason: string): XnbFormatError {
    return new XnbFormatError("MalformedLzx", this.chunkStart, reason);
  }

  /** Decodes one frame of `frameSize` bytes into `out` starting at `outStart`. */
  decodeFrame(reader: LzxBitReader, chunkStart: number, out: Uint8Array, outStart: number, frameSize: number): void {
    this.chunkStart = chunkStart;
    if (!this.started) {
      if (reader.readBits(1) !== 0) throw this.malformed("the Intel E8 translation is not supported");
      this.started = true;
    }
    const frameEnd = outStart + frameSize;
    let outPos = outStart;
    while (outPos < frameEnd) {
      if (this.blockRemaining === 0) this.readBlockHeader(reader);
      const count = Math.min(frameEnd - outPos, this.blockRemaining);
      if (this.blockType === BLOCK_UNCOMPRESSED) {
        out.set(reader.takeRaw(count), outPos);
        outPos += count;
      } else {
        outPos = this.decodeSymbols(reader, out, outPos, outPos + count);
      }
      this.blockRemaining -= count;
      if (this.blockRemaining === 0 && this.blockType === BLOCK_UNCOMPRESSED && (this.blockLength & 1) === 1) {
        reader.skipPadding();
      }
    }
    if (reader.overran()) throw new XnbFormatError("Truncated", chunkStart, "the LZX chunk ends inside a frame");
  }

  private readBlockHeader(reader: LzxBitReader): void {
    const type = reader.readBits(3);
    const length = (reader.readBits(16) << 8) | reader.readBits(8);
    if (type < BLOCK_VERBATIM || type > BLOCK_UNCOMPRESSED) throw this.malformed(`invalid block type ${String(type)}`);
    if (length === 0) throw this.malformed("empty block");
    if (type === BLOCK_UNCOMPRESSED) {
      reader.alignToWord();
      this.r0 = reader.readRawUint32();
      this.r1 = reader.readRawUint32();
      this.r2 = reader.readRawUint32();
    } else {
      if (type === BLOCK_ALIGNED) {
        const alignedLengths = Array.from({ length: ALIGNED_SYMBOLS }, () => reader.readBits(3));
        if (!this.alignedTable.build(alignedLengths)) throw this.malformed("invalid aligned-offset tree");
      }
      this.readTree(reader, this.mainLengths, 0, LITERALS);
      this.readTree(reader, this.mainLengths, LITERALS, MAIN_SYMBOLS);
      this.readTree(reader, this.lengthLengths, 0, LENGTH_SYMBOLS);
      if (!this.mainTable.build(this.mainLengths)) throw this.malformed("invalid main tree");
      if (!this.lengthTable.build(this.lengthLengths)) throw this.malformed("invalid length tree");
    }
    this.blockType = type;
    this.blockLength = length;
    this.blockRemaining = length;
  }

  /** Reads one delta-coded run of code lengths (`lengths[first..last)`), updating them in place. */
  private readTree(reader: LzxBitReader, lengths: Uint8Array, first: number, last: number): void {
    const pretreeLengths = Array.from({ length: PRETREE_SYMBOLS }, () => reader.readBits(4));
    if (!this.pretreeTable.build(pretreeLengths)) throw this.malformed("invalid pretree");
    const nextSymbol = (): number => {
      const symbol = reader.readSymbol(this.pretreeTable);
      if (symbol < 0) throw this.malformed("invalid pretree code");
      return symbol;
    };
    const delta = (old: number, symbol: number): number => (old - symbol + 17) % 17;
    let index = first;
    while (index < last) {
      const symbol = nextSymbol();
      if (symbol <= 16) {
        lengths[index] = delta(lengths[index] ?? 0, symbol);
        index++;
        continue;
      }
      let run: number;
      let value = 0;
      if (symbol === 17) {
        run = 4 + reader.readBits(4);
      } else if (symbol === 18) {
        run = 20 + reader.readBits(5);
      } else {
        run = 4 + reader.readBits(1);
        value = delta(lengths[index] ?? 0, nextSymbol());
      }
      const stop = Math.min(index + run, last);
      lengths.fill(value, index, stop);
      index = stop;
    }
  }

  /** Decodes symbols into `out[outPos..outEnd)`; returns `outEnd`. */
  private decodeSymbols(reader: LzxBitReader, out: Uint8Array, outStart: number, outEnd: number): number {
    let outPos = outStart;
    while (outPos < outEnd) {
      const symbol = reader.readSymbol(this.mainTable);
      if (symbol < 0) throw this.malformed("invalid main tree code");
      if (symbol < LITERALS) {
        out[outPos++] = symbol;
        continue;
      }
      const match = symbol - LITERALS;
      let length = match & 7;
      if (length === 7) {
        const footer = reader.readSymbol(this.lengthTable);
        if (footer < 0) throw this.malformed("invalid length tree code");
        length += footer;
      }
      length += 2;
      const offset = this.readOffset(reader, match >> 3);
      if (length > outEnd - outPos) throw this.malformed("a match runs past the end of its frame or block");
      if (offset < 1 || offset > outPos || offset > WINDOW_SIZE) throw this.malformed("a match reaches before the window");
      for (let i = 0; i < length; i++, outPos++) out[outPos] = out[outPos - offset] ?? 0;
    }
    return outPos;
  }

  /** Resolves a position slot to a match offset and updates the repeated-offset queue. */
  private readOffset(reader: LzxBitReader, slot: number): number {
    let offset: number;
    if (slot === 0) return this.r0;
    if (slot === 1) {
      offset = this.r1;
      this.r1 = this.r0;
    } else if (slot === 2) {
      offset = this.r2;
      this.r2 = this.r0;
    } else {
      const bits = EXTRA_BITS[slot] ?? 0;
      let extra: number;
      if (this.blockType === BLOCK_ALIGNED && bits >= 3) {
        const verbatim = bits > 3 ? reader.readBits(bits - 3) : 0;
        const aligned = reader.readSymbol(this.alignedTable);
        if (aligned < 0) throw this.malformed("invalid aligned-offset code");
        extra = (verbatim << 3) | aligned;
      } else {
        extra = reader.readBits(bits);
      }
      offset = (POSITION_BASE[slot] ?? 0) - 2 + extra;
      this.r2 = this.r1;
      this.r1 = this.r0;
    }
    this.r0 = offset;
    return offset;
  }
}

function truncated(chunkStart: number, reason: string): XnbFormatError {
  return new XnbFormatError("Truncated", chunkStart, reason);
}

/**
 * Decompresses the LZX chunks in `data[start..end)` (the file's bytes after the XNB header) into exactly
 * `decompressedSize` bytes. Offsets in errors are offsets in `data`; an LZX error names the start of its chunk.
 */
export function decompressLzx(data: Uint8Array, start: number, end: number, decompressedSize: number): Uint8Array {
  const out = new Uint8Array(decompressedSize);
  const decoder = new LzxDecoder();
  let pos = start;
  let produced = 0;
  while (pos < end) {
    const first = data[pos] ?? 0;
    let frameSize = FRAME_SIZE;
    let headerSize = 2;
    if (first === 0xff) {
      headerSize = 5;
      if (end - pos < headerSize) throw truncated(pos, "the LZX chunk header is cut short");
      frameSize = ((data[pos + 1] ?? 0) << 8) | (data[pos + 2] ?? 0);
    } else if (end - pos < headerSize) {
      throw truncated(pos, "the LZX chunk header is cut short");
    }
    const blockSize =
      first === 0xff ? ((data[pos + 3] ?? 0) << 8) | (data[pos + 4] ?? 0) : (first << 8) | (data[pos + 1] ?? 0);
    if (frameSize === 0 || blockSize === 0) break;
    const bodyStart = pos + headerSize;
    const bodyEnd = bodyStart + blockSize;
    if (bodyEnd > end) throw truncated(pos, "the LZX chunk extends past the end of the file");
    if (frameSize > FRAME_SIZE || produced + frameSize > decompressedSize) {
      throw new XnbFormatError("MalformedLzx", pos, "the frames exceed the declared decompressed size");
    }
    decoder.decodeFrame(new LzxBitReader(data, bodyStart, bodyEnd, pos), pos, out, produced, frameSize);
    produced += frameSize;
    pos = bodyEnd;
  }
  if (produced !== decompressedSize) {
    throw new XnbFormatError("MalformedLzx", pos, "the frames add up to less than the declared decompressed size");
  }
  return out;
}
