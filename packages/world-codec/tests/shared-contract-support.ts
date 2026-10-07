import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect } from "vitest";
import {
  ByteReader, readWorldMetadata, readWorldTiles, WorldFormatError,
  type TilePlanes, type WorldMetadata, type WorldTilesResult,
} from "@studio/world-codec";
import { buildMetadata, METADATA_START, wrapMetadata } from "../src/metadata-fixture.js";

/** Test-only adapters: expectations always come from the committed shared contracts. */
export interface VectorCase {
  readonly hex: string;
  readonly result?: Record<string, unknown>;
  readonly error?: Record<string, unknown>;
}

export interface ContractVector {
  readonly id: string;
  readonly entry: string;
  readonly context: Record<string, unknown>;
  readonly cases: readonly VectorCase[];
  readonly provenance?: { readonly file: string };
}

export interface VectorDocument {
  readonly schemaVersion: number;
  readonly group: string;
  readonly vectors: readonly ContractVector[];
}

export interface GoldenPair {
  readonly meta: Record<string, unknown>;
  readonly chunks: {
    readonly size: number;
    readonly planes: readonly string[];
    readonly digests: readonly Record<string, number | string>[];
  };
}

const root = new URL("../../../", import.meta.url);
// The dependency-free JavaScript validator has no TS declarations. Keep its untyped module
// boundary here and expose only the three documented functions to the typed test adapters.
const validation = await import(new URL("scripts/contracts-validation.mjs", root).href) as {
  validate: (schema: unknown, instance: unknown) => string[];
  validateVectorSemantics: (vector: ContractVector) => string[];
  validateChunkSemantics: (chunks: GoldenPair["chunks"], dimensions: unknown) => string[];
};

export function loadContractJson(path: URL): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

const schemas = {
  vector: loadContractJson(new URL("contracts/schemas/vector.v1.schema.json", root)),
  summary: loadContractJson(new URL("contracts/schemas/world-summary.v1.schema.json", root)),
  chunks: loadContractJson(new URL("contracts/schemas/chunks.v1.schema.json", root)),
};

function requireValid(errors: readonly string[], name: string): void {
  if (errors.length) throw new Error(`${name}: ${errors.join("; ")}`);
}

export function validateVectorDocument(document: unknown, name: string): void {
  requireValid(validation.validate(schemas.vector, document), name);
  for (const vector of (document as VectorDocument).vectors) {
    requireValid(validation.validateVectorSemantics(vector), name);
  }
}

function contextNumber(vector: ContractVector, field: string): number {
  const value = vector.context[field];
  if (typeof value !== "number") throw new Error(`${vector.id}: missing numeric context ${field}`);
  return value;
}

/** Resolve a CWM cell to the sparse semantic tile defined by world-summary.v1. */
function semanticTile(world: WorldTilesResult, index: number): Record<string, unknown> {
  const { planes, palette } = world;
  const flags = planes.flags[index] ?? 0;
  const tile: Record<string, unknown> = { wires: flags & 15, actuator: (flags & 16) !== 0 };
  for (const owner of ["block", "wall"] as const) {
    const ref = palette[planes[owner][index] ?? 0xffff];
    if (ref !== undefined) tile[owner] = ref;
  }
  if (planes.frameX[index] !== -1 || planes.frameY[index] !== -1) {
    tile["frameX"] = planes.frameX[index];
    tile["frameY"] = planes.frameY[index];
  }
  for (const field of ["paint", "wallPaint"] as const) {
    if (planes[field][index]) tile[field] = planes[field][index];
  }
  const liquid = [undefined, "water", "lava", "honey", "shimmer"][planes.liquid[index] ?? 0];
  if (liquid) tile["liquid"] = { kind: liquid, amount: planes.liquidAmount[index] };
  const shapes = [undefined, "half", "slopeTopRight", "slopeTopLeft", "slopeBottomRight", "slopeBottomLeft"];
  const shape = shapes[planes.shape[index] ?? 0];
  if (shape) tile["shape"] = shape;
  for (const [bit, field] of ["inactive", "invisibleBlock", "invisibleWall", "fullBrightBlock", "fullBrightWall"].entries()) {
    if (flags & (1 << (bit + 5))) tile[field] = true;
  }
  return tile;
}

function gameMode(metadata: WorldMetadata): number {
  return typeof metadata.mode === "object" ? metadata.mode.raw
    : ["classic", "expert", "master", "journey"].indexOf(metadata.mode);
}

/** Full-world filler gives the public codec the declared REC/SEC seam without copying its decoder. */
function tileHarness(vector: ContractVector, input: Uint8Array): { bytes: Uint8Array; start: number } {
  let width = vector.entry === "SEC" ? contextNumber(vector, "width") : 1;
  let height = vector.entry === "SEC" ? contextNumber(vector, "height") : contextNumber(vector, "columnHeight");
  let tiles = input;
  if (vector.entry === "REC") {
    const runWidth = (input[0] ?? 0) >> 6;
    if (runWidth === 0 && vector.id !== "R6") height = 1;
    else if (runWidth === 1 || runWidth === 2) {
      // Only the input's terminal run count sizes the filler; expected results are never consulted.
      const run = runWidth === 1 ? input.at(-1) ?? 0 : new ByteReader(input).readInt16(input.length - 2);
      if (run >= 0 && run < height) {
        tiles = new Uint8Array(input.length + height - run - 1);
        tiles.set(input);
      }
    }
    width = 1;
  }
  const metadata = buildMetadata({ width, height }).bytes;
  const bytes = wrapMetadata(metadata, tiles.length);
  const start = METADATA_START + metadata.length;
  bytes.set(tiles, start);
  const framing = vector.context["frameImportant"] as { k: number; frame: number[] };
  new DataView(bytes.buffer).setInt16(70, framing.k, true);
  bytes.fill(0, 72, 72 + Math.ceil(framing.k / 8));
  for (const id of framing.frame) bytes[72 + Math.floor(id / 8)] = (bytes[72 + Math.floor(id / 8)] ?? 0) | (1 << (id % 8));
  return { bytes, start };
}

function metadataHarness(vector: ContractVector, input: Uint8Array): { bytes: Uint8Array; start: number } {
  if (vector.provenance) {
    // M3 remains a prefix of the real section. Supply its unchanged fixture suffix to the
    // whole-world API, preserving sectionEnd rather than pretending inputEnd ends the section.
    const bytes = new Uint8Array(readFileSync(new URL(vector.provenance.file, root)));
    const start = contextNumber(vector, "baseOffset");
    expect(readWorldMetadata(bytes).sections.metadata.end, vector.id).toBe(contextNumber(vector, "sectionEnd"));
    bytes.set(input, start);
    return { bytes, start };
  }
  const fixture = buildMetadata();
  const startsAt = vector.context["startsAt"];
  const offset = startsAt === "height" ? fixture.offsets["height"]
    : startsAt === "bool" ? fixture.booleans[0] : startsAt === "name" ? 0 : undefined;
  if (offset === undefined) throw new Error(`${vector.id}: unsupported META field ${String(startsAt)}`);
  // Dimensions need the remaining valid metadata fields for the public API. Name errors must
  // retain the supplied section boundary, so an overrun cannot consume harness filler.
  const suffix = startsAt === "height" ? fixture.bytes.subarray(offset + input.length) : new Uint8Array();
  const metadata = new Uint8Array(offset + input.length + suffix.length);
  metadata.set(fixture.bytes.subarray(0, offset));
  metadata.set(input, offset);
  metadata.set(suffix, offset + input.length);
  const width = startsAt === "height" ? Math.max(2, new ByteReader(input).readInt32(4)) : 2;
  return { bytes: wrapMetadata(metadata, width), start: METADATA_START + offset };
}

export function decodeVectorCase(vector: ContractVector, variant: VectorCase): unknown {
  if (!["REC", "SEC", "META"].includes(vector.entry)) throw new Error(`${vector.id}: unsupported entry ${vector.entry}`);
  const input = new Uint8Array(Buffer.from(variant.hex, "hex"));
  const harness = vector.entry === "META" ? metadataHarness(vector, input) : tileHarness(vector, input);
  try {
    if (vector.entry === "META") {
      const { metadata } = readWorldMetadata(harness.bytes);
      const result: Record<string, unknown> = { kind: "metadata", height: metadata.height, width: metadata.width };
      if (vector.context["startsAt"] === "name") {
        const reader = new ByteReader(input);
        const bounds = input.length - 28; // prefix ends after bounds, dimensions and gameMode (rows 6–12)
        Object.assign(result, { name: metadata.name, seed: metadata.seed, guid: metadata.guid, worldId: metadata.worldId,
          bounds: { left: reader.readInt32(bounds), right: reader.readInt32(bounds + 4),
            top: reader.readInt32(bounds + 8), bottom: reader.readInt32(bounds + 12) }, gameMode: gameMode(metadata) });
      }
      return { result };
    }
    const world = readWorldTiles(harness.bytes);
    if (vector.entry === "SEC") {
      return { result: { kind: "grid", width: world.metadata.width, height: world.metadata.height,
        tiles: Array.from({ length: world.metadata.width * world.metadata.height }, (_, index) => semanticTile(world, index)) } };
    }
    const tile = semanticTile(world, 0);
    // Successful run records have an owned tile followed by empty filler. Count what the codec
    // actually expanded; reading the expected run (or echoing the encoded count) would hide defects.
    let run = 0;
    while (run + 1 < world.metadata.height && JSON.stringify(semanticTile(world, run + 1)) === JSON.stringify(tile)) run++;
    return { result: { kind: "record", tile, run } };
  } catch (error) {
    if (!(error instanceof WorldFormatError)) throw error;
    const diagnostic: Record<string, unknown> = {
      code: error.kind, offset: error.offset - harness.start + contextNumber(vector, "baseOffset"),
    };
    const separator = error.reason.indexOf(": ");
    diagnostic["reason"] = separator < 0 ? error.reason : error.reason.slice(separator + 2);
    if (separator >= 0) diagnostic["field"] = error.reason.slice(0, separator);
    if (error.x !== undefined) diagnostic["x"] = error.x;
    if (error.y !== undefined) diagnostic["y"] = error.y;
    return { error: diagnostic };
  }
}

export function assertVectorCase(vector: ContractVector, variant: VectorCase): void {
  const actual = decodeVectorCase(vector, variant);
  if (variant.error) expect(actual, vector.id).toMatchObject({ error: variant.error });
  else expect(actual, vector.id).toEqual({ result: variant.result });
}

const planeNames = ["block", "wall", "frameX", "frameY", "paint", "wallPaint", "liquid", "liquidAmount", "shape", "flags"] as const;
const skippedNames = ["chests", "signs", "npcsAndMobs", "tileEntities", "weightedPressurePlates", "townManager", "bestiary", "creativePowers", "footer"] as const;

function chunkDigest(plane: TilePlanes[keyof TilePlanes], height: number,
  chunk: { x: number; y: number; width: number; height: number }): string {
  const size = plane.BYTES_PER_ELEMENT;
  const bytes = new Uint8Array(chunk.width * chunk.height * size);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (let x = chunk.x * 128; x < chunk.x * 128 + chunk.width; x++) {
    for (let y = chunk.y * 128; y < chunk.y * 128 + chunk.height; y++) {
      const value = plane[x * height + y];
      if (value === undefined) throw new Error("Chunk exceeds decoded plane");
      if (size === 1) view.setUint8(offset, value);
      else if (plane instanceof Int16Array) view.setInt16(offset, value, true);
      else view.setUint16(offset, value, true);
      offset += size;
    }
  }
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

export function summarizeWorld(bytes: Uint8Array, name: string): GoldenPair {
  const world = readWorldTiles(bytes);
  const { metadata, sections } = world;
  const { width, height } = metadata;
  const digests: Record<string, number | string>[] = [];
  for (let x = 0; x < Math.ceil(width / 128); x++) {
    for (let y = 0; y < Math.ceil(height / 128); y++) {
      const chunk = { x, y, width: Math.min(128, width - x * 128), height: Math.min(128, height - y * 128) };
      const digest: Record<string, number | string> = { ...chunk };
      for (const plane of planeNames) digest[plane] = chunkDigest(world.planes[plane], height, chunk);
      digests.push(digest);
    }
  }
  const pair: GoldenPair = {
    meta: { schemaVersion: 1, formatVersion: world.header.version,
      metadata: { name: metadata.name, seed: metadata.seed, guid: metadata.guid, worldId: metadata.worldId,
        gameMode: gameMode(metadata), evil: metadata.evil }, dimensions: { width, height },
      skippedSections: skippedNames.map((section) => ({ name: section, ...sections[section] })), palette: world.palette },
    chunks: { size: 128, planes: planeNames, digests },
  };
  validateGoldenPair(pair, name);
  return pair;
}

export function loadWorldSummary(path: URL): GoldenPair {
  return summarizeWorld(new Uint8Array(readFileSync(path)), path.pathname.split("/").at(-1) ?? path.href);
}

export function validateGoldenPair(pair: GoldenPair, name: string): void {
  requireValid(validation.validate(schemas.summary, { ...pair.meta, chunks: pair.chunks }), name);
  requireValid(validation.validate(schemas.chunks, pair.chunks), name);
  requireValid(validation.validateChunkSemantics(pair.chunks, pair.meta["dimensions"]), name);
}

export function assertGoldenPair(actual: GoldenPair, expected: GoldenPair, name: string): void {
  validateGoldenPair(actual, name);
  validateGoldenPair(expected, name);
  expect(actual, name).toEqual(expected);
}
