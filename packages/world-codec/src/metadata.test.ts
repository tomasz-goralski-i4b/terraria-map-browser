import { afterEach, describe, expect, it, vi } from "vitest";
import { readWorldHeader } from "./header.js";
import { readWorldMetadata } from "./index.js";
import { buildMetadata, METADATA_START, wrapMetadata, type MetadataSpec } from "./metadata-fixture.js";
import { WorldFormatError } from "./world-format-error.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fieldOffset(offsets: Readonly<Record<string, number>>, field: string): number {
  const offset = offsets[field];
  if (offset === undefined) throw new Error(`missing fixture field ${field}`);
  return offset;
}

function read(spec: MetadataSpec = {}, tileLength = Math.max(2, spec.width ?? 2)) {
  return readWorldMetadata(wrapMetadata(buildMetadata(spec).bytes, tileLength));
}

function expectMetadataError(bytes: Uint8Array, offset: number, reason?: string, field?: string): void {
  let caught: unknown;
  try { readWorldMetadata(bytes); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(WorldFormatError);
  const error = caught as WorldFormatError;
  expect({ kind: error.kind, offset: error.offset }).toEqual({ kind: "MalformedMetadata", offset });
  if (reason !== undefined) expect(error.reason).toContain(reason);
  if (field !== undefined) expect(error.field).toBe(field);
}

/** Replace a string including its prefix while retaining the independently generated remaining fields. */
function replaceString(field: string, raw: readonly number[]): { bytes: Uint8Array; offset: number } {
  const fixture = buildMetadata();
  const start = fieldOffset(fixture.offsets, field);
  let cursor = start;
  let length = 0;
  let shift = 0;
  let byte: number;
  do {
    byte = fixture.bytes[cursor++] ?? 0;
    length += (byte & 127) * 2 ** shift;
    shift += 7;
  } while ((byte & 128) !== 0);
  const bytes = new Uint8Array(start + raw.length + fixture.bytes.length - cursor - length);
  bytes.set(fixture.bytes.subarray(0, start));
  bytes.set(raw, start);
  bytes.set(fixture.bytes.subarray(cursor + length), start + raw.length);
  return { bytes: wrapMetadata(bytes), offset: METADATA_START + start };
}

/** Fail safely rather than letting an incorrect implementation allocate hostile-sized planes/buffers. */
function guardLargeAllocations(): number[] {
  const allocations: number[] = [];
  for (const name of ["Uint8Array", "Uint16Array", "Int16Array", "ArrayBuffer"] as const) {
    const constructor = globalThis[name];
    vi.stubGlobal(name, new Proxy(constructor, {
      construct(target, args: unknown[], newTarget) {
        const size = args[0];
        if (typeof size === "number" && size > 1048576) {
          allocations.push(size);
          throw new Error(`unvalidated large allocation: ${String(size)}`);
        }
        return Reflect.construct(target, args, newTarget) as object;
      },
    }));
  }
  return allocations;
}

describe("readWorldMetadata — complete format-326 walk and shared M1/M3", () => {
  it("returns every exposed field after consuming all documented rows and nonempty lists", () => {
    const fixture = buildMetadata();
    const file = wrapMetadata(fixture.bytes);
    const original = file.slice();
    const result = readWorldMetadata(file);
    expect(result.metadata).toEqual({
      name: "SCCR1", seed: "948580918", guid: "87e466e7853c3f48b75abc85e36d4b86",
      worldId: 1743427911, width: 2, height: 4, mode: "classic", evil: "corruption",
      bounds: { left: 0, right: 32, top: 0, bottom: 64 }, surfaceLevel: 300, rockLevel: 420.5,
    });
    expect(result.sections).toEqual(readWorldHeader(file).sections);
    expect(file).toEqual(original);
  });

  it("matches the documented M3 prefix in a generated 4200 by 1200 world", () => {
    const fixture = buildMetadata({ width: 4200, height: 1200 });
    const prefix = "055343435231093934383538303931380100000046010000" +
      "87e466e7853c3f48b75abc85e36d4b864799ea67000000008006010000000000004b0000b00400006810000000000000";
    const expected = Uint8Array.from(prefix.match(/../g) ?? [], (pair) => parseInt(pair, 16));
    expect(fixture.bytes.subarray(0, expected.length)).toEqual(expected);
    expect(readWorldMetadata(wrapMetadata(fixture.bytes, 4200)).metadata).toMatchObject({ width: 4200, height: 1200 });
  });

  it.each([
    [0, "classic"], [1, "expert"], [2, "master"], [3, "journey"],
    [7, { mode: "unknown", raw: 7 }], [-1, { mode: "unknown", raw: -1 }],
  ])("keeps mode %i", (mode, expected) => { expect(read({ mode }).metadata.mode).toEqual(expected); });

  it("preserves signed pixel bounds independently of tile dimensions and input view offset", () => {
    const fixture = buildMetadata();
    const start = fieldOffset(fixture.offsets, "height") - 16;
    const bounds = { left: -32, right: 67200, top: -16, bottom: 19200 };
    const view = new DataView(fixture.bytes.buffer);
    Object.values(bounds).forEach((value, index) => { view.setInt32(start + index * 4, value, true); });
    const file = wrapMetadata(fixture.bytes);
    const backing = new Uint8Array(file.length + 13);
    backing.set(file, 13);
    expect(readWorldMetadata(backing.subarray(13)).metadata).toMatchObject({ bounds, width: 2, height: 4 });
  });

  it.each([0, 1, 2, 3])("rejects truncated pixel bound %i at its own start", (index) => {
    const fixture = buildMetadata();
    const offset = fieldOffset(fixture.offsets, "height") - 16 + index * 4;
    expectMetadataError(wrapMetadata(fixture.bytes.subarray(0, offset + 3)), METADATA_START + offset, "overruns section");
  });

  it.each([[0, "corruption"], [1, "crimson"]])("decodes crimson Bool %i", (crimson, evil) => {
    expect(read({ crimson }).metadata.evil).toBe(evil);
  });

  it.each([[0, 0], [550.9999, 850.0001], [-3.5, 1e6]])("preserves surface level %d and rock level %d", (surfaceLevel, rockLevel) => {
    expect(read({ surfaceLevel, rockLevel }).metadata).toMatchObject({ surfaceLevel, rockLevel, evil: "corruption" });
  });

  it.each([
    ["surfaceLevel", Number.NaN], ["surfaceLevel", Number.POSITIVE_INFINITY], ["rockLevel", Number.NEGATIVE_INFINITY],
  ] as const)("rejects a non-finite %s (%d) at its own start", (field, value) => {
    const fixture = buildMetadata({ [field]: value });
    expectMetadataError(wrapMetadata(fixture.bytes), METADATA_START + fieldOffset(fixture.offsets, field),
      `${field}: not a finite number`, field);
  });

  it.each([-2147483648, -1, 0, 1743427911, 2147483647])("preserves signed world ID %i", (worldId) => {
    expect(read({ worldId }).metadata.worldId).toBe(worldId);
  });

  it.each([0n, 0xffffffffffffffffn, 0x8000000000000001n])("consumes UInt64 %s without shifting following fields", (worldGenVersion) => {
    expect(read({ worldGenVersion, creationTime: -9223372036854775808n, lastPlayed: 9223372036854775807n }).metadata)
      .toMatchObject({ worldId: 1743427911, width: 2, height: 4, evil: "corruption" });
  });

  it.each([
    ["Wörld ⛏ 世界 🌍", "🌍 not the bees"], ["", ""], ["tab\tand\u0000nul", "05162020"],
    ["\ufeffSCCR1", "\ufeff948580918"],
  ])("decodes exact UTF-8 name and seed %s", (name, seed) => {
    expect(read({ name, seed }).metadata).toMatchObject({ name, seed });
  });

  it("allows empty lists without imposing extra count minima", () => {
    let metadata = buildMetadata().bytes;
    // Remove list payloads in reverse order so earlier offsets remain stable.
    const offsets = buildMetadata().offsets;
    for (const [field, countBytes, payloadBytes] of [
      ["teamSpawns", 1, 8], ["treeTopVariations", 4, 52], ["partyingNpcs", 4, 12],
      ["claimableBanners", 2, 4], ["killCounts", 2, 12],
      ["anglerFinishers", 4, 6 + 1 + 12 + 1],
    ] as const) {
      const start = fieldOffset(offsets, field);
      const shortened = new Uint8Array(metadata.length - payloadBytes);
      shortened.set(metadata.subarray(0, start));
      shortened.set(metadata.subarray(start + countBytes + payloadBytes), start + countBytes);
      metadata = shortened;
    }
    expect(readWorldMetadata(wrapMetadata(metadata)).metadata.name).toBe("SCCR1");
  });
});

describe("readWorldMetadata — Bool, UTF-8 and bounded strings (M4/M5)", () => {
  it.each(buildMetadata().booleans)("rejects invalid consumed Bool at relative offset %i", (offset) => {
    const fixture = buildMetadata();
    fixture.bytes[offset] = 2;
    expectMetadataError(wrapMetadata(fixture.bytes), METADATA_START + offset, "invalid boolean");
  });

  it.each(["name", "seed", "anglerFinisher0", "worldGenManifest"])("rejects malformed UTF-8 in %s at its prefix", (field) => {
    for (const raw of [[2, 0xc3, 0x28], [1, 0xff], [3, 0xed, 0xa0, 0x80], [2, 0xc0, 0xaf], [1, 0x80], [2, 0xe2, 0x82]]) {
      const fixture = replaceString(field, raw);
      expectMetadataError(fixture.bytes, fixture.offset, "invalid UTF-8", field === "anglerFinisher0" ? "anglerFinishers" : field);
    }
  });

  it.each([
    [0xff, 0xff, 0xff, 0xff, 0x0f], [0xff, 0xff, 0xff, 0xff, 0x7f],
    [0x80, 0x80, 0x80, 0x80, 0x80, 0], [0x80, 0x80, 0x80, 0x80, 0x01],
  ])("rejects overflowing/overlong M5 name prefix %j", (...raw) => {
    const fixture = replaceString("name", raw);
    expectMetadataError(fixture.bytes, fixture.offset, undefined, "name");
  });

  it("rejects a valid length that exceeds metadata despite payload bytes in the tile section", () => {
    const bytes = wrapMetadata(Uint8Array.from([0x80, 0x08]), 2048);
    expectMetadataError(bytes, METADATA_START, undefined, "name");
  });

  it("rejects a truncated name prefix at its start", () => {
    expectMetadataError(wrapMetadata(Uint8Array.from([0x80])), METADATA_START, undefined, "name");
  });

  it.each(["seed", "anglerFinisher0", "worldGenManifest"])("validates length prefixes in consumed string %s", (field) => {
    const fixture = replaceString(field, [0xff, 0xff, 0xff, 0xff, 0x0f]);
    expectMetadataError(fixture.bytes, fixture.offset, undefined, field === "anglerFinisher0" ? "anglerFinishers" : field);
  });

  it.each(["name", "seed"])("accepts exactly 4096 UTF-8 bytes in %s", (field) => {
    const text = "ż".repeat(2048);
    expect(read({ [field]: text }).metadata[field as "name" | "seed"]).toBe(text);
  });

  it.each(["manifest", "finisher"])("accepts exactly 1048576 UTF-8 bytes in %s", (field) => {
    expect(read({ [field]: "ż".repeat(524288) }).metadata.width).toBe(2);
  });

  it.each([
    ["name", "name", 4096], ["seed", "seed", 4096],
    ["manifest", "worldGenManifest", 1048576], ["finisher", "anglerFinisher0", 1048576],
  ] as const)("rejects %s one byte above cap before payload copying or decoding", (property, field, cap) => {
    const fixture = buildMetadata({ [property]: "ż".repeat(cap / 2) + "a" });
    const file = wrapMetadata(fixture.bytes);
    const start = METADATA_START + fieldOffset(fixture.offsets, field);
    const slice = vi.spyOn(Uint8Array.prototype, "slice");
    const allocations = guardLargeAllocations();
    expectMetadataError(file, start, "safety limit", field === "anglerFinisher0" ? "anglerFinishers" : field);
    expect(allocations).toEqual([]);
    expect(slice.mock.calls.every(([begin, end]) => begin === undefined || end === undefined || end - begin <= cap)).toBe(true);
  });
});

describe("readWorldMetadata — counts and exact section consumption", () => {
  it.each([
    ["anglerFinishers", 4, -1], ["anglerFinishers", 4, 2147483647],
    ["killCounts", 2, -1], ["killCounts", 2, 32767],
    ["claimableBanners", 2, -1], ["claimableBanners", 2, 32767],
    ["partyingNpcs", 4, -1], ["partyingNpcs", 4, 2147483647],
    ["treeTopVariations", 4, -1], ["treeTopVariations", 4, 2147483647], ["teamSpawns", 1, 255],
  ] as const)("rejects %s count %i/%i before list allocation", (field, size, count) => {
    const fixture = buildMetadata();
    const offset = fieldOffset(fixture.offsets, field);
    const view = new DataView(fixture.bytes.buffer);
    if (size === 4) view.setInt32(offset, count, true);
    else if (size === 2) view.setInt16(offset, count, true);
    else view.setUint8(offset, count);
    const file = wrapMetadata(fixture.bytes);
    const allocations = guardLargeAllocations();
    expectMetadataError(file, METADATA_START + offset, "list does not fit in section", field);
    expect(allocations).toEqual([]);
  });

  it("rejects unread bytes at the first byte after the manifest", () => {
    const fixture = buildMetadata();
    const padded = new Uint8Array(fixture.bytes.length + 1);
    padded.set(fixture.bytes);
    expectMetadataError(wrapMetadata(padded), METADATA_START + fixture.bytes.length, "unread bytes");
  });

  it("rejects missing manifest payload at the string prefix", () => {
    const fixture = buildMetadata();
    const offset = fieldOffset(fixture.offsets, "worldGenManifest");
    expectMetadataError(wrapMetadata(fixture.bytes.subarray(0, fixture.bytes.length - 1)), METADATA_START + offset);
  });

  it("rejects empty metadata at pointer[0]", () => {
    expectMetadataError(wrapMetadata(new Uint8Array()), METADATA_START);
  });

  it("rejects a fixed field cut at pointer[1] rather than reading tile bytes", () => {
    const fixture = buildMetadata();
    const offset = fieldOffset(fixture.offsets, "worldId");
    expectMetadataError(wrapMetadata(fixture.bytes.subarray(0, offset + 3)), METADATA_START + offset, "overruns section");
  });
});

describe("readWorldMetadata — reference dimension safety (M1/M2)", () => {
  it.each([[1, 1], [2, 4], [4200, 1200], [65536, 4096], [4096, 65536], [16384, 16384]])(
    "validates width %i height %i without allocating CWM planes, including byte products above signed 32 bits",
    (width, height) => {
      const fixture = buildMetadata({ width, height });
      const file = wrapMetadata(fixture.bytes, width);
      const allocations = guardLargeAllocations();
      expect(readWorldMetadata(file).metadata).toMatchObject({ width, height });
      expect(allocations).toEqual([]);
    },
  );

  it.each([
    [2, 0, "height"], [2, -1, "height"], [2, -2147483648, "height"],
    [0, 4, "width"], [-1, 4, "width"], [-2147483648, 4, "width"],
    [65537, 4, "width"], [2, 65537, "height"],
    [2147483647, 4, "width"], [2, 2147483647, "height"],
    [65536, 65536, "width"], [32768, 8193, "width"], [16385, 16384, "width"], [16384, 16385, "width"],
  ] as const)("rejects width %i height %i at %s before large allocation", (width, height, field) => {
    const fixture = buildMetadata({ width, height });
    const file = wrapMetadata(fixture.bytes, Math.max(2, Math.min(width, 65536)));
    const allocations = guardLargeAllocations();
    const reason = width <= 0 || height <= 0 ? "must be positive" : "safety limit";
    expectMetadataError(file, METADATA_START + fieldOffset(fixture.offsets, field), reason, field);
    expect(allocations).toEqual([]);
  });

  it("rejects width greater than tile section byte length", () => {
    const fixture = buildMetadata({ width: 10 });
    expectMetadataError(wrapMetadata(fixture.bytes, 9), METADATA_START + fieldOffset(fixture.offsets, "width"), "tile section too short", "width");
  });

  it("rejects illegal dimensions before buffering a large declared metadata section", () => {
    const fixture = buildMetadata({ height: 65537 });
    const declared = new Uint8Array(16 * 1024 * 1024);
    declared.set(fixture.bytes);
    const file = wrapMetadata(declared);
    const slice = vi.spyOn(Uint8Array.prototype, "slice");
    const allocations = guardLargeAllocations();
    expectMetadataError(file, METADATA_START + fieldOffset(fixture.offsets, "height"));
    expect(allocations).toEqual([]);
    expect(slice.mock.calls.every(([begin, end]) => begin === undefined || end === undefined || end - begin <= 65536)).toBe(true);
  });
});

describe("readWorldMetadata — validated section table and views", () => {
  it.each([
    [0, "UnsupportedVersion"], [4, "NotAWorld"], [11, "NotAWorld"],
  ])("propagates header failure at offset %i as %s", (offset, kind) => {
    const file = wrapMetadata(buildMetadata().bytes);
    if (offset === 0) new DataView(file.buffer).setInt32(0, 327, true);
    else file[offset] = 0;
    let caught: unknown;
    try { readWorldMetadata(file); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(WorldFormatError);
    expect(caught).toMatchObject({ kind, offset });
  });

  it("returns all eleven section pointers and boundaries", () => {
    const file = wrapMetadata(buildMetadata().bytes);
    const result = readWorldMetadata(file);
    const expected = readWorldHeader(file);
    expect(result.header).toEqual(expected.header);
    expect(result.sections).toEqual(expected.sections);
    expect(result.sections.pointers).toHaveLength(11);
  });

  it("decodes a nonzero-offset view with offsets relative to the supplied view", () => {
    const file = wrapMetadata(buildMetadata().bytes);
    const backing = new Uint8Array(file.length + 41).fill(255);
    backing.set(file, 13);
    const view = backing.subarray(13, 13 + file.length);
    expect(readWorldMetadata(view)).toEqual(readWorldMetadata(file));
    view[METADATA_START] = 255;
    view[METADATA_START + 1] = 255;
    view[METADATA_START + 2] = 255;
    view[METADATA_START + 3] = 255;
    view[METADATA_START + 4] = 15;
    expectMetadataError(view, METADATA_START);
  });

  it("validates a later pointer before parsing malformed metadata", () => {
    const fixture = buildMetadata();
    fixture.bytes[0] = 255;
    const file = wrapMetadata(fixture.bytes);
    new DataView(file.buffer).setInt32(66, file.length + 1, true);
    let caught: unknown;
    try { readWorldMetadata(file); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(WorldFormatError);
    expect(caught).toMatchObject({ kind: "MalformedSectionTable", offset: 66 });
  });
});
