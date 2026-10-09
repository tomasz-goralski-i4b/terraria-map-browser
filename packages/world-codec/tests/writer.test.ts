import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readWorldTiles, writeWorld, writeWorldTiles, WorldFormatError, type WorldTilesResult } from "../src/index.js";
import { writerSource, writerWorld } from "./writer-support.js";

const corpus = new URL("../../test-fixtures/worlds/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", corpus), "utf8")) as { worlds: { file: string }[] };

function withContent(world: WorldTilesResult, block?: number, wall?: number): WorldTilesResult {
  const palette = [...world.palette];
  if (block !== undefined) { world.planes.block.fill(palette.length); palette.push({ kind: "vanilla", id: block }); }
  if (wall !== undefined) { world.planes.wall.fill(palette.length); palette.push({ kind: "vanilla", id: wall }); }
  return { ...world, palette };
}

function expectFailure(action: () => unknown, kind: string, fields: Record<string, unknown> = {}): void {
  expect(action).toThrow(WorldFormatError);
  expect(action).toThrow(expect.objectContaining({ kind, ...fields }));
}

describe("format-326 writer vectors", () => {
  it.each([
    { id: "W1", height: 1, block: 255, bytes: [2, 255] },
    { id: "W2", height: 1, block: 256, bytes: [0x22, 0, 1] },
    { id: "W3", height: 1, wall: 255, bytes: [4, 255] },
    { id: "W4", height: 1, wall: 256, bytes: [5, 1, 0x40, 0, 1] },
    { id: "W5", height: 1, bytes: [0] },
    { id: "W6", height: 2, block: 1, bytes: [0x42, 1, 1] },
    { id: "W7", height: 256, bytes: [0x40, 255] },
    { id: "W8", height: 257, bytes: [0x80, 0, 1] },
    { id: "W9", height: 32768, bytes: [0x80, 255, 127] },
    { id: "W10", height: 32769, bytes: [0x80, 255, 127, 0] },
    { id: "W11", width: 2, height: 4, block: 1, bytes: [0x42, 1, 3, 0x42, 1, 3] },
    { id: "W12", height: 2, block: 520, framed: true, bytes: [0x22, 8, 2, 0, 0, 0, 0, 0x22, 8, 2, 0, 0, 0, 0] },
    { id: "W13", height: 3, block: 423, framed: true, frameX: 18,
      bytes: [0x22, 167, 1, 18, 0, 0, 0, 0x22, 167, 1, 18, 0, 0, 0, 0x22, 167, 1, 18, 0, 0, 0] },
    { id: "W14", height: 1, liquid: 2, bytes: [0x10, 0] },
    { id: "W15", height: 1, block: 1, paint: 0, bytes: [2, 1] },
    { id: "W16", height: 1, block: 1, paint: 31, bytes: [3, 1, 8, 1, 31] },
  ])("$id encodes the documented canonical bytes", (vector) => {
    const world = withContent(writerWorld(vector.width ?? 1, vector.height), vector.block, vector.wall);
    if (vector.framed === true) { world.planes.frameX.fill(vector.frameX ?? 0); world.planes.frameY.fill(0); }
    world.planes.paint.fill(vector.paint ?? 0);
    world.planes.liquid.fill(vector.liquid ?? 0);
    expect(Array.from(writeWorldTiles(world))).toEqual(vector.bytes);
  });

  it("W17 refuses a block without a frame-important entry", () => {
    const world = withContent(writerWorld(1, 1), 754);
    expectFailure(() => writeWorldTiles(world), "UnencodableTile", { x: 0, y: 0 });
  });

  it("preserves every tile field, negative frames, zero-amount shimmer and residual shapes", () => {
    const world = withContent(writerWorld(1, 1), 423, 256);
    world.planes.frameX[0] = -18;
    world.planes.frameY[0] = -1;
    world.planes.paint[0] = 255;
    world.planes.wallPaint[0] = 31;
    world.planes.flags[0] = 0x3ff;
    world.planes.shape[0] = 5;
    world.planes.liquid[0] = 4;
    expect(Array.from(writeWorldTiles(world))).toEqual([
      0x2f, 0x5f, 0xff, 0x1e, 0xa7, 1, 0xee, 0xff, 0xff, 0xff, 255, 0, 31, 0, 1,
    ]);
    const reloaded = readWorldTiles(new Uint8Array(writeWorld(world)));
    for (const name of Object.keys(world.planes) as (keyof typeof world.planes)[]) {
      expect(reloaded.planes[name]).toEqual(world.planes[name]);
    }
    const empty = writerWorld(1, 1);
    empty.planes.shape[0] = 3;
    expect(Array.from(writeWorldTiles(empty))).toEqual([1, 0x30]);
  });

  it("merges semantically equal palette aliases and keeps ice-rod blocks", () => {
    const world = { ...writerWorld(1, 2), palette: [{ kind: "vanilla", id: 127 }, { kind: "vanilla", id: 127 }] as const };
    world.planes.block.set([0, 1]);
    expect(Array.from(writeWorldTiles(world))).toEqual([0x42, 127, 1]);
  });
});

describe("world save", () => {
  describe.each([writeWorldTiles, writeWorld])("$name unsupported content", (write) => {
    it.each([
      { kind: "unknown", runtimeId: 900 },
      { kind: "mod", mod: "CalamityMod", internalName: "AstralStone", runtimeId: 900 },
    ])("refuses $kind content in block, wall and unused palette roles without mutation", (ref) => {
      for (const role of ["block", "wall", "unused"] as const) {
        const world = writerWorld();
        // Exercise the runtime boundary too: mod refs are outside the codec's typed palette subset.
        Object.assign(world, { palette: [ref] });
        if (role !== "unused") world.planes[role][2] = 0;
        const before = structuredClone(world);
        expectFailure(() => write(world), "UnsupportedWrite");
        expect(world).toEqual(before);
      }
    });
  });

  describe.each([writeWorldTiles, writeWorld])("$name missing palette references", (write) => {
    it.each(["block", "wall"] as const)("rejects a sparse %s entry at its coordinate", (plane) => {
      const palette = [{ kind: "vanilla", id: 1 }] as WorldTilesResult["palette"][number][];
      const world = { ...writerWorld(1, 2), palette };
      world.planes[plane][0] = 0;
      Reflect.deleteProperty(palette, "0");
      expectFailure(() => write(world), "UnencodableTile", { x: 0, y: 0 });
    });

    it.each([
      ["block", 0], ["block", 1], ["wall", 0], ["wall", 1],
    ] as const)("reports a missing %s reference on tile %i", (plane, index) => {
      const world = writerWorld(1, 2);
      world.planes[plane][index] = world.palette.length;
      expectFailure(() => write(world), "UnencodableTile", { x: 0, y: index });
    });
  });

  it.each(manifest.worlds)("saves $file byte-identically and round-trips all planes and metadata", ({ file }) => {
    const bytes = Uint8Array.from(readFileSync(new URL(file, corpus)));
    const parsed = readWorldTiles(bytes);
    const output = writeWorld(parsed);
    expect(Buffer.from(output).equals(Buffer.from(bytes))).toBe(true);
    expect(output).not.toBe(bytes.buffer);
    const reloaded = readWorldTiles(new Uint8Array(output));
    expect(reloaded.metadata).toEqual(parsed.metadata);
    expect(reloaded.details).toEqual(parsed.details);
    expect(reloaded.palette).toEqual(parsed.palette);
    for (const name of Object.keys(parsed.planes) as (keyof typeof parsed.planes)[]) {
      const before = parsed.planes[name];
      const after = reloaded.planes[name];
      expect(Buffer.from(after.buffer).equals(Buffer.from(before.buffer))).toBe(true);
    }
  });

  it("edits stone, wall and zero-amount liquid at only one coordinate, moving preserved spans", () => {
    const world = { ...writerWorld(), palette: [{ kind: "vanilla", id: 1 }] as const };
    const source = world.envelope.source.slice();
    world.planes.block[2] = 0;
    world.planes.wall[2] = 0;
    world.planes.liquid[2] = 4;
    const saved = readWorldTiles(new Uint8Array(writeWorld(world)));
    expect(saved.metadata).toEqual(world.metadata);
    for (const name of Object.keys(world.planes) as (keyof typeof world.planes)[]) {
      expect(saved.planes[name]).toEqual(world.planes[name]);
    }
    expect(saved.sections.tiles.end).toBeGreaterThan(world.sections.tiles.end);
    expect(Buffer.from(saved.envelope.source.subarray(saved.sections.chests.start)).equals(
      Buffer.from(world.envelope.source.subarray(world.sections.chests.start)))).toBe(true);
    expect(world.envelope.source).toEqual(source);
    expect(world.planes.block[2]).toBe(0);
  });

  it("canonicalizes widened runs and separate records, shrinking and relocating all later pointers", () => {
    const bytes = writerSource(2, 4, [0x82, 1, 3, 0, 2, 1, 2, 1, 2, 1, 2, 1]);
    const world = readWorldTiles(bytes);
    const saved = readWorldTiles(new Uint8Array(writeWorld(world)));
    expect(Array.from(saved.envelope.tiles)).toEqual([0x42, 1, 3, 0x42, 1, 3]);
    const delta = saved.envelope.tiles.length - world.envelope.tiles.length;
    expect(delta).toBeLessThan(0);
    expect(saved.sections.pointers).toEqual(world.sections.pointers.map((pointer, index) => index < 2 ? pointer : pointer + delta));
    expect(saved.envelope.footer).toEqual(world.envelope.footer);
    saved.envelope.opaqueSections.forEach((section, index) => {
      expect(section.bytes).toEqual(world.envelope.opaqueSections[index]?.bytes);
    });
  });

  it("preserves reserved header flags, revision and frame padding from a subview", () => {
    const source = writerSource();
    const view = new DataView(source.buffer);
    view.setBigUint64(16, 0x8000000000000001n, true);
    view.setUint32(12, 0xffffffff, true);
    source[166] = 0xfc;
    const storage = new Uint8Array(source.length + 32);
    storage.set(source, 16);
    const output = writeWorld(readWorldTiles(storage.subarray(16, 16 + source.length)));
    expect(Buffer.from(output).equals(Buffer.from(source))).toBe(true);
    expect(storage.subarray(0, 16).every((byte) => byte === 0)).toBe(true);
  });

  it("rejects frames on an unframed active stone block", () => {
    const world = withContent(writerWorld(), 1);
    world.planes.frameY[3] = 0;
    expectFailure(() => writeWorld(world), "UnencodableTile", { x: 0, y: 3 });
  });

  it.each([
    ["name", { name: "Crimson Observatory" }], ["dimensions", { width: 3 }], ["world id", { worldId: 866419627 }],
  ] as const)("rejects metadata edits: %s", (_, change) => {
    const world = writerWorld();
    Object.assign(world.metadata, change);
    expectFailure(() => writeWorld(world), "UnsupportedWrite");
  });

  it.each(["missing envelope", "other format", "header edit", "details edit", "entity edit", "short plane", "wrong plane type",
    "changed frame bits", "changed frame count", "changed section pointer", "opaque view mismatch", "opaque order", "raw metadata edit",
    "unknown palette entry", "out-of-range vanilla ref"])("rejects %s explicitly", (change) => {
    const world = writerWorld();
    switch (change) {
      case "missing envelope": Reflect.deleteProperty(world, "envelope"); break;
      case "other format": Object.assign(world.header, { version: 325 }); break;
      case "header edit": Object.assign(world.header, { revision: 3 }); break;
      case "details edit": Object.assign(world.details.spawnAndLandmarks.spawn, { x: 1 }); break;
      case "entity edit": Object.assign(world.entities.Chests, { error: { code: "MalformedSection", offset: 1, message: "edited chest" } }); break;
      case "short plane": Object.assign(world.planes, { flags: new Uint16Array(7) }); break;
      case "wrong plane type": Object.assign(world.planes, { paint: new Uint16Array(8) }); break;
      case "changed frame bits": world.sections.frameImportantBits[0] = 0; break;
      case "changed frame count": Object.assign(world.sections, { frameImportantCount: 753 }); break;
      case "changed section pointer": Object.assign(world.sections, { pointers: [...world.sections.pointers.slice(0, 3), 4096, ...world.sections.pointers.slice(4)] }); break;
      case "opaque view mismatch": Object.assign(world.envelope.opaqueSections[0] ?? {}, { bytes: new Uint8Array(2) }); break;
      case "opaque order": Object.assign(world.envelope, { opaqueSections: [...world.envelope.opaqueSections].reverse() }); break;
      case "raw metadata edit": world.envelope.metadata[1] = 0x4a; break;
      case "unknown palette entry": Object.assign(world, { palette: [{ kind: "unknown", runtimeId: 900 }] }); break;
      case "out-of-range vanilla ref": Object.assign(world, { palette: [{ kind: "vanilla", id: 900 }] }); break;
    }
    expectFailure(() => writeWorld(world), "UnsupportedWrite");
  });

  it.each([
    ["paint without block", "paint", 1], ["paint without wall", "wallPaint", 31],
    ["unowned frame", "frameX", 18], ["undefined liquid", "liquid", 5],
    ["amount without kind", "liquidAmount", 255], ["undefined shape", "shape", 6],
    ["reserved flags", "flags", 0x400], ["missing palette index", "block", 4],
  ] as const)("rejects %s at its tile coordinate", (_, plane, value) => {
    const world = writerWorld();
    world.planes[plane][5] = value;
    expectFailure(() => writeWorld(world), "UnencodableTile", { x: 1, y: 1 });
  });

  it("rejects wall id zero and a block beyond the frame count", () => {
    expectFailure(() => writeWorld(withContent(writerWorld(), undefined, 0)), "UnencodableTile");
    const world = withContent(writerWorld(), 753);
    Object.assign(world.sections, { frameImportantCount: 753 });
    expectFailure(() => writeWorldTiles(world), "UnencodableTile", { x: 0, y: 0 });
  });

  it.each([
    ["invalid marker", 0, 0, "MalformedFooter", 0], ["invalid prefix", 1, 0xff, "MalformedFooter", 1],
    ["invalid UTF-8", 2, 0xff, "MalformedFooter", 1], ["different name", 2, 0x4a, "InconsistentFooter", 1],
    ["different world id", 7, 0, "InconsistentFooter", 7],
  ] as const)("refuses footer with %s instead of repairing it", (_, relative, byte, kind, errorOffset) => {
    const bytes = writerSource();
    const footer = new DataView(bytes.buffer).getInt32(66, true);
    bytes[footer + relative] = byte;
    const world = readWorldTiles(bytes);
    expectFailure(() => writeWorld(world), kind, { offset: footer + errorOffset });
  });

  it("refuses trailing footer bytes at their absolute offset", () => {
    const source = writerSource();
    const bytes = new Uint8Array(source.length + 1);
    bytes.set(source);
    expectFailure(() => writeWorld(readWorldTiles(bytes)), "MalformedFooter", { offset: source.length });
  });
});
