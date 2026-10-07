import { describe, expect, it } from "vitest";
import { readXnbTexture, XnbFormatError, type XnbErrorKind, type XnbReadOptions } from "./index.js";
import {
  BitWriter,
  buildTexturePayload,
  lzxBadBlockTypeFrames,
  lzxLiteralFrames,
  lzxPretree19Frames,
  lzxRepeatOffsetFrames,
  lzxUncompressedFrames,
  patternRgba,
  PAYLOAD,
  REPEAT_OFFSET_TAIL,
  setInt32,
  wrapLzx,
  wrapUncompressed,
  writeUncompressedHeader,
} from "./xnb-fixture.js";

function catchError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

function expectXnbError(action: () => unknown, kind: XnbErrorKind, offset?: number): XnbFormatError {
  const error = catchError(action);
  expect(error).toBeInstanceOf(XnbFormatError);
  const formatError = error as XnbFormatError;
  expect(formatError.kind).toBe(kind);
  if (offset !== undefined) expect(formatError.offset).toBe(offset);
  expect(Number.isInteger(formatError.offset)).toBe(true);
  expect(formatError.offset).toBeGreaterThanOrEqual(0);
  return formatError;
}

function read(bytes: Uint8Array, options?: XnbReadOptions): ReturnType<typeof readXnbTexture> {
  return readXnbTexture(bytes, options);
}

/** Sets the file-size field to the actual length, so a cut file fails inside the chunk or payload reader. */
function withFileSize(bytes: Uint8Array): Uint8Array {
  setInt32(bytes, 6, bytes.length);
  return bytes;
}

function texture(width: number, height: number): { payload: Uint8Array; rgba: Uint8Array } {
  const rgba = patternRgba(width, height);
  return { payload: buildTexturePayload(width, height, rgba), rgba };
}

function expectDecodes(bytes: Uint8Array, width: number, height: number, rgba: Uint8Array): void {
  const decoded = read(bytes);
  expect(decoded.width).toBe(width);
  expect(decoded.height).toBe(height);
  expect(decoded.rgba).toBeInstanceOf(Uint8Array);
  expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba));
}

/** Hand-built aligned match after an uncompressed prefix; no decoder tables or compressor are used. */
function alignedMatchFrames(payload: Uint8Array, slot: 8 | 10): ReturnType<typeof lzxLiteralFrames> {
  const writer = new BitWriter();
  const prefixLength = payload.length - 4;
  writer.bits(0, 1); // no Intel E8
  writeUncompressedHeader(writer, prefixLength, 1, 1, 1);
  writer.raw(payload.subarray(0, prefixLength));
  if (prefixLength % 2 === 1) writer.raw([0]);

  writer.bits(2, 3); // aligned block
  writer.bits(4, 24); // one four-byte match
  // Complete, non-uniform aligned tree: symbol 5 has code 1101, unlike its raw three-bit value 101.
  for (const length of [2, 2, 3, 3, 4, 4, 4, 4]) writer.bits(length, 3);
  // Each tree run has a complete pretree: symbols 0–11 have length 4; symbols 12–19 have length 5.
  // Starting from zero lengths, delta 8 gives main length 9 (512 symbols); delta 0 leaves the length tree empty.
  for (const [count, delta] of [[256, 8], [256, 8], [249, 0]] as const) {
    for (let symbol = 0; symbol < 20; symbol++) writer.bits(symbol < 12 ? 4 : 5, 4);
    for (let symbol = 0; symbol < count; symbol++) writer.bits(delta, 4);
  }
  writer.bits(256 + slot * 8 + 2, 9); // all main lengths are 9: canonical code = symbol; length = 2 + 2
  // Slot 8: base 16, three extra bits, offset = 16 - 2 + 5 = 19.
  // Slot 10: base 32, four extra bits, offset = 32 - 2 + (1 << 3) + 5 = 43.
  if (slot === 10) writer.bits(1, 1);
  writer.bits(0b1101, 4); // aligned symbol 5
  return [{ output: payload.length, compressed: writer.toBytes() }];
}

describe("readXnbTexture — uncompressed", () => {
  it("readXnbTexture_UncompressedTexture_DecodesDimensionsAndRgba", () => {
    const { payload, rgba } = texture(2, 3);
    expectDecodes(wrapUncompressed(payload), 2, 3, rgba);
  });

  it("readXnbTexture_HiDefFlag_StillDecodes", () => {
    const { payload, rgba } = texture(2, 3);
    expectDecodes(wrapUncompressed(payload, 0x01), 2, 3, rgba);
  });

  it("readXnbTexture_ViewWithByteOffset_DecodesOnlyTheView", () => {
    const { payload, rgba } = texture(2, 3);
    const file = wrapUncompressed(payload);
    const padded = new Uint8Array(file.length + 7);
    padded.set(file, 3);
    expectDecodes(padded.subarray(3, 3 + file.length), 2, 3, rgba);
  });

  it("readXnbTexture_Result_DoesNotAliasTheInput", () => {
    const { payload } = texture(2, 3);
    const file = wrapUncompressed(payload);
    const decoded = read(file);
    const before = Array.from(decoded.rgba);
    file.fill(0xaa, 10 + PAYLOAD.data);
    expect(Array.from(decoded.rgba)).toEqual(before);
  });
});

describe("readXnbTexture — LZX", () => {
  it("readXnbTexture_LzxUncompressedBlock_DecodesOddAndEvenLengths", () => {
    // 2×3 → 177 + 24 = 201 bytes (odd, one padding byte); 3×3 → 213 (odd); 1×2 → 185 (odd); 2×2 → 193 (odd).
    for (const [width, height] of [[2, 3], [3, 3], [1, 2], [2, 2]] as const) {
      const { payload, rgba } = texture(width, height);
      expectDecodes(wrapLzx(lzxUncompressedFrames(payload), payload.length), width, height, rgba);
    }
  });

  it("readXnbTexture_LzxUncompressedBlockSpanningFrames_DecodesAcrossChunks", () => {
    const { payload, rgba } = texture(100, 100); // 40 177 bytes → one full frame and a 0xFF-framed last one
    const frames = lzxUncompressedFrames(payload);
    expect(frames.map((frame) => frame.output)).toEqual([32768, 7409]);
    expectDecodes(wrapLzx(frames, payload.length), 100, 100, rgba);
  });

  it("readXnbTexture_LzxVerbatimLiterals_DecodesTreeDeltaCodingAndBitReader", () => {
    const { payload, rgba } = texture(2, 3);
    expectDecodes(wrapLzx(lzxLiteralFrames(payload), payload.length), 2, 3, rgba);
  });

  it("readXnbTexture_LzxVerbatimBlockSpanningFrames_KeepsBlockStateAcrossChunks", () => {
    const { payload, rgba } = texture(100, 100);
    expectDecodes(wrapLzx(lzxLiteralFrames(payload), payload.length), 100, 100, rgba);
  });

  it("readXnbTexture_LzxAlignedBlockWithLiterals_DecodesAlignedHeader", () => {
    const { payload, rgba } = texture(2, 3);
    expectDecodes(wrapLzx(lzxLiteralFrames(payload, { aligned: true }), payload.length), 2, 3, rgba);
  });

  it.each([
    { extraBits: 3, slot: 8, tail: [62, 69, 76, 83] },
    { extraBits: 4, slot: 10, tail: [150, 157, 164, 171] },
  ] as const)("readXnbTexture_LzxAlignedMatchWith$extraBits ExtraBits_DecodesDistinctRgba", ({ slot, tail }) => {
    const rgba = patternRgba(17, 1);
    // The match starts at pixel byte 64. Offsets 19 and 43 copy bytes 45–48 and 21–24 respectively.
    // Expected bytes are fixed independently of the bitstream and decoder's offset calculation.
    rgba.set(tail, 64);
    const payload = buildTexturePayload(17, 1, rgba);
    expectDecodes(wrapLzx(alignedMatchFrames(payload, slot), payload.length), 17, 1, rgba);
  });

  it("readXnbTexture_LzxSlotThreeMatch_PushesItsOffsetOntoTheRepeatQueue", () => {
    const rgba = patternRgba(3, 2);
    rgba.set(REPEAT_OFFSET_TAIL, rgba.length - REPEAT_OFFSET_TAIL.length);
    const payload = buildTexturePayload(3, 2, rgba);
    // Copying from offset 1 instead of 4 would end …31 31 31 31 31 instead of …31 31 31 ff 31.
    expectDecodes(wrapLzx(lzxRepeatOffsetFrames(payload), payload.length), 3, 2, rgba);
  });

  it("readXnbTexture_LzxPretreeSymbol19Run_AppliesOneValueComputedFromTheFirstOldLength", () => {
    const rgba = Uint8Array.of(
      ...[4, 5, 6, 7, 0, 1, 2, 3, 10, 9, 8, 11, 4, 4, 5, 0], // block 2: lengths 8, 9, 10, 11, 1 … 7, 11
      ...[0, 1, 2, 3, 4, 34, 20, 7, 3, 2, 1, 0, 30, 31, 33, 12], // block 3: all lengths 7 or 5
    );
    const payload = buildTexturePayload(4, 2, rgba);
    expectDecodes(wrapLzx(lzxPretree19Frames(payload), payload.length), 4, 2, rgba);
  });

  it("readXnbTexture_LzxWithoutEndMarker_StopsAtTheFileSize", () => {
    const { payload, rgba } = texture(2, 3);
    expectDecodes(wrapLzx(lzxLiteralFrames(payload), payload.length, []), 2, 3, rgba);
  });

  it("readXnbTexture_LzxWithShortEndMarker_Decodes", () => {
    const { payload, rgba } = texture(2, 3);
    expectDecodes(wrapLzx(lzxLiteralFrames(payload), payload.length, [0, 0]), 2, 3, rgba);
  });

  it("readXnbTexture_LzxHiDefFlag_StillDecodes", () => {
    const { payload, rgba } = texture(2, 3);
    const file = wrapLzx(lzxLiteralFrames(payload), payload.length);
    file[5] = 0x81;
    expectDecodes(file, 2, 3, rgba);
  });
});

describe("readXnbTexture — rejected containers", () => {
  const { payload } = texture(2, 3);
  const valid = (): Uint8Array => wrapUncompressed(payload);

  it("readXnbTexture_EmptyInput_ThrowsTruncatedAtZero", () => {
    expectXnbError(() => read(new Uint8Array(0)), "Truncated", 0);
  });

  it.each([
    [3, 3],
    [5, 5],
    [9, 6],
  ])("readXnbTexture_HeaderCutAfter%iBytes_ThrowsTruncatedAtTheMissingField (offset %i)", (length, offset) => {
    expectXnbError(() => read(valid().subarray(0, length)), "Truncated", offset);
  });

  it("readXnbTexture_WrongMagic_ThrowsNotAnXnbAtZero", () => {
    const file = valid();
    file[0] = 0x59;
    expectXnbError(() => read(file), "NotAnXnb", 0);
  });

  it("readXnbTexture_ShorterThanMagic_ThrowsTruncated", () => {
    expectXnbError(() => read(Uint8Array.of(0x58, 0x4e)), "Truncated", 0);
  });

  it.each([0x6d, 0x78, 0x57])("readXnbTexture_Platform0x%x_ThrowsUnsupportedPlatformAtThree", (platform) => {
    const file = valid();
    file[3] = platform;
    expectXnbError(() => read(file), "UnsupportedPlatform", 3);
  });

  it.each([4, 6])("readXnbTexture_Version%i_ThrowsUnsupportedVersionAtFour", (version) => {
    const file = valid();
    file[4] = version;
    expectXnbError(() => read(file), "UnsupportedVersion", 4);
  });

  it.each([0x40, 0x02, 0x04, 0x20, 0xc0])("readXnbTexture_Flags0x%x_ThrowsUnsupportedFlagsAtFive", (flags) => {
    const file = valid();
    file[5] = flags;
    expectXnbError(() => read(file), "UnsupportedFlags", 5);
  });

  it("readXnbTexture_FileSizeSmallerThanInput_ThrowsSizeMismatchAtSix", () => {
    const file = valid();
    setInt32(file, 6, file.length - 1);
    expectXnbError(() => read(file), "SizeMismatch", 6);
  });

  it("readXnbTexture_FileSizeLargerThanInput_ThrowsTruncatedAtTheEndOfData", () => {
    const file = valid();
    expectXnbError(() => read(file.subarray(0, file.length - 1)), "Truncated", file.length - 1);
  });

  it("readXnbTexture_LzxFileSizeSmallerThanInput_ThrowsSizeMismatchAtSix", () => {
    const file = wrapLzx(lzxLiteralFrames(payload), payload.length);
    setInt32(file, 6, file.length - 1);
    expectXnbError(() => read(file), "SizeMismatch", 6);
  });
});

describe("readXnbTexture — rejected LZX streams", () => {
  const { payload } = texture(2, 3);
  const frames = (): ReturnType<typeof lzxLiteralFrames> => lzxLiteralFrames(payload);

  it("readXnbTexture_LzxTruncatedChunk_ThrowsTruncatedAtTheChunkStart", () => {
    const big = texture(100, 100).payload;
    const file = wrapLzx(lzxLiteralFrames(big), big.length);
    const secondChunk = 14 + 2 + (((file[14] ?? 0) << 8) | (file[15] ?? 0));
    const cut = withFileSize(file.slice(0, file.length - 10));
    expectXnbError(() => read(cut), "Truncated", secondChunk);
  });

  it("readXnbTexture_LzxChunkTruncatedByOneByteInsideAWord_ThrowsTruncatedAtTheChunkStart", () => {
    const [frame] = frames();
    expect(frame).toBeDefined();
    const cutFrame = { output: frame?.output ?? 0, compressed: (frame?.compressed ?? new Uint8Array()).slice(0, -1) };
    const file = wrapLzx([cutFrame], payload.length);
    expectXnbError(() => read(file), "Truncated", 14);
  });

  it("readXnbTexture_LzxChunkHeaderCutInHalf_ThrowsTruncated", () => {
    const file = wrapLzx(frames(), payload.length);
    expectXnbError(() => read(withFileSize(file.slice(0, 16))), "Truncated", 14);
  });

  it.each([0, 4, 5, 6, 7])("readXnbTexture_LzxBlockType%i_ThrowsMalformedLzxAtTheChunk", (blockType) => {
    const file = wrapLzx(lzxBadBlockTypeFrames(blockType, payload.length), payload.length);
    expectXnbError(() => read(file), "MalformedLzx", 14);
  });

  it("readXnbTexture_LzxIntelE8Flag_ThrowsMalformedLzxAtTheChunk", () => {
    const file = wrapLzx(lzxUncompressedFrames(payload, { e8: true }), payload.length);
    expectXnbError(() => read(file), "MalformedLzx", 14);
  });

  it("readXnbTexture_LzxFramesShorterThanDeclaredSize_ThrowsMalformedLzx", () => {
    expectXnbError(() => read(wrapLzx(frames(), payload.length + 4)), "MalformedLzx");
  });

  it("readXnbTexture_LzxFramesLongerThanDeclaredSize_ThrowsMalformedLzx", () => {
    expectXnbError(() => read(wrapLzx(frames(), payload.length - 4)), "MalformedLzx");
  });

  it("readXnbTexture_LzxIncompleteMainTree_ThrowsMalformedLzx", () => {
    // Replacing the compressed bytes after the block header with zeros leaves pretree lengths that are all zero.
    const file = wrapLzx(frames(), payload.length);
    file.fill(0, 14 + 5 + 4);
    expectXnbError(() => read(file), "MalformedLzx");
  });

  it("readXnbTexture_LzxUncompressedBlockCutShort_ThrowsTruncatedOrMalformedLzx", () => {
    const file = wrapLzx(lzxUncompressedFrames(payload), payload.length);
    // The chunk header promises more compressed bytes than the file holds.
    const cut = withFileSize(file.slice(0, 14 + 5 + 20));
    const error = catchError(() => read(cut));
    expect(error).toBeInstanceOf(XnbFormatError);
    expect(["Truncated", "MalformedLzx"]).toContain((error as XnbFormatError).kind);
  });
});

describe("readXnbTexture — rejected texture payloads", () => {
  function mutated(offset: number, value: number): Uint8Array {
    const { payload } = texture(2, 3);
    setInt32(payload, offset, value);
    return wrapUncompressed(payload);
  }

  it("readXnbTexture_ReaderCountTwo_ThrowsMalformedContentAtZero", () => {
    const { payload } = texture(2, 3);
    payload[PAYLOAD.readerCount] = 2;
    expectXnbError(() => read(wrapUncompressed(payload)), "MalformedContent", PAYLOAD.readerCount);
  });

  it("readXnbTexture_OtherReaderType_ThrowsUnsupportedReaderAtTheName", () => {
    const { payload } = texture(2, 3);
    payload[PAYLOAD.readerNameLength + 2] = 0x78; // "Microsoft…" → "xicrosoft…"
    expectXnbError(() => read(wrapUncompressed(payload)), "UnsupportedReader", PAYLOAD.readerNameLength);
  });

  it("readXnbTexture_SharedResources_ThrowsMalformedContentAtTheCount", () => {
    const { payload } = texture(2, 3);
    payload[PAYLOAD.sharedCount] = 1;
    expectXnbError(() => read(wrapUncompressed(payload)), "MalformedContent", PAYLOAD.sharedCount);
  });

  it("readXnbTexture_NullPrimaryObject_ThrowsMalformedContentAtTheReaderIndex", () => {
    const { payload } = texture(2, 3);
    payload[PAYLOAD.readerIndex] = 0;
    expectXnbError(() => read(wrapUncompressed(payload)), "MalformedContent", PAYLOAD.readerIndex);
  });

  it.each([1, 4, 28])("readXnbTexture_SurfaceFormat%i_ThrowsUnsupportedSurfaceFormatAtTheField", (format) => {
    expectXnbError(
      () => read(mutated(PAYLOAD.surfaceFormat, format)),
      "UnsupportedSurfaceFormat",
      PAYLOAD.surfaceFormat,
    );
  });

  it.each([0, -1])("readXnbTexture_Width%i_ThrowsMalformedContentAtTheWidth", (width) => {
    expectXnbError(() => read(mutated(PAYLOAD.width, width)), "MalformedContent", PAYLOAD.width);
  });

  it.each([0, -5])("readXnbTexture_Height%i_ThrowsMalformedContentAtTheHeight", (height) => {
    expectXnbError(() => read(mutated(PAYLOAD.height, height)), "MalformedContent", PAYLOAD.height);
  });

  it("readXnbTexture_TwoMipLevels_ThrowsMalformedContentAtTheCount", () => {
    expectXnbError(() => read(mutated(PAYLOAD.mipCount, 2)), "MalformedContent", PAYLOAD.mipCount);
  });

  it("readXnbTexture_DataLengthNotWidthTimesHeightTimesFour_ThrowsMalformedContentAtTheLength", () => {
    expectXnbError(() => read(mutated(PAYLOAD.dataLength, 20)), "MalformedContent", PAYLOAD.dataLength);
  });

  it("readXnbTexture_TrailingBytesAfterTheData_ThrowsMalformedContentAtTheirStart", () => {
    const { payload } = texture(2, 3);
    const withTrailing = Uint8Array.of(...payload, 0);
    expectXnbError(() => read(wrapUncompressed(withTrailing)), "MalformedContent", payload.length);
  });

  it("readXnbTexture_PixelDataCutShort_ThrowsTruncatedAtTheData", () => {
    const { payload } = texture(2, 3);
    const file = withFileSize(wrapUncompressed(payload).slice(0, 10 + payload.length - 1));
    expectXnbError(() => read(file), "Truncated", PAYLOAD.data);
  });

  it("readXnbTexture_PayloadCutInsideTheHeader_ThrowsTruncatedAtTheMissingField", () => {
    const { payload } = texture(2, 3);
    const file = withFileSize(wrapUncompressed(payload).slice(0, 10 + PAYLOAD.width + 2));
    expectXnbError(() => read(file), "Truncated", PAYLOAD.width);
  });
});

describe("readXnbTexture — size caps", () => {
  const { payload } = texture(2, 3);

  it("readXnbTexture_FileSizeFieldAboveTheCap_ThrowsTooLargeAtSixWithoutReadingFurther", () => {
    const file = wrapUncompressed(payload);
    expectXnbError(() => read(file, { limits: { maxFileBytes: file.length - 1 } }), "TooLarge", 6);
  });

  it("readXnbTexture_HugeFileSizeFieldInTinyFile_ThrowsTooLargeNotTruncated", () => {
    const file = wrapUncompressed(payload).slice(0, 12);
    setInt32(file, 6, 0x7fffffff);
    expectXnbError(() => read(file), "TooLarge", 6);
  });

  it("readXnbTexture_FileSizeAtTheCap_Decodes", () => {
    const file = wrapUncompressed(payload);
    expect(read(file, { limits: { maxFileBytes: file.length } }).width).toBe(2);
  });

  it("readXnbTexture_UncompressedPayloadAboveTheCap_ThrowsTooLargeAtSix", () => {
    const file = wrapUncompressed(payload);
    expectXnbError(() => read(file, { limits: { maxDecompressedBytes: payload.length - 1 } }), "TooLarge", 6);
  });

  it("readXnbTexture_UncompressedPayloadAtTheCap_Decodes", () => {
    const file = wrapUncompressed(payload);
    expect(read(file, { limits: { maxDecompressedBytes: payload.length } }).width).toBe(2);
  });

  it("readXnbTexture_DecompressedSizeAboveTheCap_ThrowsTooLargeAtTen", () => {
    const file = wrapLzx(lzxLiteralFrames(payload), payload.length);
    expectXnbError(() => read(file, { limits: { maxDecompressedBytes: payload.length - 1 } }), "TooLarge", 10);
  });

  it("readXnbTexture_HugeDecompressedSizeField_ThrowsTooLargeUnderDefaultCaps", () => {
    const file = wrapLzx(lzxLiteralFrames(payload), payload.length);
    setInt32(file, 10, 0x7fffffff);
    expectXnbError(() => read(file), "TooLarge", 10);
  });

  it("readXnbTexture_NegativeDecompressedSizeField_ThrowsTooLargeOrMalformedAtTen", () => {
    const file = wrapLzx(lzxLiteralFrames(payload), payload.length);
    setInt32(file, 10, -1);
    const error = catchError(() => read(file));
    expect(error).toBeInstanceOf(XnbFormatError);
    expect((error as XnbFormatError).offset).toBe(10);
  });

  it("readXnbTexture_PixelBytesAboveTheCap_ThrowsTooLargeAtTheWidth", () => {
    expectXnbError(() => read(wrapUncompressed(payload), { limits: { maxPixelBytes: 23 } }), "TooLarge", PAYLOAD.width);
    expect(read(wrapUncompressed(payload), { limits: { maxPixelBytes: 24 } }).height).toBe(3);
  });

  it("readXnbTexture_HugeDimensionsWithoutData_ThrowsTooLargeBeforeAnyAllocation", () => {
    const huge = texture(2, 3).payload;
    setInt32(huge, PAYLOAD.width, 0x7fffffff);
    setInt32(huge, PAYLOAD.height, 0x7fffffff);
    setInt32(huge, PAYLOAD.dataLength, 0x7fffffff);
    expectXnbError(() => read(wrapUncompressed(huge)), "TooLarge", PAYLOAD.width);
  });

  it("readXnbTexture_DimensionsWhoseProductOverflowsTheCap_ThrowsTooLargeUnderDefaultCaps", () => {
    const huge = texture(2, 3).payload;
    setInt32(huge, PAYLOAD.width, 65536);
    setInt32(huge, PAYLOAD.height, 65536);
    expectXnbError(() => read(wrapUncompressed(huge)), "TooLarge", PAYLOAD.width);
  });
});
