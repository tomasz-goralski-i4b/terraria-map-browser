import { describe, expect, it } from "vitest";
import { isFrameImportant, readWorldHeader } from "./header.js";
import { WorldFormatError, type WorldFormatErrorKind } from "./world-format-error.js";

// Synthetic vectors from docs/file-format.md, "Hex examples". Base vector A: version 326, revision 1, flags 0,
// 11 sections, k = 10 with tile ids 3, 4, 5 and 9 frame-important, L = 200.
const POINTERS_A = [74, 100, 120, 124, 126, 130, 134, 138, 142, 154, 180] as const;
const HEX_A =
  "4601000072656c6f67696302010000000000000000000000" +
  "0b004a00000064000000780000007c0000007e0000008200" +
  "0000860000008a0000008e0000009a000000b40000000a003802";

interface HeaderSpec {
  readonly version?: number;
  readonly signature?: string;
  readonly fileType?: number;
  readonly revision?: number;
  readonly flags?: bigint;
  readonly sectionCount?: number;
  readonly pointers?: readonly number[];
  readonly frameCount?: number;
  readonly frameBits?: readonly number[];
  /** Total length of the returned bytes (cuts or zero-pads the header). */
  readonly length?: number;
}

/** Builds vector A, with any field replaced. The pointer table always has 11 slots. */
function buildHeader(spec: HeaderSpec = {}): Uint8Array {
  const frameBits = spec.frameBits ?? [0x38, 0x02];
  const headerLength = 72 + frameBits.length;
  const length = spec.length ?? 200;
  const bytes = new Uint8Array(Math.max(length, headerLength));
  const view = new DataView(bytes.buffer);
  view.setInt32(0, spec.version ?? 326, true);
  const signature = spec.signature ?? "relogic";
  for (let index = 0; index < 7; index++) {
    bytes[4 + index] = signature.charCodeAt(index);
  }
  bytes[11] = spec.fileType ?? 2;
  view.setUint32(12, spec.revision ?? 1, true);
  view.setBigUint64(16, spec.flags ?? 0n, true);
  view.setInt16(24, spec.sectionCount ?? 11, true);
  const pointers = spec.pointers ?? POINTERS_A;
  pointers.forEach((pointer, index) => {
    view.setInt32(26 + index * 4, pointer, true);
  });
  view.setInt16(70, spec.frameCount ?? 10, true);
  bytes.set(frameBits, 72);
  return bytes.slice(0, length);
}

function withPointer(index: number, value: number): number[] {
  const pointers: number[] = [...POINTERS_A];
  pointers[index] = value;
  return pointers;
}

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function expectFormatError(bytes: Uint8Array, kind: WorldFormatErrorKind, offset: number, reason?: string): void {
  let caught: unknown;
  try {
    readWorldHeader(bytes);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(WorldFormatError);
  const error = caught as WorldFormatError;
  expect({ kind: error.kind, offset: error.offset }).toEqual({ kind, offset });
  if (reason !== undefined) {
    expect(error.reason).toBe(reason);
  }
}

describe("readWorldHeader — vector A", () => {
  it("buildHeader_Default_MatchesDocumentedHexOfVectorA", () => {
    expect([...buildHeader().subarray(0, 74)]).toEqual([...fromHex(HEX_A)]);
  });

  it("readWorldHeader_VectorA_DecodesFixedFields", () => {
    const { header } = readWorldHeader(buildHeader());
    expect(header).toEqual({
      version: 326,
      signature: "relogic",
      fileType: 2,
      revision: 1,
      flags: 0n,
      isFavorite: false,
      sectionCount: 11,
    });
  });

  it("readWorldHeader_VectorA_DecodesSectionTable", () => {
    const { sections } = readWorldHeader(buildHeader());
    expect(sections.pointers).toEqual(POINTERS_A);
    expect(sections.fileHeader).toEqual({ start: 0, end: 74 });
    expect(sections.metadata).toEqual({ start: 74, end: 100 });
    expect(sections.tiles).toEqual({ start: 100, end: 120 });
    expect(sections.chests).toEqual({ start: 120, end: 124 });
    expect(sections.signs).toEqual({ start: 124, end: 126 });
    expect(sections.npcsAndMobs).toEqual({ start: 126, end: 130 });
    expect(sections.tileEntities).toEqual({ start: 130, end: 134 });
    expect(sections.weightedPressurePlates).toEqual({ start: 134, end: 138 });
    expect(sections.townManager).toEqual({ start: 138, end: 142 });
    expect(sections.bestiary).toEqual({ start: 142, end: 154 });
    expect(sections.creativePowers).toEqual({ start: 154, end: 180 });
    expect(sections.footer).toEqual({ start: 180, end: 200 });
  });

  it("readWorldHeader_VectorA_DecodesFrameImportantBitsLsbFirst", () => {
    const { sections } = readWorldHeader(buildHeader());
    expect(sections.frameImportantCount).toBe(10);
    expect([...sections.frameImportantBits]).toEqual([0x38, 0x02]);
    const set = Array.from({ length: 16 }, (_, id) => id).filter((id) => isFrameImportant(sections, id));
    expect(set).toEqual([3, 4, 5, 9]);
  });

  it("readWorldHeader_DocumentedHexPaddedTo200_DecodesLikeVectorA", () => {
    const bytes = new Uint8Array(200);
    bytes.set(fromHex(HEX_A));
    const { header, sections } = readWorldHeader(bytes);
    expect(header.version).toBe(326);
    expect(sections.pointers).toEqual(POINTERS_A);
  });
});

describe("readWorldHeader — field decoding", () => {
  it("readWorldHeader_MaxRevision_DecodesUnsignedUInt32", () => {
    expect(readWorldHeader(buildHeader({ revision: 0xffffffff })).header.revision).toBe(4294967295);
  });

  it("readWorldHeader_AllFlagBitsSet_KeepsFull64BitValue", () => {
    const { header } = readWorldHeader(buildHeader({ flags: 0xffffffffffffffffn }));
    expect(header.flags).toBe(18446744073709551615n);
    expect(header.isFavorite).toBe(true);
  });

  it("readWorldHeader_HighFlagBitsOnly_KeepsPrecisionAndIsNotFavorite", () => {
    const { header } = readWorldHeader(buildHeader({ flags: 0x8000000000000002n }));
    expect(header.flags).toBe(9223372036854775810n);
    expect(header.isFavorite).toBe(false);
  });

  it("readWorldHeader_PaddingBitsSet_IgnoredButKeptAsRead", () => {
    const { sections } = readWorldHeader(buildHeader({ frameBits: [0x38, 0xfe] }));
    expect([...sections.frameImportantBits]).toEqual([0x38, 0xfe]);
    expect(isFrameImportant(sections, 9)).toBe(true);
    for (let id = 10; id < 16; id++) {
      expect(isFrameImportant(sections, id)).toBe(false);
    }
    expect(isFrameImportant(sections, -1)).toBe(false);
  });

  it("readWorldHeader_ZeroFrameImportantCount_HeaderEndsAt72", () => {
    const bytes = buildHeader({ frameCount: 0, frameBits: [], pointers: withPointer(0, 72) });
    const { sections } = readWorldHeader(bytes);
    expect(sections.frameImportantCount).toBe(0);
    expect(sections.frameImportantBits.length).toBe(0);
    expect(sections.fileHeader).toEqual({ start: 0, end: 72 });
    expect(isFrameImportant(sections, 0)).toBe(false);
  });

  it("readWorldHeader_RealFrameImportantCount754_HeaderEndsAt167", () => {
    const frameBits = new Array<number>(95).fill(0);
    frameBits[94] = 0x03;
    const pointers = [167, 200, 220, 224, 226, 230, 234, 238, 242, 254, 280];
    const { sections } = readWorldHeader(buildHeader({ frameCount: 754, frameBits, pointers, length: 300 }));
    expect(sections.fileHeader).toEqual({ start: 0, end: 167 });
    expect(isFrameImportant(sections, 751)).toBe(false);
    expect(isFrameImportant(sections, 752)).toBe(true);
    expect(isFrameImportant(sections, 753)).toBe(true);
    expect(isFrameImportant(sections, 754)).toBe(false);
  });
});

describe("readWorldHeader — truncation (vector B)", () => {
  it.each([0, 1, 3])("readWorldHeader_FewerThan4Bytes_TruncatedAtEndOfData (L = %i)", (length) => {
    expectFormatError(buildHeader({ length }), "Truncated", length);
  });

  it.each([4, 20, 25])("readWorldHeader_SupportedVersionFewerThan26Bytes_TruncatedAtEndOfData (L = %i)", (length) => {
    expectFormatError(buildHeader({ length }), "Truncated", length);
  });

  it("readWorldHeader_GarbageSignatureButTruncated_ReportsTruncated", () => {
    expectFormatError(buildHeader({ signature: "garbage", length: 20 }), "Truncated", 20);
  });

  it("readWorldHeader_FileTypeNotWorldButTruncated_ReportsTruncated", () => {
    expectFormatError(buildHeader({ fileType: 3, length: 11 }), "Truncated", 11);
  });

  it.each([26, 40, 71])("readWorldHeader_EndsInsideSectionTable_TruncatedAtEndOfData (L = %i)", (length) => {
    expectFormatError(buildHeader({ length }), "Truncated", length);
  });

  it("readWorldHeader_DocumentedVectorB_TruncatedAt40", () => {
    expectFormatError(fromHex(HEX_A).slice(0, 40), "Truncated", 40);
  });

  it.each([72, 73])("readWorldHeader_EndsInsideFrameImportantBits_TruncatedAtEndOfData (L = %i)", (length) => {
    expectFormatError(buildHeader({ length }), "Truncated", length);
  });
});

describe("readWorldHeader — version, signature, type, section count", () => {
  it.each([279, 327, 325, 0, -1, 2147483647])("readWorldHeader_UnsupportedVersion_RejectedAtOffset0 (%i)", (version) => {
    expectFormatError(
      buildHeader({ version }),
      "UnsupportedVersion",
      0,
      `format version ${String(version)} is not supported`,
    );
  });

  it("readWorldHeader_DocumentedVectorE_UnsupportedVersion279BeforeAnythingElse", () => {
    expectFormatError(fromHex(HEX_A.replace("46010000", "17010000")).slice(0, 24), "UnsupportedVersion", 0);
  });

  it.each([279, 327])("readWorldHeader_UnsupportedVersionOnly4Bytes_UnsupportedNotTruncated (%i)", (version) => {
    expectFormatError(buildHeader({ version, length: 4 }), "UnsupportedVersion", 0);
  });

  it("readWorldHeader_UnsupportedVersionWithGarbageSignature_ReportsVersion", () => {
    expectFormatError(buildHeader({ version: 327, signature: "garbage" }), "UnsupportedVersion", 0);
  });

  it.each(["garbage", "Relogic", "relogi\u0000"])("readWorldHeader_InvalidSignature_NotAWorldAtOffset4 (%s)", (signature) => {
    expectFormatError(buildHeader({ signature }), "NotAWorld", 4, "invalid signature");
  });

  it("readWorldHeader_ChineseBuildSignature_NotAWorldUnsupportedVariant", () => {
    expectFormatError(buildHeader({ signature: "xindong" }), "NotAWorld", 4, "unsupported variant");
  });

  it("readWorldHeader_InvalidSignatureAndType_SignatureReportedFirst", () => {
    expectFormatError(buildHeader({ signature: "garbage", fileType: 3 }), "NotAWorld", 4);
  });

  it.each([0, 1, 3, 255])("readWorldHeader_FileTypeNotWorld_NotAWorldAtOffset11 (%i)", (fileType) => {
    expectFormatError(buildHeader({ fileType }), "NotAWorld", 11, `file type ${String(fileType)} is not a world`);
  });

  it.each([10, 12, 0, -1])("readWorldHeader_SectionCountNot11_MalformedAtOffset24 (%i)", (sectionCount) => {
    expectFormatError(
      buildHeader({ sectionCount }),
      "MalformedSectionTable",
      24,
      `expected 11 sections, found ${String(sectionCount)}`,
    );
  });

  it("readWorldHeader_SectionCountNot11With26Bytes_MalformedNotTruncated", () => {
    expectFormatError(buildHeader({ sectionCount: 10, length: 26 }), "MalformedSectionTable", 24);
  });
});

describe("readWorldHeader — frame-important count", () => {
  it.each([-1, -32768])("readWorldHeader_NegativeFrameImportantCount_MalformedAtOffset70 (%i)", (frameCount) => {
    expectFormatError(
      buildHeader({ frameCount, frameBits: [] }),
      "MalformedSectionTable",
      70,
      "negative frame-important count",
    );
  });

  it("readWorldHeader_NegativeFrameImportantCountWithoutBitBytes_MalformedNotTruncated", () => {
    expectFormatError(buildHeader({ frameCount: -1, frameBits: [], length: 72 }), "MalformedSectionTable", 70);
  });

  it("readWorldHeader_FrameImportantCountLargerThanFile_Truncated", () => {
    // k = 32767 needs 4096 packed bytes, far past L = 200.
    expectFormatError(buildHeader({ frameCount: 32767 }), "Truncated", 200);
  });
});

describe("readWorldHeader — section pointers", () => {
  it.each([73, 75, 0, -1, -2147483648])("readWorldHeader_Pointer0NotHeaderEnd_MalformedAtOffset26 (%i)", (pointer) => {
    expectFormatError(
      buildHeader({ pointers: withPointer(0, pointer) }),
      "MalformedSectionTable",
      26,
      "section pointer must match the header end",
    );
  });

  it("readWorldHeader_Pointer0BeyondFile_MalformedBeyondEndOfFile", () => {
    expectFormatError(
      buildHeader({ pointers: withPointer(0, 4096) }),
      "MalformedSectionTable",
      26,
      "beyond end of file",
    );
  });

  it("readWorldHeader_Pointer1EqualsPointer0_AllowedForMetadataLayer", () => {
    const { sections } = readWorldHeader(buildHeader({ pointers: withPointer(1, 74) }));
    expect(sections.metadata).toEqual({ start: 74, end: 74 });
    expect(sections.tiles).toEqual({ start: 74, end: 120 });
  });

  it.each([73, 0, -1])("readWorldHeader_Pointer1BeforePointer0_MalformedAtOffset30 (%i)", (pointer) => {
    expectFormatError(
      buildHeader({ pointers: withPointer(1, pointer) }),
      "MalformedSectionTable",
      30,
      "section pointer is before metadata start",
    );
  });

  it("readWorldHeader_DocumentedVectorD_DecreasingPointer3MalformedAtOffset38", () => {
    expectFormatError(
      buildHeader({ pointers: withPointer(3, 110) }),
      "MalformedSectionTable",
      38,
      "not greater than previous",
    );
  });

  it("readWorldHeader_EqualPointers_MalformedNotGreaterThanPrevious", () => {
    expectFormatError(
      buildHeader({ pointers: withPointer(3, 120) }),
      "MalformedSectionTable",
      38,
      "not greater than previous",
    );
  });

  it("readWorldHeader_Pointer2EqualsPointer1_MalformedAtOffset34", () => {
    expectFormatError(
      buildHeader({ pointers: withPointer(2, 100) }),
      "MalformedSectionTable",
      34,
      "not greater than previous",
    );
  });

  it.each([-1, -2147483648])("readWorldHeader_NegativeLaterPointer_MalformedAtItsSlot (%i)", (pointer) => {
    expectFormatError(
      buildHeader({ pointers: withPointer(5, pointer) }),
      "MalformedSectionTable",
      46,
      "not greater than previous",
    );
  });

  it("readWorldHeader_DocumentedVectorC_LastPointerBeyondFileMalformedAtOffset66", () => {
    expectFormatError(
      buildHeader({ pointers: withPointer(10, 4096) }),
      "MalformedSectionTable",
      66,
      "beyond end of file",
    );
  });

  it("readWorldHeader_MiddlePointerBeyondFile_MalformedAtItsSlot", () => {
    expectFormatError(
      buildHeader({ pointers: withPointer(5, 201) }),
      "MalformedSectionTable",
      46,
      "beyond end of file",
    );
  });

  it("readWorldHeader_SeveralBadPointers_FirstInFileOrderWins", () => {
    const pointers = withPointer(3, 110);
    pointers[10] = 4096;
    expectFormatError(buildHeader({ pointers }), "MalformedSectionTable", 38, "not greater than previous");
  });

  it("readWorldHeader_FooterExactlySixBytes_Accepted", () => {
    const { sections } = readWorldHeader(buildHeader({ pointers: withPointer(10, 194) }));
    expect(sections.footer).toEqual({ start: 194, end: 200 });
  });

  it.each([195, 199, 200])("readWorldHeader_FooterShorterThanSixBytes_MalformedAtOffset66 (%i)", (pointer) => {
    expectFormatError(
      buildHeader({ pointers: withPointer(10, pointer) }),
      "MalformedSectionTable",
      66,
      "footer requires at least six bytes",
    );
  });
});

describe("readWorldHeader — Uint8Array views", () => {
  function embed(bytes: Uint8Array, before: number, after: number, fill: number): Uint8Array {
    const buffer = new Uint8Array(before + bytes.length + after).fill(fill);
    buffer.set(bytes, before);
    return buffer.subarray(before, before + bytes.length);
  }

  it("readWorldHeader_NonzeroOffsetView_DecodesRelativeToView", () => {
    const view = embed(buildHeader(), 13, 50, 0xff);
    const { header, sections } = readWorldHeader(view);
    expect(header.version).toBe(326);
    expect(sections.pointers).toEqual(POINTERS_A);
    expect(sections.footer).toEqual({ start: 180, end: 200 });
  });

  it("readWorldHeader_TruncatedViewOverLongerBuffer_TruncatedAtViewLength", () => {
    const full = buildHeader();
    const buffer = new Uint8Array(16 + full.length);
    buffer.set(full, 16);
    expectFormatError(buffer.subarray(16, 16 + 40), "Truncated", 40);
    expectFormatError(buffer.subarray(16, 16 + 73), "Truncated", 73);
    expectFormatError(buffer.subarray(16, 16 + 3), "Truncated", 3);
  });

  it("readWorldHeader_PointerBeyondViewButInsideBuffer_MalformedBeyondEndOfFile", () => {
    const bytes = buildHeader({ length: 250 });
    expectFormatError(bytes.subarray(0, 185), "MalformedSectionTable", 66, "footer requires at least six bytes");
    const shifted = new Uint8Array(8 + bytes.length);
    shifted.set(bytes, 8);
    expectFormatError(shifted.subarray(8, 8 + 179), "MalformedSectionTable", 66, "beyond end of file");
  });

  it("readWorldHeader_EmptyViewAtEndOfBuffer_TruncatedAtZero", () => {
    expectFormatError(new Uint8Array(new ArrayBuffer(8), 8, 0), "Truncated", 0);
  });

  it("readWorldHeader_EmptyArray_TruncatedAtZero", () => {
    expectFormatError(new Uint8Array(0), "Truncated", 0);
  });
});

describe("readWorldHeader — 2 GiB limit", () => {
  // Zero-filled typed arrays are allocated lazily, so a 2 GiB view costs little real memory.
  const TWO_GIB = 0x80000000;

  function hugeView(frameCount: number, frameBits: readonly number[], length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    bytes.set(buildHeader({ frameCount, frameBits, length: 72 + frameBits.length }));
    return bytes;
  }

  it.each([
    [-1, []],
    [0, []],
    [10, [0x38, 0x02]],
  ])(
    "readWorldHeader_FileOf2GiB_MalformedAtOffset26BeforeFrameCount (k = %i)",
    (frameCount: number, frameBits: number[]) => {
      expectFormatError(
        hugeView(frameCount, frameBits, TWO_GIB),
        "MalformedSectionTable",
        26,
        "file must be smaller than 2 GiB",
      );
    },
  );

  it("readWorldHeader_FileOf2GiBWithUnsupportedVersion_UnsupportedVersionFirst", () => {
    const bytes = hugeView(10, [0x38, 0x02], TWO_GIB);
    new DataView(bytes.buffer).setInt32(0, 327, true);
    expectFormatError(bytes, "UnsupportedVersion", 0);
  });

  it("readWorldHeader_FileOneByteBelow2GiB_Accepted", () => {
    const { sections } = readWorldHeader(hugeView(10, [0x38, 0x02], TWO_GIB - 1));
    expect(sections.footer).toEqual({ start: 180, end: TWO_GIB - 1 });
  });
});
