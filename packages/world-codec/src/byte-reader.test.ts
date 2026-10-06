import { describe, expect, it } from "vitest";
import { ByteReader } from "./byte-reader.js";
import { WorldFormatError } from "./world-format-error.js";

function catchError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

function expectTruncated(action: () => unknown, offset: number): void {
  const error = catchError(action);
  expect(error).toBeInstanceOf(WorldFormatError);
  const formatError = error as WorldFormatError;
  expect({ kind: formatError.kind, offset: formatError.offset }).toEqual({ kind: "Truncated", offset });
}

describe("ByteReader", () => {
  const bytes = Uint8Array.of(
    0x46, 0x01, 0x00, 0x00, // 0: Int32 326
    0xff, 0xff, 0xff, 0xff, // 4: Int32 -1 / UInt32 4294967295
    0xfe, 0xff, // 8: Int16 -2
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, // 10: UInt64 max
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, // 18: UInt64 2^63 + 1
  );

  it("readIntegers_LittleEndian_DecodesSignedAndUnsigned", () => {
    const reader = new ByteReader(bytes);
    expect(reader.length).toBe(26);
    expect(reader.readUint8(0)).toBe(0x46);
    expect(reader.readInt32(0)).toBe(326);
    expect(reader.readInt32(4)).toBe(-1);
    expect(reader.readUint32(4)).toBe(4294967295);
    expect(reader.readInt16(8)).toBe(-2);
  });

  it("readUint64_AllBitsSet_KeepsFull64BitPrecision", () => {
    const reader = new ByteReader(bytes);
    expect(reader.readUint64(10)).toBe(18446744073709551615n);
    expect(reader.readUint64(18)).toBe(9223372036854775809n);
  });

  it("readBytes_InRange_ReturnsCopy", () => {
    const reader = new ByteReader(bytes);
    const copy = reader.readBytes(0, 4);
    expect([...copy]).toEqual([0x46, 0x01, 0x00, 0x00]);
    copy[0] = 0;
    expect(bytes[0]).toBe(0x46);
  });

  it("read_PastEndOfView_ThrowsTruncatedAtViewLength", () => {
    const reader = new ByteReader(bytes);
    expectTruncated(() => reader.readUint8(26), 26);
    expectTruncated(() => reader.readInt16(25), 26);
    expectTruncated(() => reader.readInt32(23), 26);
    expectTruncated(() => reader.readUint32(24), 26);
    expectTruncated(() => reader.readUint64(19), 26);
    expectTruncated(() => reader.readBytes(20, 7), 26);
  });

  it("read_EmptyInput_ThrowsTruncatedAtZero", () => {
    const reader = new ByteReader(new Uint8Array(0));
    expect(reader.length).toBe(0);
    expectTruncated(() => reader.readUint8(0), 0);
    expectTruncated(() => reader.readInt32(0), 0);
  });

  it("read_NonzeroOffsetView_UsesOffsetsRelativeToView", () => {
    const buffer = new Uint8Array(40).fill(0xaa);
    buffer.set(bytes, 7);
    const view = buffer.subarray(7, 7 + bytes.length);
    const reader = new ByteReader(view);
    expect(reader.length).toBe(26);
    expect(reader.readInt32(0)).toBe(326);
    expect(reader.readUint64(18)).toBe(9223372036854775809n);
  });

  it("read_NonzeroOffsetView_NeverReadsBytesAfterView", () => {
    const buffer = new Uint8Array(32).fill(0x11);
    const view = buffer.subarray(8, 12);
    const reader = new ByteReader(view);
    expect(reader.readInt32(0)).toBe(0x11111111);
    expectTruncated(() => reader.readUint8(4), 4);
    expectTruncated(() => reader.readInt32(2), 4);
    expectTruncated(() => reader.readUint64(0), 4);
  });

  it("read_EmptyViewAtEndOfBuffer_ThrowsTruncatedAtZero", () => {
    const view = new Uint8Array(new ArrayBuffer(16), 16, 0);
    const reader = new ByteReader(view);
    expect(reader.length).toBe(0);
    expectTruncated(() => reader.readUint8(0), 0);
  });
});
