// Test-only builders for synthetic XNB files (docs/assets.md, "Test strategy"). Nothing here is derived from a game
// file; the LZX side hand-assembles bitstreams and never compresses.

/** Frame size of an XNB LZX chunk (docs/assets.md, "Chunk framing"). */
export const FRAME_SIZE = 32768;

/** Offsets of the fields of a `Texture2D` payload with exactly one reader and one mip level. */
export const PAYLOAD = {
  readerCount: 0,
  readerNameLength: 1,
  readerVersion: 151,
  sharedCount: 155,
  readerIndex: 156,
  surfaceFormat: 157,
  width: 161,
  height: 165,
  mipCount: 169,
  dataLength: 173,
  data: 177,
} as const;

const READER_NAME =
  "Microsoft.Xna.Framework.Content.Texture2DReader, Microsoft.Xna.Framework.Graphics, Version=4.0.0.0, Culture=neutral, PublicKeyToken=842cf8be1de50553";

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`fixture index ${String(index)} out of range`);
  return item;
}

/** Writes a little-endian Int32 into `bytes` at `offset`. */
export function setInt32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setInt32(offset, value, true);
}

function int32Bytes(value: number): number[] {
  const bytes = new Uint8Array(4);
  setInt32(bytes, 0, value);
  return [...bytes];
}

/** Deterministic pixel bytes, distinct for neighbouring positions. */
export function patternRgba(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 7 + 3) & 0xff;
  return rgba;
}

/** The decompressed `Texture2D` payload: 177 header bytes followed by the pixel data. */
export function buildTexturePayload(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const name = Uint8Array.from(READER_NAME, (char) => char.charCodeAt(0));
  const header = [
    1, // reader count
    (name.length & 0x7f) | 0x80, name.length >> 7, // name length (7bit)
    ...name,
    ...int32Bytes(0), // reader version
    0, // shared resources
    1, // primary object: reader 1
    ...int32Bytes(0), // surface format Color
    ...int32Bytes(width),
    ...int32Bytes(height),
    ...int32Bytes(1), // mip levels
    ...int32Bytes(rgba.length),
  ];
  if (header.length !== PAYLOAD.data) throw new Error("fixture payload header must be 177 bytes");
  const payload = new Uint8Array(header.length + rgba.length);
  payload.set(header, 0);
  payload.set(rgba, header.length);
  return payload;
}

function xnbHeader(flags: number, fileSize: number, decompressedSize: number | undefined): number[] {
  return [
    0x58, 0x4e, 0x42, 0x77, 0x05, flags,
    ...int32Bytes(fileSize),
    ...(decompressedSize === undefined ? [] : int32Bytes(decompressedSize)),
  ];
}

/** An uncompressed XNB (`flags` defaults to 0) around `payload`. */
export function wrapUncompressed(payload: Uint8Array, flags = 0): Uint8Array {
  const file = new Uint8Array(10 + payload.length);
  file.set(xnbHeader(flags, file.length, undefined), 0);
  file.set(payload, 10);
  return file;
}

/** The compressed bytes of one LZX frame and the number of output bytes it decodes to. */
export interface LzxFrame {
  readonly output: number;
  readonly compressed: Uint8Array;
}

/** An LZX XNB made of `frames`; `endMarker` defaults to the `00 00` plus 3 zero bytes real files end with. */
export function wrapLzx(
  frames: readonly LzxFrame[],
  decompressedSize: number,
  endMarker: readonly number[] = [0, 0, 0, 0, 0],
): Uint8Array {
  const body: number[] = [];
  for (const frame of frames) {
    if (frame.output === FRAME_SIZE) {
      body.push(frame.compressed.length >> 8, frame.compressed.length & 0xff);
    } else {
      body.push(0xff, frame.output >> 8, frame.output & 0xff, frame.compressed.length >> 8, frame.compressed.length & 0xff);
    }
    body.push(...frame.compressed);
  }
  body.push(...endMarker);
  const file = new Uint8Array(14 + body.length);
  file.set(xnbHeader(0x80, file.length, decompressedSize), 0);
  file.set(body, 14);
  return file;
}

/** MSB-first bit writer producing 16-bit little-endian words, as the LZX bit reader consumes them. */
export class BitWriter {
  private readonly out: number[] = [];
  private acc = 0;
  private count = 0;

  bits(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | (Math.floor(value / 2 ** i) & 1);
      this.count++;
      if (this.count === 16) {
        this.out.push(this.acc & 0xff, this.acc >> 8);
        this.acc = 0;
        this.count = 0;
      }
    }
  }

  /** Pads to a 16-bit boundary; a header ending exactly on a boundary still gets a whole zero word. */
  alignForRawBlock(): void {
    this.bits(0, this.count === 0 ? 16 : 16 - this.count);
  }

  /** Appends whole bytes; the writer must be word aligned. */
  raw(bytes: ArrayLike<number>): void {
    if (this.count !== 0) throw new Error("raw bytes need an aligned writer");
    this.out.push(...Array.from(bytes));
  }

  toBytes(): Uint8Array {
    if (this.count > 0) this.bits(0, 16 - this.count);
    return Uint8Array.from(this.out);
  }
}

/** Canonical Huffman codes (shorter first, ties by symbol), as the LZX trees assign them. */
export function canonicalCodes(lengths: readonly number[]): number[] {
  const codes = new Array<number>(lengths.length).fill(0);
  let code = 0;
  for (let length = 1; length <= 16; length++) {
    for (let symbol = 0; symbol < lengths.length; symbol++) {
      if (lengths[symbol] === length) codes[symbol] = code++;
    }
    code <<= 1;
  }
  return codes;
}

/** Complete Huffman code lengths for the 20 pretree symbols; at least two symbols always get a length. */
function pretreeLengths(frequencies: readonly number[]): number[] {
  const symbols = frequencies.flatMap((frequency, symbol) => (frequency > 0 ? [symbol] : []));
  for (let symbol = 0; symbols.length < 2; symbol++) if (!symbols.includes(symbol)) symbols.push(symbol);
  let nodes = symbols.map((symbol) => ({ weight: frequencies[symbol] ?? 0, leaves: [symbol] }));
  const lengths = new Array<number>(20).fill(0);
  while (nodes.length > 1) {
    nodes.sort((a, b) => a.weight - b.weight);
    const [first, second, ...rest] = nodes;
    if (first === undefined || second === undefined) throw new Error("unreachable");
    for (const leaf of [...first.leaves, ...second.leaves]) lengths[leaf] = at(lengths, leaf) + 1;
    nodes = [...rest, { weight: first.weight + second.weight, leaves: [...first.leaves, ...second.leaves] }];
  }
  return lengths;
}

interface PretreeOp {
  readonly symbol: number;
  readonly extra?: { readonly value: number; readonly length: number };
  /** Second pretree symbol of a symbol-19 run. */
  readonly then?: number;
}

function mod17(value: number): number {
  return ((value % 17) + 17) % 17;
}

function planTreeDelta(old: readonly number[], next: readonly number[], repeatRuns: boolean): PretreeOp[] {
  const ops: PretreeOp[] = [];
  let i = 0;
  while (i < next.length) {
    if (next[i] === 0) {
      let end = i;
      while (end < next.length && next[end] === 0) end++;
      let remaining = end - i;
      if (remaining >= 4) {
        while (remaining > 0) {
          if (remaining >= 20) {
            let take = Math.min(51, remaining);
            if (remaining - take >= 1 && remaining - take <= 3) take = remaining - 4;
            ops.push({ symbol: 18, extra: { value: take - 20, length: 5 } });
            remaining -= take;
          } else {
            ops.push({ symbol: 17, extra: { value: remaining - 4, length: 4 } });
            remaining = 0;
          }
        }
        i = end;
        continue;
      }
    }
    const value = at(next, i);
    if (repeatRuns && value !== 0 && i + 4 <= next.length && next.slice(i, i + 4).every((v) => v === value)) {
      ops.push({ symbol: 19, extra: { value: 0, length: 1 }, then: mod17(at(old, i) - value) });
      i += 4;
      continue;
    }
    ops.push({ symbol: mod17(at(old, i) - value) });
    i++;
  }
  return ops;
}

/** Writes one pretree run: 20 four-bit pretree lengths, then the delta-coded lengths. */
function writeTreeRun(writer: BitWriter, old: readonly number[], next: readonly number[], repeatRuns: boolean): void {
  const ops = planTreeDelta(old, next, repeatRuns);
  const frequencies = new Array<number>(20).fill(0);
  for (const op of ops) {
    frequencies[op.symbol] = at(frequencies, op.symbol) + 1;
    if (op.then !== undefined) frequencies[op.then] = at(frequencies, op.then) + 1;
  }
  const lengths = pretreeLengths(frequencies);
  const codes = canonicalCodes(lengths);
  for (const length of lengths) writer.bits(length, 4);
  const emit = (symbol: number): void => {
    writer.bits(at(codes, symbol), at(lengths, symbol));
  };
  for (const op of ops) {
    emit(op.symbol);
    if (op.extra !== undefined) writer.bits(op.extra.value, op.extra.length);
    if (op.then !== undefined) emit(op.then);
  }
}

/** Main-tree (512) and length-tree (249) code lengths, persistent across blocks. */
export interface TreeState {
  main: number[];
  length: number[];
}

export function emptyTrees(): TreeState {
  return { main: new Array<number>(512).fill(0), length: new Array<number>(249).fill(0) };
}

/** Main-tree lengths with 8 for every literal and nothing else. */
export function literalOnlyMain(): number[] {
  return Array.from({ length: 512 }, (_, symbol) => (symbol < 256 ? 8 : 0));
}

export interface VerbatimHeaderOptions {
  /** Writes an aligned-offset block (type 2) with all eight aligned lengths 3. */
  readonly aligned?: boolean;
  /** Lets the delta planner use pretree symbol 19 for four equal consecutive new lengths. */
  readonly repeatRuns?: boolean;
}

/** Writes a verbatim (or aligned) block header and the three tree runs, updating `state` to the new lengths. */
export function writeVerbatimHeader(
  writer: BitWriter,
  state: TreeState,
  blockLength: number,
  nextMain: readonly number[],
  nextLength: readonly number[],
  options: VerbatimHeaderOptions = {},
): void {
  const repeatRuns = options.repeatRuns ?? false;
  writer.bits(options.aligned === true ? 2 : 1, 3);
  writer.bits(blockLength, 24);
  if (options.aligned === true) for (let i = 0; i < 8; i++) writer.bits(3, 3);
  writeTreeRun(writer, state.main.slice(0, 256), nextMain.slice(0, 256), repeatRuns);
  writeTreeRun(writer, state.main.slice(256), nextMain.slice(256), repeatRuns);
  writeTreeRun(writer, state.length, nextLength, repeatRuns);
  state.main = [...nextMain];
  state.length = [...nextLength];
}

/** Writes an uncompressed block header (type 3, with repeated offsets R0–R2); the caller then writes the bytes. */
export function writeUncompressedHeader(writer: BitWriter, length: number, r0: number, r1: number, r2: number): void {
  writer.bits(3, 3);
  writer.bits(length, 24);
  writer.alignForRawBlock();
  writer.raw([...int32Bytes(r0), ...int32Bytes(r1), ...int32Bytes(r2)]);
}

/** Options that corrupt the start of an LZX stream for negative tests. */
export interface LzxStreamOptions {
  /** Sets the Intel E8 flag (docs/assets.md: unsupported). */
  readonly e8?: boolean;
}

function writeStreamStart(writer: BitWriter, options: LzxStreamOptions): void {
  if (options.e8 === true) {
    writer.bits(1, 1);
    writer.bits(0, 16);
    writer.bits(0, 16);
  } else {
    writer.bits(0, 1);
  }
}

function frameCount(length: number): number {
  return Math.max(1, Math.ceil(length / FRAME_SIZE));
}

/** One uncompressed block carrying the whole payload, split over 32 KiB frames. */
export function lzxUncompressedFrames(payload: Uint8Array, options: LzxStreamOptions = {}): LzxFrame[] {
  const frames: LzxFrame[] = [];
  for (let index = 0; index < frameCount(payload.length); index++) {
    const slice = payload.subarray(index * FRAME_SIZE, (index + 1) * FRAME_SIZE);
    const writer = new BitWriter();
    if (index === 0) {
      writeStreamStart(writer, options);
      writeUncompressedHeader(writer, payload.length, 1, 1, 1);
    }
    writer.raw(slice);
    const bytes = writer.toBytes();
    const last = index === frameCount(payload.length) - 1;
    const compressed = last && payload.length % 2 === 1 ? Uint8Array.of(...bytes, 0) : bytes;
    frames.push({ output: slice.length, compressed });
  }
  return frames;
}

/** A stream whose first block header carries `blockType` (0 or 4–7 are invalid); nothing follows the header. */
export function lzxBadBlockTypeFrames(blockType: number, outputLength: number): LzxFrame[] {
  const writer = new BitWriter();
  writer.bits(0, 1);
  writer.bits(blockType, 3);
  writer.bits(outputLength, 24);
  return [{ output: outputLength, compressed: writer.toBytes() }];
}

/** One verbatim (or aligned) literal-only block carrying the whole payload, split over 32 KiB frames. */
export function lzxLiteralFrames(payload: Uint8Array, options: VerbatimHeaderOptions = {}): LzxFrame[] {
  const frames: LzxFrame[] = [];
  const main = literalOnlyMain();
  for (let index = 0; index < frameCount(payload.length); index++) {
    const slice = payload.subarray(index * FRAME_SIZE, (index + 1) * FRAME_SIZE);
    const writer = new BitWriter();
    if (index === 0) {
      writer.bits(0, 1);
      writeVerbatimHeader(writer, emptyTrees(), payload.length, main, new Array<number>(249).fill(0), options);
    }
    // 256 literals of length 8: the canonical code of a literal is the byte itself.
    for (const byte of slice) writer.bits(byte, 8);
    frames.push({ output: slice.length, compressed: writer.toBytes() });
  }
  return frames;
}

/** Bytes a repeat-offset payload must end with, produced by the block of {@link lzxRepeatOffsetFrames}. */
export const REPEAT_OFFSET_TAIL: readonly number[] = [0xfe, 0xff, 0x31, 0x31, 0x31, 0xff, 0x31];

/**
 * An uncompressed block (R0–R2 = 4, 1, 1) with all of `payload` but the last 7 bytes, then a verbatim block that
 * codes {@link REPEAT_OFFSET_TAIL} as three literals, a slot-3 match (offset 1) and a slot-1 match, which copies
 * from offset 4 only if the slot-3 offset was pushed onto the repeated-offset queue (docs/assets.md, test 4).
 */
export function lzxRepeatOffsetFrames(payload: Uint8Array): LzxFrame[] {
  const prefixLength = payload.length - REPEAT_OFFSET_TAIL.length;
  const writer = new BitWriter();
  writer.bits(0, 1);
  writeUncompressedHeader(writer, prefixLength, 4, 1, 1);
  writer.raw(payload.subarray(0, prefixLength));
  if (prefixLength % 2 === 1) writer.raw([0]);
  const main = literalOnlyMain();
  for (const symbol of [254, 255, 264, 280]) main[symbol] = 9;
  const state = emptyTrees();
  writeVerbatimHeader(writer, state, REPEAT_OFFSET_TAIL.length, main, state.length);
  const codes = canonicalCodes(main);
  const emit = (symbol: number): void => {
    writer.bits(at(codes, symbol), at(main, symbol));
  };
  emit(0xfe);
  emit(0xff);
  emit(0x31);
  emit(280); // slot 3, length 2: copies the previous byte twice
  emit(264); // slot 1 (R1), length 2
  return [{ output: payload.length, compressed: writer.toBytes() }];
}

/** Lengths of the first block of {@link lzxPretree19Frames}. */
const PRETREE19_FIRST_MAIN = [8, 9, 10, 11, 1, 2, 3, 4, 5, 6, 7, 11];
/** Lengths of the second block: positions 0–3 become 7 through one symbol-19 run. */
const PRETREE19_SECOND_MAIN = [7, 7, 7, 7, ...Array.from({ length: 31 }, () => 5)];

/**
 * The 177-byte payload header as one odd-length uncompressed block, then two verbatim blocks of 16 pixel bytes each.
 * The second block rewrites the main-tree lengths 8, 9, 10, 11 to 7, 7, 7, 7 with a single pretree symbol-19 run
 * (docs/assets.md, test 4); decoding only succeeds if the run applies one value to all four positions.
 * `payload` carries bytes 0–11 in its first 16 data bytes and bytes 0–34 in its last 16.
 */
export function lzxPretree19Frames(payload: Uint8Array): LzxFrame[] {
  const dataLength = payload.length - PAYLOAD.data;
  if (dataLength !== 32) throw new Error("the symbol-19 fixture needs 32 data bytes");
  const writer = new BitWriter();
  writer.bits(0, 1);
  writeUncompressedHeader(writer, PAYLOAD.data, 1, 1, 1);
  writer.raw(payload.subarray(0, PAYLOAD.data));
  writer.raw([0]); // odd length: one padding byte
  const state = emptyTrees();
  const pad = (lengths: readonly number[]): number[] => [...lengths, ...new Array<number>(512 - lengths.length).fill(0)];
  const noLength = new Array<number>(249).fill(0);
  const first = pad(PRETREE19_FIRST_MAIN);
  writeVerbatimHeader(writer, state, 16, first, noLength);
  const firstCodes = canonicalCodes(first);
  for (const byte of payload.subarray(PAYLOAD.data, PAYLOAD.data + 16)) writer.bits(at(firstCodes, byte), at(first, byte));
  const second = pad(PRETREE19_SECOND_MAIN);
  writeVerbatimHeader(writer, state, 16, second, noLength, { repeatRuns: true });
  const secondCodes = canonicalCodes(second);
  for (const byte of payload.subarray(PAYLOAD.data + 16)) writer.bits(at(secondCodes, byte), at(second, byte));
  return [{ output: payload.length, compressed: writer.toBytes() }];
}
