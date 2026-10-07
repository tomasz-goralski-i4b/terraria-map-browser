import { describe, expect, it } from "vitest";
import { readWorldTiles, type TileContentRef, type WorldTilesResult } from "./index.js";
import { buildMetadata, METADATA_START, wrapMetadata } from "./metadata-fixture.js";
import { WorldFormatError } from "./world-format-error.js";

// Vectors T1–T17 and R1–R10 of docs/file-format/vectors.md, run through the whole-file API as the document
// prescribes: a REC vector is the whole section of a 1 x 1 world (run records: a 2 x 4 world with filler).

interface BuiltWorld {
  readonly file: Uint8Array;
  /** Absolute offset of the first tile byte (pointer[1]). */
  readonly start: number;
}

function build(width: number, height: number, tiles: readonly number[], trailing: readonly number[] = []): BuiltWorld {
  const metadata = buildMetadata({ width, height }).bytes;
  const file = wrapMetadata(metadata, tiles.length);
  const start = METADATA_START + metadata.length;
  file.set(tiles, start);
  file.set(trailing, start + tiles.length);
  return { file, start };
}

/** A decoded cell with palette indices resolved, defaults written out (docs/cwm.md "When absent"). */
interface Cell {
  block: TileContentRef | undefined;
  wall: TileContentRef | undefined;
  frameX: number;
  frameY: number;
  paint: number;
  wallPaint: number;
  liquid: number;
  liquidAmount: number;
  shape: number;
  flags: number;
}

function cell(result: WorldTilesResult, x: number, y: number): Cell {
  const { planes, palette, metadata } = result;
  const index = x * metadata.height + y;
  const ref = (value: number | undefined): TileContentRef | undefined =>
    value === undefined || value === 0xffff ? undefined : palette[value];
  return {
    block: ref(planes.block[index]),
    wall: ref(planes.wall[index]),
    frameX: planes.frameX[index] ?? NaN,
    frameY: planes.frameY[index] ?? NaN,
    paint: planes.paint[index] ?? NaN,
    wallPaint: planes.wallPaint[index] ?? NaN,
    liquid: planes.liquid[index] ?? NaN,
    liquidAmount: planes.liquidAmount[index] ?? NaN,
    shape: planes.shape[index] ?? NaN,
    flags: planes.flags[index] ?? NaN,
  };
}

const EMPTY: Cell = {
  block: undefined, wall: undefined, frameX: -1, frameY: -1, paint: 0, wallPaint: 0,
  liquid: 0, liquidAmount: 0, shape: 0, flags: 0,
};
const vanilla = (id: number): TileContentRef => ({ kind: "vanilla", id });
const unknown = (runtimeId: number): TileContentRef => ({ kind: "unknown", runtimeId });
const tile = (overrides: Partial<Cell>): Cell => ({ ...EMPTY, ...overrides });

/** A single record as the whole tile section of a 1 x 1 world. */
function single(record: readonly number[]): WorldTilesResult {
  return readWorldTiles(build(1, 1, record).file);
}

function failure(action: () => unknown): WorldFormatError & { x?: number; y?: number } {
  let caught: unknown;
  try { action(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(WorldFormatError);
  return caught as WorldFormatError & { x?: number; y?: number };
}

function expectMalformed(
  action: () => unknown,
  expected: { offset: number; reason?: string; x?: number; y?: number },
): void {
  const error = failure(action);
  expect(error.kind).toBe("MalformedTiles");
  expect(error.offset).toBe(expected.offset);
  if (expected.reason !== undefined) expect(error.reason).toContain(expected.reason);
  if (expected.x !== undefined) expect(error.x).toBe(expected.x);
  if (expected.y !== undefined) expect(error.y).toBe(expected.y);
}

describe("readWorldTiles — single records T1–T13", () => {
  it.each<[string, number[], Partial<Cell>]>([
    ["T1 empty", [0x00], {}],
    ["T2 active", [0x02, 0x01], { block: vanilla(1) }],
    ["T3 id 255", [0x02, 0xff], { block: vanilla(255) }],
    ["T4 id 256", [0x22, 0x00, 0x01], { block: vanilla(256) }],
    ["T5 non-canonical 255", [0x22, 0xff, 0x00], { block: vanilla(255) }],
    ["T6 framed", [0x02, 0x04, 0x00, 0x00, 0x42, 0x00], { block: vanilla(4), frameX: 0, frameY: 66 }],
    ["T7 water 255", [0x08, 0xff], { liquid: 1, liquidAmount: 255 }],
    ["T8 lava 0", [0x10, 0x00], { liquid: 2, liquidAmount: 0 }],
    ["T9 shimmer", [0x09, 0x01, 0x80, 0xff], { liquid: 4, liquidAmount: 255 }],
    [
      "T10 everything", [0x07, 0x13, 0x3a, 0x01, 0x0d, 0x04, 0x02],
      // red + yellow wire = bits 0 and 3, actuator = bit 4
      { block: vanilla(1), wall: vanilla(4), paint: 13, wallPaint: 2, shape: 1, flags: 0b11001 },
    ],
    [
      "T11 wall 300 + water", [0x0d, 0x01, 0x40, 0x2c, 0x0a, 0x01],
      { wall: vanilla(300), liquid: 1, liquidAmount: 10 },
    ],
    ["T12 invisible block", [0x03, 0x01, 0x01, 0x02, 0x01], { block: vanilla(1), flags: 1 << 6 }],
    ["T13 unknown wall", [0x05, 0x01, 0x40, 0x90, 0x01], { wall: unknown(400) }],
  ])("%s", (_name, record, expected) => {
    expect(cell(single(record), 0, 0)).toEqual(tile(expected));
  });

  it("maps every coating, wire, inactive and shape bit to the documented plane/flag bit", () => {
    // flag2: flag 3 follows, blue + green wires, shape 5; flag3: flag 4 follows, inactive;
    // flag4: invisible wall, full-bright block, full-bright wall.
    const result = single([0x07, 0x5d, 0x05, 0x1c, 0x01, 0x01]);
    const decoded = cell(result, 0, 0);
    expect(decoded.shape).toBe(5);
    // blue (bit 1) + green (bit 2) wires, inactive (bit 5), invisible wall (7), full-bright block/wall (8, 9)
    expect(decoded.flags).toBe((1 << 1) | (1 << 2) | (1 << 5) | (1 << 7) | (1 << 8) | (1 << 9));
  });

  it("keeps blocks and walls with equal ContentRef as one palette entry", () => {
    // block 1 + wall 1 in one tile: flag1 06, ids 01 01
    const result = single([0x06, 0x01, 0x01]);
    expect(result.palette).toEqual([vanilla(1)]);
    expect(result.planes.block[0]).toBe(0);
    expect(result.planes.wall[0]).toBe(0);
  });

  it("keeps paint bytes above 31 as read", () => {
    expect(cell(single([0x03, 0x01, 0x08, 0x01, 0xff]), 0, 0).paint).toBe(255);
  });
});

describe("readWorldTiles — single-record errors T14–T17 and the other documented rules", () => {
  // Every REC vector fails at x 0, y 0 and at the record's absolute offset.
  it.each<[string, number[], string | undefined]>([
    ["T14 id >= k", [0x22, 0xf2, 0x02], "no frame-important entry"],
    ["T15 dangling paint", [0x01, 0x01, 0x08], "flag without owner"],
    ["T16 shimmer + lava", [0x11, 0x01, 0x80, 0xff], undefined],
    ["T17 shape 6", [0x03, 0x60, 0x01], undefined],
    ["shape 7", [0x03, 0x70, 0x01], undefined],
    ["shimmer with honey", [0x19, 0x01, 0x80, 0xff], undefined],
    ["shimmer with no liquid", [0x01, 0x01, 0x80], undefined],
    ["wall flag with wall id 0", [0x04, 0x00], undefined],
    ["wall flag with wall id 0 after high byte", [0x05, 0x01, 0x40, 0x00, 0x00], undefined],
    ["wall paint without wall", [0x03, 0x01, 0x10, 0x01, 0x05], "flag without owner"],
    ["wall high byte without wall", [0x01, 0x01, 0x40, 0x01], "flag without owner"],
    ["shape without block", [0x05, 0x10, 0x01], "flag without owner"],
    ["wide block-id flag without block", [0x20], "flag without owner"],
    ["flag byte 2 bit 7", [0x03, 0x80, 0x01], "reserved bit"],
    ["flag byte 4 bit 0", [0x03, 0x01, 0x01, 0x01, 0x01], "reserved bit"],
    ["flag byte 4 bit 5", [0x03, 0x01, 0x01, 0x20, 0x01], "reserved bit"],
    ["flag byte 4 bit 7", [0x03, 0x01, 0x01, 0x80, 0x01], "reserved bit"],
  ])("%s", (_name, record, reason) => {
    expectMalformed(() => single(record), { offset: build(1, 1, record).start, x: 0, y: 0, ...(reason === undefined ? {} : { reason }) });
  });

  it("reads the wall high byte after the liquid amount, never next to the low byte", () => {
    // T11 with amount and high byte swapped: amount 1, high byte 10 -> wall 0x2c + 256 * 10 (unknown id).
    const decoded = cell(single([0x0d, 0x01, 0x40, 0x2c, 0x01, 0x0a]), 0, 0);
    expect(decoded.wall).toEqual(unknown(0x2c + 256 * 10));
    expect(decoded.liquidAmount).toBe(1);
  });

  it("accepts flag bytes that carry only a 'next byte follows' bit", () => {
    expect(cell(single([0x03, 0x01, 0x01, 0x00, 0x01]), 0, 0)).toEqual(tile({ block: vanilla(1) }));
  });
});

describe("readWorldTiles — runs and columns R1–R10 (2 x 4)", () => {
  const grid = (result: WorldTilesResult): Cell[][] =>
    [0, 1].map((x) => [0, 1, 2, 3].map((y) => cell(result, x, y)));
  const stone = tile({ block: vanilla(1) });
  const water = tile({ liquid: 1, liquidAmount: 255 });

  it("R1 accepts a UInt8 run of 0", () => {
    const result = readWorldTiles(build(2, 4, [0x42, 0x01, 0x00, 0x00, 0x00, 0x00, 0x40, 0x03]).file);
    expect(grid(result)[0]).toEqual([stone, EMPTY, EMPTY, EMPTY]);
  });

  it("R2 fills y and y + 1 for run 1", () => {
    const result = readWorldTiles(build(2, 4, [0x42, 0x01, 0x01, 0x00, 0x00, 0x40, 0x03]).file);
    expect(grid(result)).toEqual([[stone, stone, EMPTY, EMPTY], [EMPTY, EMPTY, EMPTY, EMPTY]]);
  });

  it("R3 decodes the last legal run and ends exactly at pointer[2]", () => {
    const { file } = build(2, 4, [0x42, 0x01, 0x03, 0x00, 0x48, 0xff, 0x02]);
    expect(grid(readWorldTiles(file))).toEqual([
      [stone, stone, stone, stone],
      [EMPTY, water, water, water],
    ]);
  });

  it("R4 accepts an Int16 run", () => {
    const result = readWorldTiles(build(2, 4, [0x82, 0x01, 0x03, 0x00, 0x00, 0x48, 0xff, 0x02]).file);
    expect(grid(result)[0]).toEqual([stone, stone, stone, stone]);
  });

  it("R5 rejects a run beyond the column", () => {
    const { file, start } = build(2, 4, [0x42, 0x01, 0x04]);
    expectMalformed(() => readWorldTiles(file), { offset: start, x: 0, y: 0, reason: "run crosses column end" });
  });

  it("R6 rejects a late run beyond the column at its own y and offset", () => {
    const { file, start } = build(2, 4, [0x00, 0x00, 0x00, 0x42, 0x01, 0x01]);
    expectMalformed(() => readWorldTiles(file), { offset: start + 3, x: 0, y: 3, reason: "run crosses column end" });
  });

  it("R7 rejects a negative Int16 run", () => {
    const { file, start } = build(2, 4, [0x82, 0x01, 0xff, 0xff]);
    expectMalformed(() => readWorldTiles(file), { offset: start, x: 0, y: 0, reason: "negative run" });
  });

  it("R8 rejects the reserved run width", () => {
    const { file, start } = build(2, 4, [0xc2, 0x01, 0x01, 0x00]);
    expectMalformed(() => readWorldTiles(file), { offset: start, x: 0, y: 0, reason: "reserved run width" });
  });

  it("R9 reports a truncated record and never reads into the following section", () => {
    // The bytes after pointer[2] would complete the T10 record if a decoder ran on.
    const { file, start } = build(2, 4, [0x07, 0x13, 0x3a, 0x01], [0x0d, 0x04, 0x02]);
    expectMalformed(() => readWorldTiles(file), { offset: start, x: 0, y: 0, reason: "truncated record" });
  });

  it("R9b reports a record cut inside its run counter", () => {
    const { file, start } = build(2, 4, [0x00, 0x42, 0x01], [0x03]);
    expectMalformed(() => readWorldTiles(file), { offset: start + 1, x: 0, y: 1, reason: "truncated record" });
  });

  it("R9c reports a section that ends before the grid is complete", () => {
    const { file, start } = build(2, 4, [0x40, 0x03], [0x40, 0x03]);
    expectMalformed(() => readWorldTiles(file), { offset: start + 2, x: 1, y: 0, reason: "truncated record" });
  });

  it("R10 rejects leftover bytes at the first unread byte", () => {
    const { file, start } = build(2, 4, [0x42, 0x01, 0x03, 0x00, 0x48, 0xff, 0x02, 0x00]);
    expectMalformed(() => readWorldTiles(file), { offset: start + 7, reason: "section not fully consumed" });
  });

  it("does not let a run continue into the next column", () => {
    // Column 0 ends with a run reaching y 3; column 1 starts fresh with its own record.
    const result = readWorldTiles(build(2, 4, [0x42, 0x01, 0x03, 0x00, 0x40, 0x03]).file);
    expect(grid(result)[1]).toEqual([EMPTY, EMPTY, EMPTY, EMPTY]);
  });
});

describe("readWorldTiles — palette order and plane filling", () => {
  it("assigns palette indices by first appearance in a column-major scan, block before wall", () => {
    // Column 0: block 1 + wall 4 for the whole column (run 3). Column 1: block 2 + wall 1 (run 3).
    const { file } = build(2, 4, [0x46, 0x01, 0x04, 0x03, 0x46, 0x02, 0x01, 0x03]);
    const result = readWorldTiles(file);
    expect(result.palette).toEqual([vanilla(1), vanilla(4), vanilla(2)]);
    expect(Array.from(result.planes.block)).toEqual([0, 0, 0, 0, 2, 2, 2, 2]);
    expect(Array.from(result.planes.wall)).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it("allocates every plane at width x height with the documented element types and absent values", () => {
    const { planes } = readWorldTiles(build(2, 4, [0x40, 0x03, 0x40, 0x03]).file);
    expect(planes.block).toBeInstanceOf(Uint16Array);
    expect(planes.frameX).toBeInstanceOf(Int16Array);
    expect(planes.flags).toBeInstanceOf(Uint16Array);
    expect(planes.shape).toBeInstanceOf(Uint8Array);
    for (const name of Object.keys(planes) as (keyof typeof planes)[]) expect(planes[name]).toHaveLength(8);
    expect(Array.from(planes.block)).toEqual(Array<number>(8).fill(0xffff));
    expect(Array.from(planes.frameY)).toEqual(Array<number>(8).fill(-1));
  });

  it("keeps ids above the vanilla range as unknown palette entries", () => {
    // y 0: block 753 + wall 366 (highest vanilla ids); y 1: wall 367 (unknown); y 2: empty
    const { file } = build(1, 3, [0x27, 0x01, 0x40, 0xf1, 0x02, 0x6e, 0x01, 0x05, 0x01, 0x40, 0x6f, 0x01, 0x00]);
    const result = readWorldTiles(file);
    expect(cell(result, 0, 0).block).toEqual(vanilla(753));
    expect(cell(result, 0, 0).wall).toEqual(vanilla(366));
    expect(cell(result, 0, 1).wall).toEqual(unknown(367));
    expect(result.palette).toEqual([vanilla(753), vanilla(366), unknown(367)]);
  });

  it("does not mutate the input bytes", () => {
    const { file } = build(2, 4, [0x42, 0x01, 0x03, 0x00, 0x48, 0xff, 0x02]);
    const copy = file.slice();
    readWorldTiles(file);
    expect(file).toEqual(copy);
  });
});
