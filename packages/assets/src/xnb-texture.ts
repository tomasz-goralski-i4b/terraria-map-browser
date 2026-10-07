import { decompressLzx } from "./lzx-decoder.js";
import { XnbFormatError } from "./xnb-error.js";

/** Size caps, checked before the buffer they protect is allocated. */
export interface XnbLimits {
  /** Largest accepted file, in bytes (the file-size field and the supplied view). */
  readonly maxFileBytes: number;
  /** Largest accepted decompressed payload, in bytes. */
  readonly maxDecompressedBytes: number;
  /** Largest accepted `width × height × 4`, in bytes. */
  readonly maxPixelBytes: number;
}

/** Caps applied when the caller passes none; far above any vanilla Terraria sheet. */
export const DEFAULT_XNB_LIMITS: XnbLimits = {
  maxFileBytes: 32 * 1024 * 1024,
  maxDecompressedBytes: 128 * 1024 * 1024,
  maxPixelBytes: 128 * 1024 * 1024,
};

/** Options of {@link readXnbTexture}. */
export interface XnbReadOptions {
  /** Overrides individual caps of {@link DEFAULT_XNB_LIMITS}. */
  readonly limits?: Partial<XnbLimits>;
}

/** A decoded `Texture2D`. */
export interface XnbTexture {
  readonly width: number;
  readonly height: number;
  /** `width × height × 4` bytes, rows top to bottom, R, G, B, A per pixel. */
  readonly rgba: Uint8Array;
}

const HEADER_SIZE = 10;
const COMPRESSED_HEADER_SIZE = 14;
const FLAG_LZX = 0x80;
const KNOWN_FLAGS = 0x81;
const TEXTURE_READER = "Microsoft.Xna.Framework.Content.Texture2DReader";
const SURFACE_FORMAT_COLOR = 0;

/** Cursor over the decompressed payload; offsets in its errors are payload offsets. */
class PayloadReader {
  pos = 0;
  private readonly data: Uint8Array;
  private readonly view: DataView;

  constructor(data: Uint8Array) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get remaining(): number {
    return this.data.length - this.pos;
  }

  /** A .NET 7-bit encoded integer (at most five bytes). */
  sevenBit(): number {
    const start = this.pos;
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      if (this.pos >= this.data.length) throw new XnbFormatError("Truncated", start, "the payload ends inside a 7-bit integer");
      const byte = this.data[this.pos++] ?? 0;
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
    }
    throw new XnbFormatError("MalformedContent", start, "a 7-bit integer is longer than five bytes");
  }

  int32(): number {
    if (this.remaining < 4) throw new XnbFormatError("Truncated", this.pos, "the payload ends inside an Int32");
    const value = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return value;
  }

  bytes(count: number): Uint8Array {
    if (this.remaining < count) throw new XnbFormatError("Truncated", this.pos, "the payload ends before its data");
    const bytes = this.data.subarray(this.pos, this.pos + count);
    this.pos += count;
    return bytes;
  }
}

function matchesTextureReader(name: Uint8Array): boolean {
  if (name.length < TEXTURE_READER.length) return false;
  for (let i = 0; i < TEXTURE_READER.length; i++) {
    if (name[i] !== TEXTURE_READER.charCodeAt(i)) return false;
  }
  return name.length === TEXTURE_READER.length || name[TEXTURE_READER.length] === 0x2c; // ','
}

function parseTexturePayload(payload: Uint8Array, limits: XnbLimits): XnbTexture {
  const reader = new PayloadReader(payload);
  if (reader.sevenBit() !== 1) throw new XnbFormatError("MalformedContent", 0, "exactly one type reader is expected");
  const nameStart = reader.pos;
  const nameLength = reader.sevenBit();
  if (nameLength > reader.remaining) throw new XnbFormatError("Truncated", nameStart, "the payload ends inside the reader name");
  if (!matchesTextureReader(reader.bytes(nameLength))) {
    throw new XnbFormatError("UnsupportedReader", nameStart, "the content is not a Texture2D");
  }
  reader.int32(); // reader version
  const sharedStart = reader.pos;
  if (reader.sevenBit() !== 0) throw new XnbFormatError("MalformedContent", sharedStart, "shared resources are not supported");
  const indexStart = reader.pos;
  if (reader.sevenBit() !== 1) throw new XnbFormatError("MalformedContent", indexStart, "the primary object is not the texture");

  const formatStart = reader.pos;
  if (reader.int32() !== SURFACE_FORMAT_COLOR) {
    throw new XnbFormatError("UnsupportedSurfaceFormat", formatStart, "only the Color surface format is supported");
  }
  const widthStart = reader.pos;
  const width = reader.int32();
  const heightStart = reader.pos;
  const height = reader.int32();
  if (width <= 0) throw new XnbFormatError("MalformedContent", widthStart, "the width must be positive");
  if (height <= 0) throw new XnbFormatError("MalformedContent", heightStart, "the height must be positive");
  const pixelBytes = width * height * 4; // at most 2^64: exact enough to compare with the cap, never wraps
  if (pixelBytes > limits.maxPixelBytes) {
    throw new XnbFormatError("TooLarge", widthStart, `the pixel data exceeds ${String(limits.maxPixelBytes)} bytes`);
  }
  const mipStart = reader.pos;
  if (reader.int32() !== 1) throw new XnbFormatError("MalformedContent", mipStart, "exactly one mip level is expected");
  const lengthStart = reader.pos;
  if (reader.int32() !== pixelBytes) {
    throw new XnbFormatError("MalformedContent", lengthStart, "the data length is not width × height × 4");
  }
  const dataStart = reader.pos;
  if (reader.remaining < pixelBytes) throw new XnbFormatError("Truncated", dataStart, "the payload ends inside the pixel data");
  const rgba = reader.bytes(pixelBytes).slice();
  if (reader.remaining > 0) throw new XnbFormatError("MalformedContent", reader.pos, "bytes follow the texture data");
  return { width, height, rgba };
}

/** Decodes an uncompressed or LZX-compressed Terraria `.xnb` `Texture2D` (docs/assets.md). */
export function readXnbTexture(bytes: Uint8Array, options?: XnbReadOptions): XnbTexture {
  const limits: XnbLimits = { ...DEFAULT_XNB_LIMITS, ...options?.limits };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (offset: number, size: number): void => {
    if (bytes.length < offset + size) throw new XnbFormatError("Truncated", offset, "the file ends inside the header");
  };

  need(0, 3);
  if (bytes[0] !== 0x58 || bytes[1] !== 0x4e || bytes[2] !== 0x42) throw new XnbFormatError("NotAnXnb", 0, "the magic is not XNB");
  need(3, 1);
  if (bytes[3] !== 0x77) throw new XnbFormatError("UnsupportedPlatform", 3, "only the Windows platform is supported");
  need(4, 1);
  if (bytes[4] !== 5) throw new XnbFormatError("UnsupportedVersion", 4, "only format version 5 is supported");
  need(5, 1);
  const flags = bytes[5] ?? 0;
  if ((flags & ~KNOWN_FLAGS) !== 0) throw new XnbFormatError("UnsupportedFlags", 5, "only the LZX and HiDef flags are supported");
  need(6, 4);
  const fileSize = view.getUint32(6, true);
  if (fileSize > limits.maxFileBytes) {
    throw new XnbFormatError("TooLarge", 6, `the file size exceeds ${String(limits.maxFileBytes)} bytes`);
  }
  if (fileSize < bytes.length) throw new XnbFormatError("SizeMismatch", 6, "the file size is smaller than the supplied bytes");
  if (fileSize > bytes.length) throw new XnbFormatError("Truncated", bytes.length, "the file is shorter than its size field");

  if ((flags & FLAG_LZX) === 0) {
    if (fileSize - HEADER_SIZE > limits.maxDecompressedBytes) {
      throw new XnbFormatError("TooLarge", 6, `the payload exceeds ${String(limits.maxDecompressedBytes)} bytes`);
    }
    return parseTexturePayload(bytes.subarray(HEADER_SIZE), limits);
  }

  need(10, 4);
  const decompressedSize = view.getUint32(10, true);
  if (decompressedSize > limits.maxDecompressedBytes) {
    throw new XnbFormatError("TooLarge", 10, `the decompressed size exceeds ${String(limits.maxDecompressedBytes)} bytes`);
  }
  return parseTexturePayload(decompressLzx(bytes, COMPRESSED_HEADER_SIZE, fileSize, decompressedSize), limits);
}
